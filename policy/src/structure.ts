/**
 * Validación estructural contra el JSON Schema.
 *
 * El esquema es la mitad barata de la validación y, sobre todo, es el artefacto
 * que da autocompletado en los editores: `docs/diseno/artefacto.md` §1 lo elige
 * por eso y porque es el mismo vocabulario de esquemas que MCP usa para las
 * tools. Lo que el esquema no puede expresar vive en `integrity.ts`.
 */
import { Validator } from '@cfworker/json-schema';
import policySchema from './schema/mcpizer-policy.schema.json' with { type: 'json' };
import type { Diagnostic } from './diagnostics.js';
import type { PolicyDocument } from './document.js';

/** El esquema publicado, para que la CLI pueda emitirlo y un editor consumirlo. */
export const schema: unknown = policySchema;

const validator = new Validator(policySchema as ConstructorParameters<typeof Validator>[0], '2020-12');

export function validateStructure(document: PolicyDocument): readonly Diagnostic[] {
  const outcome = validator.validate(document.value);
  if (outcome.valid) return [];

  // Un fallo de esquema se reporta también en cada nivel que lo contiene, hasta
  // la raíz. Lo accionable es siempre lo más profundo, así que va primero: el
  // configurador quiere el campo, no "el documento no valida".
  const byDepth = [...outcome.errors].sort(
    (one, other) => other.instanceLocation.split('/').length - one.instanceLocation.split('/').length,
  );

  const seen = new Set<string>();
  const diagnostics: Diagnostic[] = [];
  for (const failure of byDepth) {
    const path = failure.instanceLocation.startsWith('#')
      ? failure.instanceLocation.slice(1)
      : failure.instanceLocation;
    const key = `${path}|${failure.error}`;
    if (seen.has(key)) continue;
    seen.add(key);
    diagnostics.push({
      severity: 'error',
      code: 'schema_violation',
      message: failure.error,
      path,
      position: document.resolve(path),
      related: [],
    });
  }
  return diagnostics;
}
