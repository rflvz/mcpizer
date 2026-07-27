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
  catalogFor,
  mcpHttpServer,
  mcpStdioServer,
  periphery,
  policySourceFor,
  type CatalogPeriphery,
  type DeclaredUpstream,
  type GatewayHandlers,
  type Periphery,
  type PeripheryIssuer,
  type PresentedCredentials,
  type RecorderChoice,
  type RunningServer,
  type UsageChoice,
  type VaultAccess,
} from '@mcpizer/adapters';
import { hasErrors, schema, type CompiledPolicy } from '@mcpizer/policy';
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

  <politica> es una ruta, o \`git+<url>#<ref>:<ruta>\` para leerla de un repositorio
  a una referencia fija — que es el modo esperado en cuanto se revisa por PR.

  mcpizer validate <politica> [--catalog <catalogo.yaml>] [--json]
      Estructura, referencias colgantes, concesiones ambiguas y capacidades que
      ninguna tool realiza. Es lo que corre en CI sobre el PR que toca la política.

  mcpizer explain <politica> --issuer <id> --subject <s> --capability <id>
                  [--attr clave=valor]... [--at <ISO-8601>] [--usage <n|unknown|none>]
                  [--catalog <catalogo.yaml>] [--json]
      La decisión completa con su motivo y el sitio exacto a tocar.

  mcpizer who-can <politica> --capability <id> [--catalog <catalogo.yaml>] [--json]
      Quién llega a una capacidad y con qué cuenta. La pregunta de auditoría real.

  mcpizer diff <antes> <despues> [--at <ISO-8601>] [--catalog <catalogo.yaml>] [--json]
      Qué decisiones cambian. Un diff de texto no lo dice.

  mcpizer schema
      El JSON Schema del artefacto, para editores y validadores externos.

  mcpizer serve <politica> --issuer <id> (--catalog <catalogo.yaml> | --discover)
                [--key-env <VAR>] [--http [--port <n>] [--key-header <cabecera>]]
                [--usage <redis://…>] [--recorder <stderr|otlp>] [--otlp-endpoint <url>]
      La pasarela MCP. Un cliente ve solo lo concedido a la identidad con la que
      se conecta, e invocar una tool no listada deniega con motivo.

      Por stdio la clave se presenta por entorno, porque stdio no tiene
      cabeceras; con --http llega por cabecera y **por petición**, que es lo que
      permite que dos identidades distintas compartan puerto.

      Qué implementación atiende a cada emisor, upstream y cuenta lo dice el
      propio artefacto: \`kind\`, \`transport.kind\` y el esquema de \`secret.ref\`.
      La bóveda se declara con VAULT_ADDR y VAULT_TOKEN.

Códigos de salida: 0 sin hallazgos · 1 hallazgos · 2 uso incorrecto · 3 origen inalcanzable.`;

const OPTIONS = {
  catalog: { type: 'string' },
  discover: { type: 'boolean', default: false },
  json: { type: 'boolean', default: false },
  issuer: { type: 'string' },
  subject: { type: 'string' },
  attr: { type: 'string', multiple: true },
  capability: { type: 'string' },
  at: { type: 'string' },
  usage: { type: 'string' },
  'key-env': { type: 'string' },
  http: { type: 'boolean', default: false },
  port: { type: 'string' },
  'key-header': { type: 'string' },
  recorder: { type: 'string' },
  'otlp-endpoint': { type: 'string' },
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

async function load(specifier: string, catalog: CatalogSource | undefined): Promise<LoadedPolicy> {
  const source: PolicySource = policySourceFor(specifier);
  return loadPolicy(source, catalog);
}

/** Con `--catalog`, el catálogo declarado; sin él, nada, que es la verificación en seco pura. */
function declaredCatalog(catalogPath: string | undefined): CatalogPeriphery | undefined {
  return catalogPath === undefined ? undefined : catalogFor({ kind: 'declared', path: catalogPath });
}

/**
 * `discovery` y `audience` de cada emisor, sacados del **documento**.
 *
 * El modelo compilado de `policy` no los lleva: son enganche con la periferia, y
 * la verificación en seco solo les comprueba integridad referencial. Ampliarlo
 * cambiaría el retrato de superficie de `policy`, que es exactamente lo que el
 * criterio de S3 promete no tocar (decisión 0029).
 *
 * La traducción vive aquí, en la cáscara, por la misma razón por la que
 * `wiring.ts` traduce el artefacto para el núcleo: es el único sitio que conoce
 * a la vez el vocabulario del artefacto y el de la periferia.
 */
function oidcEndpoints(document: unknown): Map<string, { discovery?: string; audience?: string }> {
  const endpoints = new Map<string, { discovery?: string; audience?: string }>();
  const issuers = (document as { principals?: { issuers?: unknown } } | null)?.principals?.issuers;
  if (!Array.isArray(issuers)) return endpoints;

  for (const raw of issuers as { id?: unknown; discovery?: unknown; audience?: unknown }[]) {
    if (typeof raw.id !== 'string') continue;
    endpoints.set(raw.id, {
      ...(typeof raw.discovery === 'string' ? { discovery: raw.discovery } : {}),
      ...(typeof raw.audience === 'string' ? { audience: raw.audience } : {}),
    });
  }
  return endpoints;
}

function peripheryIssuers(policy: CompiledPolicy, document: unknown): PeripheryIssuer[] {
  const endpoints = oidcEndpoints(document);
  return policy.issuers.map((issuer) => {
    const extra = endpoints.get(issuer.id);
    return {
      id: issuer.id,
      kind: issuer.kind,
      subject: issuer.subject,
      secretRef: issuer.secretRef,
      attributes: issuer.attributes,
      discovery: extra?.discovery,
      audience: extra?.audience,
    };
  });
}

function upstreamsOf(policy: CompiledPolicy): DeclaredUpstream[] {
  return policy.upstreams.map((upstream) => ({ id: upstream.id, transport: upstream.transport }));
}

/** La bóveda no se declara en el artefacto: es un hecho del despliegue. */
function vaultAccess(): VaultAccess | undefined {
  const address = process.env['VAULT_ADDR'];
  const token = process.env['VAULT_TOKEN'];
  return address === undefined || address === '' || token === undefined || token === ''
    ? undefined
    : { address, token };
}

function usageChoice(value: string | undefined): UsageChoice {
  if (value === undefined || value === '' || value === 'memory') return { kind: 'memory' };
  if (value.startsWith('redis://') || value.startsWith('rediss://')) return { kind: 'redis', url: value };
  throw new UsageError(`\`--usage ${value}\` no es \`memory\` ni una URL \`redis://\`.`);
}

function recorderChoice(kind: string | undefined, endpoint: string | undefined): RecorderChoice {
  if (kind === undefined || kind === 'stderr') return { kind: 'stderr' };
  if (kind !== 'otlp') throw new UsageError(`\`--recorder ${kind}\` no es \`stderr\` ni \`otlp\`.`);

  const target = endpoint ?? process.env['OTEL_EXPORTER_OTLP_ENDPOINT'];
  if (target === undefined || target === '') {
    throw new UsageError('`--recorder otlp` necesita `--otlp-endpoint` o `OTEL_EXPORTER_OTLP_ENDPOINT`.');
  }
  return { kind: 'otlp', endpoint: target };
}

interface ServeValues {
  catalog?: string | undefined;
  discover?: boolean | undefined;
  issuer?: string | undefined;
  'key-env'?: string | undefined;
  http?: boolean | undefined;
  port?: string | undefined;
  'key-header'?: string | undefined;
  usage?: string | undefined;
  recorder?: string | undefined;
  'otlp-endpoint'?: string | undefined;
}

/**
 * La pasarela.
 *
 * Es el único sitio donde se comprueba que los adaptadores cumplen los
 * contratos: `adapters/` no puede importar `runtime/` —sería un ciclo entre
 * paquetes—, así que la conformidad se verifica aquí, al asignar cada uno a una
 * variable del tipo de su puerto. El tipado estructural hace que eso sea una
 * comprobación real y no un gesto, y con dos implementaciones por puerto es
 * además la comprobación de que las dos encajan en el mismo hueco.
 */
async function serve(artifactPath: string, values: ServeValues): Promise<number> {
  const issuerId = required(values.issuer, '--issuer');
  const keyEnv = values['key-env'] ?? DEFAULT_KEY_ENV;

  if (values.catalog === undefined && values.discover !== true) {
    throw new UsageError('Falta `--catalog <catalogo.yaml>` o `--discover`.');
  }
  if (values.catalog !== undefined && values.discover === true) {
    throw new UsageError('`--catalog` y `--discover` son dos orígenes del catálogo; hay que elegir uno.');
  }

  // El descubrimiento necesita saber qué upstreams hay, y eso solo lo dice la
  // política compilada — que a su vez quiere el catálogo para comprobar el
  // mapeo. Se rompe el bucle compilando primero sin catálogo: es una lectura
  // más del artefacto al arrancar, y a cambio ningún contrato se entera.
  let catalog: CatalogPeriphery | undefined = declaredCatalog(values.catalog);
  if (values.discover === true) {
    const preliminar = await load(artifactPath, undefined);
    if (preliminar.policy === undefined) {
      print([
        'La política no compila; no hay upstreams a los que preguntar.',
        '',
        ...renderDiagnostics(preliminar.artifact.origin, preliminar.diagnostics),
      ]);
      return 1;
    }
    catalog = catalogFor({ kind: 'discover', upstreams: upstreamsOf(preliminar.policy) });
  }

  const loaded = await load(artifactPath, catalog);
  if (loaded.policy === undefined) {
    await catalog?.close();
    print([
      'La política no compila; no hay pasarela que levantar.',
      '',
      ...renderDiagnostics(loaded.artifact.origin, loaded.diagnostics),
    ]);
    return 1;
  }

  const outside: Periphery = periphery({
    issuers: peripheryIssuers(loaded.policy, loaded.document?.value),
    upstreams: upstreamsOf(loaded.policy),
    usage: usageChoice(values.usage),
    recorder: recorderChoice(values.recorder, values['otlp-endpoint']),
    ...(vaultAccess() === undefined ? {} : { vault: vaultAccess() as VaultAccess }),
  });

  // Un emisor que no declara su fontanería no autentica a nadie. No es un error
  // de autoría —el enganche con la periferia es opcional (decisión 0017)— pero
  // tampoco sirve aquí, y decirlo al arrancar es mejor que dejar que el primer
  // cliente se estrelle contra `issuer_unknown`.
  if (!outside.usableIssuers.includes(issuerId)) {
    await outside.close();
    await catalog?.close();
    throw new UsageError(
      `\`--issuer ${issuerId}\` no declara con qué autenticar: un emisor \`static-key\` necesita ` +
        '`subject` y `secret`, y uno `oidc` necesita `discovery`. ' +
        `Los que sí sirven: ${outside.usableIssuers.length === 0 ? 'ninguno' : outside.usableIssuers.join(', ')}.`,
    );
  }

  const ports: GatewayPorts = {
    principals: outside.principals satisfies PrincipalResolver,
    usageReader: outside.usageReader satisfies UsageReader,
    usageWriter: outside.usageWriter satisfies UsageWriter,
    credentials: outside.credentials satisfies CredentialResolver,
    invoker: outside.invoker satisfies ToolInvoker,
    recorder: outside.recorder satisfies DecisionRecorder,
    // El reloj vive aquí, en la cáscara. El instante entra en la decisión como
    // un hecho más, que es la razón de que no exista un puerto `Clock`.
    now: () => Date.now(),
  };

  const door = gateway(loaded, ports);

  const handlers: GatewayHandlers = {
    async listTools(credentials: PresentedCredentials) {
      const outcome = await door.list(credentials satisfies TransportCredentials);
      // Sin identidad no se anuncia nada. Lo no concedido no se marca como
      // prohibido: no sale (invariante 3).
      return outcome.kind === 'listed' ? outcome.tools : [];
    },
    async callTool(credentials: PresentedCredentials, name, args) {
      const outcome = await door.call(credentials satisfies TransportCredentials, name, args);
      if (outcome.kind === 'invoked') return outcome.result;
      return {
        content: [{ type: 'text', text: renderCallOutcome(loaded.artifact.origin, outcome) }],
        isError: true,
      };
    },
  };

  const info = { name: 'mcpizer', version: '0.0.0' };
  let running: RunningServer;

  if (values.http === true) {
    const port = values.port === undefined ? 0 : Number(values.port);
    if (!Number.isInteger(port) || port < 0 || port > 65_535) {
      throw new UsageError(`\`--port ${String(values.port)}\` no es un puerto.`);
    }
    const http = await mcpHttpServer(info, handlers, {
      issuer: issuerId,
      port,
      ...(values['key-header'] === undefined ? {} : { header: values['key-header'] }),
    });
    // Por HTTP el proceso no termina cuando un cliente se va: los clientes van y
    // vienen. Lo dice al arrancar y se queda escuchando.
    process.stderr.write(`mcpizer escucha en http://127.0.0.1:${http.port}/mcp\n`);
    running = http;
  } else {
    /**
     * stdio no tiene cabeceras: el canal por el que llega la credencial es el
     * entorno del proceso que el cliente arranca. Se lee en cada petición y no
     * se guarda en ninguna parte.
     */
    running = await mcpStdioServer(info, handlers, () => ({
      issuer: issuerId,
      presented: process.env[keyEnv] ?? '',
    }));
  }

  await running.closed;
  await outside.close();
  await catalog?.close();
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
    const loaded = await load(artifactPath, declaredCatalog(values.catalog));
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
    const loaded = await load(artifactPath, declaredCatalog(values.catalog));
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
    const loaded = await load(artifactPath, declaredCatalog(values.catalog));
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
      load(artifactPath, declaredCatalog(values.catalog)),
      load(afterPath, declaredCatalog(values.catalog)),
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
