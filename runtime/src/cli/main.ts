#!/usr/bin/env node
/**
 * La CLI de verificación en seco.
 *
 * Es el primer hito del proyecto porque es el invariante 8 convertido en
 * producto y no en promesa: valida y explica políticas sin infraestructura de
 * ningún tipo. Un linter de políticas ya justifica su existencia, y además se
 * convierte en el banco de pruebas de todo lo posterior (decisión 0007).
 *
 * Esta es la cáscara imperativa: aquí viven el reloj, el sistema de ficheros y
 * la salida estándar. El instante se captura *aquí* y entra en la decisión como
 * un hecho más — por eso no existe un puerto `Clock`.
 */
import { parseArgs } from 'node:util';
import {
  declaredCatalogFile,
  envCredentials,
  mcpStdioInvoker,
  mcpStdioServer,
  memoryUsage,
  policyFile,
  staticKeyPrincipals,
  stderrRecorder,
  type StaticKeyIssuer,
} from '@mcpizer/adapters';
import { hasErrors, schema } from '@mcpizer/policy';
import type { Instant, Usage } from '@mcpizer/access';
import {
  effectiveDiff,
  explain,
  gateway,
  loadPolicy,
  whoCan,
  type CatalogSource,
  type CredentialResolver,
  type DecisionRecorder,
  type GatewayPorts,
  type LoadedPolicy,
  type PolicySource,
  type PrincipalResolver,
  type ToolInvoker,
  type TransportCredentials,
  type UsageReader,
  type UsageWriter,
} from '../index.js';
import { renderCallOutcome, renderDiagnostics, renderDiff, renderExplanation, renderReach } from './render.js';

const USAGE = `mcpizer — verificación en seco de políticas. Sin red, sin credenciales, sin despliegue.

  mcpizer validate <politica.yaml> [--catalog <catalogo.yaml>] [--json]
      Estructura, referencias colgantes, concesiones ambiguas y capacidades que
      ninguna tool realiza. Es lo que corre en CI sobre el PR que toca la política.

  mcpizer explain <politica.yaml> --issuer <id> --subject <s> --capability <id>
                  [--attr clave=valor]... [--at <ISO-8601>] [--usage <n|unknown|none>]
                  [--catalog <catalogo.yaml>] [--json]
      La decisión completa con su motivo y el sitio exacto a tocar.

  mcpizer who-can <politica.yaml> --capability <id> [--catalog <catalogo.yaml>] [--json]
      Quién llega a una capacidad y con qué cuenta. La pregunta de auditoría real.

  mcpizer diff <antes.yaml> <despues.yaml> [--at <ISO-8601>] [--catalog <catalogo.yaml>] [--json]
      Qué decisiones cambian. Un diff de texto no lo dice.

  mcpizer schema
      El JSON Schema del artefacto, para editores y validadores externos.

  mcpizer serve <politica.yaml> --catalog <catalogo.yaml> --issuer <id> [--key-env <VAR>]
      La pasarela MCP por stdio. Un cliente ve solo lo concedido a la identidad
      con la que se conecta, e invocar una tool no listada deniega con motivo.
      La clave se presenta por entorno, porque stdio no tiene cabeceras.

Códigos de salida: 0 sin hallazgos · 1 hallazgos · 2 uso incorrecto · 3 origen inalcanzable.`;

const OPTIONS = {
  catalog: { type: 'string' },
  json: { type: 'boolean', default: false },
  issuer: { type: 'string' },
  subject: { type: 'string' },
  attr: { type: 'string', multiple: true },
  capability: { type: 'string' },
  at: { type: 'string' },
  usage: { type: 'string' },
  'key-env': { type: 'string' },
  help: { type: 'boolean', short: 'h', default: false },
} as const;

/** De dónde lee la pasarela la clave que el cliente presenta, si nadie dice otra cosa. */
const DEFAULT_KEY_ENV = 'MCPIZER_API_KEY';

class UsageError extends Error {}

function required(value: string | undefined, flag: string): string {
  if (value === undefined || value === '') throw new UsageError(`Falta \`${flag}\`.`);
  return value;
}

function parseAttributes(pairs: readonly string[] | undefined): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const pair of pairs ?? []) {
    const separator = pair.indexOf('=');
    if (separator <= 0) throw new UsageError(`\`--attr ${pair}\` no tiene la forma clave=valor.`);
    attributes[pair.slice(0, separator)] = pair.slice(separator + 1);
  }
  return attributes;
}

/** El instante lo captura la cáscara, y por defecto es ahora. */
function parseInstant(value: string | undefined): Instant {
  if (value === undefined) return Date.now();
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new UsageError(`\`--at ${value}\` no es un instante ISO-8601.`);
  return parsed;
}

/**
 * Uso desconocido se trata como techo agotado, así que no puede ser el defecto
 * de una herramienta de diagnóstico: `explain` denegaría siempre y no serviría
 * para nada. El defecto es cero, y `--usage unknown` deja ejercitar la regla
 * (decisión 0014).
 */
function parseUsage(value: string | undefined, at: Instant): Usage {
  if (value === undefined || value === '0') return { kind: 'counted', calls: 0, windowStart: at };
  if (value === 'unknown') return { kind: 'unknown' };
  if (value === 'none') return { kind: 'not-consulted' };
  const calls = Number(value);
  if (!Number.isInteger(calls) || calls < 0) {
    throw new UsageError(`\`--usage ${value}\` no es un entero, ni \`unknown\`, ni \`none\`.`);
  }
  return { kind: 'counted', calls, windowStart: at };
}

async function load(path: string, catalogPath: string | undefined): Promise<LoadedPolicy> {
  const source: PolicySource = policyFile(path);
  const catalog: CatalogSource | undefined =
    catalogPath === undefined ? undefined : declaredCatalogFile(catalogPath);
  return loadPolicy(source, catalog);
}

/**
 * La pasarela.
 *
 * Es el único sitio donde se comprueba que los adaptadores cumplen los
 * contratos: `adapters/` no puede importar `runtime/` —sería un ciclo entre
 * paquetes—, así que la conformidad se verifica aquí, al asignar cada uno a una
 * variable del tipo de su puerto. El tipado estructural hace que eso sea una
 * comprobación real y no un gesto.
 */
async function serve(artifactPath: string, values: { catalog?: string; issuer?: string; 'key-env'?: string }): Promise<number> {
  const catalogPath = required(values.catalog, '--catalog');
  const issuerId = required(values.issuer, '--issuer');
  const keyEnv = values['key-env'] ?? DEFAULT_KEY_ENV;

  const loaded = await load(artifactPath, catalogPath);
  if (loaded.policy === undefined) {
    print([
      'La política no compila; no hay pasarela que levantar.',
      '',
      ...renderDiagnostics(loaded.artifact.origin, loaded.diagnostics),
    ]);
    return 1;
  }

  // Solo los emisores que declaran sujeto y clave pueden autenticar a alguien.
  // Los demás no son un error de autoría —el enganche con la periferia es
  // opcional— pero tampoco sirven aquí, y decirlo al arrancar es mejor que
  // dejar que el primer cliente se estrelle contra `issuer_unknown`.
  const usable: StaticKeyIssuer[] = loaded.policy.issuers.flatMap((issuer) =>
    issuer.kind === 'static-key' && issuer.subject !== undefined && issuer.secretRef !== undefined
      ? [{ id: issuer.id, subject: issuer.subject, secretRef: issuer.secretRef, attributes: issuer.attributes }]
      : [],
  );
  if (!usable.some((issuer) => issuer.id === issuerId)) {
    throw new UsageError(
      `\`--issuer ${issuerId}\` no es un emisor \`static-key\` con \`subject\` y \`secret\` declarados. ` +
        `Los que sí lo son: ${usable.length === 0 ? 'ninguno' : usable.map((issuer) => issuer.id).join(', ')}.`,
    );
  }

  const invoker: ToolInvoker = mcpStdioInvoker();
  const usage = memoryUsage();
  const ports: GatewayPorts = {
    principals: staticKeyPrincipals(usable) satisfies PrincipalResolver,
    usageReader: usage satisfies UsageReader,
    usageWriter: usage satisfies UsageWriter,
    credentials: envCredentials() satisfies CredentialResolver,
    invoker,
    recorder: stderrRecorder() satisfies DecisionRecorder,
    // El reloj vive aquí, en la cáscara. El instante entra en la decisión como
    // un hecho más, que es la razón de que no exista un puerto `Clock`.
    now: () => Date.now(),
  };

  const door = gateway(loaded, ports);

  /**
   * stdio no tiene cabeceras: el canal por el que llega la credencial es el
   * entorno del proceso que el cliente arranca. Se lee en cada petición y no se
   * guarda en ninguna parte.
   */
  const credentials = (): TransportCredentials => ({
    issuer: issuerId,
    presented: process.env[keyEnv] ?? '',
  });

  const running = await mcpStdioServer({ name: 'mcpizer', version: '0.0.0' }, {
    async listTools() {
      const outcome = await door.list(credentials());
      // Sin identidad no se anuncia nada. Lo no concedido no se marca como
      // prohibido: no sale (invariante 3).
      return outcome.kind === 'listed' ? outcome.tools : [];
    },
    async callTool(name, args) {
      const outcome = await door.call(credentials(), name, args);
      if (outcome.kind === 'invoked') return outcome.result;
      return {
        content: [{ type: 'text', text: renderCallOutcome(loaded.artifact.origin, outcome) }],
        isError: true,
      };
    },
  });

  await running.closed;
  await invoker.close();
  return 0;
}

function print(lines: readonly string[]): void {
  process.stdout.write(`${lines.join('\n')}\n`);
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function run(argv: readonly string[]): Promise<number> {
  const { values, positionals } = parseArgs({ args: [...argv], options: OPTIONS, allowPositionals: true });
  const command = positionals[0];

  if (values.help || command === undefined || command === 'help') {
    print([USAGE]);
    return command === undefined && !values.help ? 2 : 0;
  }

  if (command === 'schema') {
    printJson(schema);
    return 0;
  }

  const artifactPath = required(positionals[1], '<politica.yaml>');

  if (command === 'validate') {
    const loaded = await load(artifactPath, values.catalog);
    if (values.json) {
      printJson({ origin: loaded.artifact.origin, version: loaded.artifact.version, diagnostics: loaded.diagnostics });
    } else if (loaded.diagnostics.length === 0) {
      print([`${loaded.artifact.origin}: sin hallazgos. La política compila y es coherente.`]);
    } else {
      print(renderDiagnostics(loaded.artifact.origin, loaded.diagnostics));
    }
    return hasErrors(loaded.diagnostics) ? 1 : 0;
  }

  if (command === 'explain') {
    const loaded = await load(artifactPath, values.catalog);
    if (loaded.policy === undefined) {
      print(['La política no compila; no hay nada que explicar todavía.', '', ...renderDiagnostics(loaded.artifact.origin, loaded.diagnostics)]);
      return 1;
    }
    const at = parseInstant(values.at);
    const explanation = explain(loaded, {
      issuer: required(values.issuer, '--issuer'),
      subject: required(values.subject, '--subject'),
      attributes: parseAttributes(values.attr),
      capability: required(values.capability, '--capability'),
      at,
      usage: parseUsage(values.usage, at),
    });
    if (values.json) printJson(explanation);
    else print(renderExplanation(loaded.artifact.origin, explanation));
    return 0;
  }

  if (command === 'who-can') {
    const loaded = await load(artifactPath, values.catalog);
    const report = whoCan(loaded, required(values.capability, '--capability'));
    if (report === undefined) {
      print(['La política no compila; la consulta inversa necesita un modelo evaluable.', '', ...renderDiagnostics(loaded.artifact.origin, loaded.diagnostics)]);
      return 1;
    }
    if (values.json) printJson(report);
    else print(renderReach(loaded.artifact.origin, report));
    return 0;
  }

  if (command === 'diff') {
    const afterPath = required(positionals[2], '<despues.yaml>');
    const [before, after] = await Promise.all([
      load(artifactPath, values.catalog),
      load(afterPath, values.catalog),
    ]);
    const changes = effectiveDiff(before, after, parseInstant(values.at));
    if (values.json) printJson({ before: before.artifact.version, after: after.artifact.version, changes });
    else print(renderDiff(changes));
    return changes.length === 0 ? 0 : 1;
  }

  if (command === 'serve') return serve(artifactPath, values);

  throw new UsageError(`\`${command}\` no es un comando. Prueba \`mcpizer help\`.`);
}

try {
  process.exitCode = await run(process.argv.slice(2));
} catch (error) {
  if (error instanceof UsageError) {
    process.stderr.write(`${error.message}\n\n${USAGE}\n`);
    process.exitCode = 2;
  } else {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 3;
  }
}
