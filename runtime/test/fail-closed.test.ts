/**
 * `docs/diseno/verificacion.md` §3.2 y §3.3, sobre artefactos generados.
 *
 * Las propiedades de `access/test/properties.test.ts` se afirman sobre modelos
 * evaluables construidos a mano. Estas se afirman sobre **artefactos completos**
 * —texto YAML, esquema, compilación y cableado incluidos—, que es donde se
 * comprueba lo que aquellas no pueden: que el `path` de un motivo resuelve a una
 * posición real *del documento*.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { evaluate, type PrincipalView } from '@mcpizer/access';
import { compile } from '@mcpizer/policy';
import { seenBy, wire, type LoadedPolicy } from '../src/index.js';

const CAPABILITIES = ['cap.one', 'cap.two', 'cap.three'];
const ACCOUNTS = ['cuenta-a', 'cuenta-b'];
const ISSUERS = ['emisor-a', 'emisor-b'];
const ATTRIBUTE_NAMES = ['team', 'role'];

const attributeValue = fc.constantFrom('uno', 'dos');
const selector = fc.dictionary(fc.constantFrom(...ATTRIBUTE_NAMES), attributeValue, { maxKeys: 2 });

const arbitraryArtifact = fc
  .record({
    declared: fc.uniqueArray(fc.constantFrom(...CAPABILITIES), { minLength: 1 }),
    mapped: fc.uniqueArray(fc.constantFrom(...CAPABILITIES)),
    disabled: fc.uniqueArray(fc.constantFrom(...ACCOUNTS)),
    grants: fc.array(
      fc.record({
        issuer: fc.constantFrom(...ISSUERS),
        attributes: selector,
        capabilities: fc.uniqueArray(fc.constantFrom(...CAPABILITIES), { minLength: 1 }),
        using: fc.constantFrom(...ACCOUNTS),
        limits: fc.option(fc.record({ calls: fc.integer({ min: 0, max: 5 }), per: fc.constant('1h') }), {
          nil: undefined,
        }),
      }),
      { maxLength: 4 },
    ),
  })
  .map(({ declared, mapped, disabled, grants }) => ({
    version: 1,
    capabilities: declared.map((id) => ({ id })),
    upstreams: [
      {
        id: 'arriba',
        transport: { kind: 'mcp-stdio', command: 'servidor' },
        // Solo se mapean capacidades declaradas: un artefacto generado tiene que
        // ser válido, o la propiedad no diría nada sobre configuraciones reales.
        tools: mapped
          .filter((capability) => declared.includes(capability))
          .map((capability, index) => ({ name: `tool_${index}`, capability })),
      },
    ],
    accounts: ACCOUNTS.map((id) => ({
      id,
      disabled: disabled.includes(id),
      secret: { ref: `env://${id}` },
    })),
    principals: {
      issuers: ISSUERS.map((id) => ({
        id,
        kind: 'static-key',
        attributes: Object.fromEntries(ATTRIBUTE_NAMES.map((name) => [name, 'uno'])),
      })),
    },
    grants: grants
      .filter((grant) => grant.capabilities.every((capability) => declared.includes(capability)))
      .map((grant) => ({
        to: { issuer: grant.issuer, attributes: grant.attributes },
        capabilities: grant.capabilities,
        using: grant.using,
        ...(grant.limits === undefined ? {} : { limits: grant.limits }),
      })),
  }));

const arbitraryPrincipal: fc.Arbitrary<PrincipalView> = fc
  .record({ issuer: fc.constantFrom(...ISSUERS), attributes: selector })
  .map((raw) => ({ id: `${raw.issuer}:sujeto`, ...raw }));

const scenario = fc.record({
  artifact: arbitraryArtifact,
  principal: arbitraryPrincipal,
  capability: fc.constantFrom(...CAPABILITIES),
  at: fc.integer({ min: 0, max: 10_000_000 }),
});

type Scenario = { artifact: unknown; principal: PrincipalView; capability: string; at: number };

/** Compila y cablea, o devuelve `undefined` si el artefacto es legítimamente ambiguo. */
function load(artifact: unknown): Pick<LoadedPolicy, 'document' | 'policy' | 'wiring'> | undefined {
  const result = compile(stringify(artifact));
  if (result.policy === undefined) {
    // El generador puede producir ambigüedad sobre la cuenta, que es un error de
    // autoría legítimo. Cualquier otro error significaría que el generador
    // produce artefactos inválidos y la propiedad no estaría diciendo nada.
    const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
    expect(errors.map((diagnostic) => diagnostic.code)).toEqual(errors.map(() => 'ambiguous_grant'));
    return undefined;
  }
  return { document: result.document, policy: result.policy, wiring: wire(result.policy) };
}

describe('sobre artefactos válidos arbitrarios', () => {
  it('ninguna capacidad no concedida produce jamás un permiso', () => {
    fc.assert(
      fc.property(scenario, ({ artifact, principal, capability, at }: Scenario) => {
        const loaded = load(artifact);
        if (loaded?.wiring === undefined) return true;
        const decision = evaluate({ principal, capability, at, usage: { kind: 'not-consulted' } }, loaded.wiring.ruleset);
        if (decision.outcome !== 'allow') return true;
        return loaded.wiring.ruleset.grants.some(
          (grant) =>
            grant.capabilities.includes(capability) &&
            grant.issuer === principal.issuer &&
            Object.entries(grant.attributes).every(([name, value]) => principal.attributes[name] === value),
        );
      }),
      { numRuns: 500 },
    );
  });

  it('ninguna tool sin mapeo aparece jamás en un catálogo', () => {
    fc.assert(
      fc.property(scenario, ({ artifact, principal, at }: Scenario) => {
        const loaded = load(artifact);
        if (loaded?.wiring === undefined) return true;
        const unmapped = new Set(loaded.wiring.catalog.unmapped.map((tool) => `${tool.upstreamId}/${tool.name}`));
        const seen = seenBy({ ...loaded, artifact: { text: '', version: '', origin: '' }, diagnostics: [] }, principal, at);
        return seen.every((tool) => !unmapped.has(`${tool.upstreamId}/${tool.name}`));
      }),
      { numRuns: 500 },
    );
  });

  it('el `path` de toda decisión resuelve a una posición real del documento', () => {
    fc.assert(
      fc.property(scenario, ({ artifact, principal, capability, at }: Scenario) => {
        const loaded = load(artifact);
        if (loaded?.wiring === undefined || loaded.document === undefined) return true;
        const decision = evaluate({ principal, capability, at, usage: { kind: 'not-consulted' } }, loaded.wiring.ruleset);
        const position = loaded.document.resolve(decision.reason.path);
        return position !== undefined && position.line > 0 && position.column > 0;
      }),
      { numRuns: 500 },
    );
  });

  it('un artefacto sin concesiones lo deniega todo', () => {
    fc.assert(
      fc.property(scenario, ({ artifact, principal, capability, at }: Scenario) => {
        const empty = { ...(artifact as Record<string, unknown>), grants: [] };
        const loaded = load(empty);
        if (loaded?.wiring === undefined) return true;
        return (
          evaluate({ principal, capability, at, usage: { kind: 'not-consulted' } }, loaded.wiring.ruleset).outcome ===
          'deny'
        );
      }),
      { numRuns: 300 },
    );
  });
});
