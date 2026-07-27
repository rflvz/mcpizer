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
import { declaredCatalogFile, policyFile } from '@mcpizer/adapters';
import { hasErrors, schema } from '@mcpizer/policy';
import type { Instant, Usage } from '@mcpizer/access';
import {
  effectiveDiff,
  explain,
  loadPolicy,
  whoCan,
  type CatalogSource,
  type LoadedPolicy,
  type PolicySource,
} from '../index.js';
import { renderDiagnostics, renderDiff, renderExplanation, renderReach } from './render.js';

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
  help: { type: 'boolean', short: 'h', default: false },
} as const;

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
