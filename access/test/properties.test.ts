/**
 * `docs/diseno/verificacion.md` §3.2 y §3.3 — fallo cerrado y explicabilidad
 * como propiedades universales.
 *
 * Se apoyan en que el núcleo es puro: generar miles de casos es barato cuando la
 * evaluación es una función de datos a datos sin E/S, y ninguno necesita un
 * doble.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { evaluate, visible } from '../src/index.js';
import type { Decision, GrantView, PrincipalView, ReasonCode, Ruleset, Usage } from '../src/index.js';

const REASON_CODES: readonly ReasonCode[] = [
  'granted',
  'capability_not_declared',
  'capability_not_realized',
  'no_grant_matches',
  'ambiguous_grant',
  'account_disabled',
  'usage_unknown',
  'limit_exhausted',
];

const identifier = fc.constantFrom('a', 'b', 'c', 'd');
const capabilityId = fc.constantFrom('cap.one', 'cap.two', 'cap.three');

const attributes = fc.dictionary(fc.constantFrom('team', 'role'), identifier, { maxKeys: 2 });

const arbitraryGrant = fc.record({
  issuer: identifier,
  attributes,
  capabilities: fc.uniqueArray(capabilityId, { minLength: 1, maxLength: 3 }),
  account: fc.record({ id: identifier, disabled: fc.boolean() }),
  limits: fc.option(
    fc.record({ calls: fc.integer({ min: 0, max: 10 }), per: fc.constant('1h'), windowMs: fc.constant(3_600_000) }),
    { nil: undefined },
  ),
  path: fc.integer({ min: 0, max: 9 }).map((index) => `/grants/${index}`),
});

const arbitraryRuleset: fc.Arbitrary<Ruleset> = fc
  .record({
    capabilities: fc.uniqueArray(
      fc.record({ id: capabilityId, realized: fc.boolean() }),
      { maxLength: 3, selector: (entry) => entry.id },
    ),
    grants: fc.array(arbitraryGrant, { maxLength: 5 }),
  })
  .map(({ capabilities, grants }) => ({
    capabilities: capabilities.map((capability) => ({ ...capability, path: `/capabilities/${capability.id}` })),
    grants: grants as GrantView[],
    anchors: { capabilities: '/capabilities', grants: '/grants' },
  }));

const arbitraryPrincipal: fc.Arbitrary<PrincipalView> = fc
  .record({ issuer: identifier, attributes })
  .map((raw) => ({ id: `${raw.issuer}:sujeto`, ...raw }));

const arbitraryUsage: fc.Arbitrary<Usage> = fc.oneof(
  fc.constant<Usage>({ kind: 'not-consulted' }),
  fc.constant<Usage>({ kind: 'unknown' }),
  fc.record({ calls: fc.integer({ min: 0, max: 20 }), windowStart: fc.constant(0) }).map<Usage>((raw) => ({
    kind: 'counted',
    ...raw,
  })),
);

const scenario = fc.record({
  ruleset: arbitraryRuleset,
  principal: arbitraryPrincipal,
  capability: capabilityId,
  at: fc.integer({ min: 0, max: 10_000_000 }),
  usage: arbitraryUsage,
});

function decide(sample: { ruleset: Ruleset; principal: PrincipalView; capability: string; at: number; usage: Usage }): Decision {
  const { ruleset, ...invocation } = sample;
  return evaluate(invocation, ruleset);
}

describe('fallo cerrado', () => {
  it('ninguna capacidad no concedida aparece jamás en un permiso', () => {
    fc.assert(
      fc.property(scenario, (sample) => {
        const decision = decide(sample);
        if (decision.outcome !== 'allow') return true;
        return sample.ruleset.grants.some(
          (grant) =>
            grant.capabilities.includes(sample.capability) &&
            grant.issuer === sample.principal.issuer &&
            Object.entries(grant.attributes).every(
              ([name, value]) => sample.principal.attributes[name] === value,
            ),
        );
      }),
      { numRuns: 2000 },
    );
  });

  it('ninguna capacidad no declarada, o no realizada, aparece jamás en un permiso', () => {
    fc.assert(
      fc.property(scenario, (sample) => {
        const decision = decide(sample);
        if (decision.outcome !== 'allow') return true;
        const declared = sample.ruleset.capabilities.find((entry) => entry.id === sample.capability);
        return declared !== undefined && declared.realized;
      }),
      { numRuns: 2000 },
    );
  });

  it('un permiso nunca sale de una cuenta deshabilitada', () => {
    fc.assert(
      fc.property(scenario, (sample) => {
        const decision = decide(sample);
        return decision.outcome !== 'allow' || !decision.account.disabled;
      }),
      { numRuns: 2000 },
    );
  });

  it('lo visible es exactamente lo que la decisión permite', () => {
    fc.assert(
      fc.property(scenario, (sample) => {
        const seen = new Set(visible(sample.principal, sample.ruleset, sample.at).map((entry) => entry.capability.id));
        return sample.ruleset.capabilities.every((capability) => {
          const allowed =
            evaluate(
              {
                principal: sample.principal,
                capability: capability.id,
                at: sample.at,
                usage: { kind: 'not-consulted' },
              },
              sample.ruleset,
            ).outcome === 'allow';
          return seen.has(capability.id) === allowed;
        });
      }),
      { numRuns: 1000 },
    );
  });
});

describe('explicabilidad', () => {
  it('toda decisión —permiso incluido— lleva motivo del vocabulario cerrado y con sitio', () => {
    fc.assert(
      fc.property(scenario, (sample) => {
        const { reason } = decide(sample);
        return REASON_CODES.includes(reason.code) && reason.path !== '';
      }),
      { numRuns: 2000 },
    );
  });

  it('el sitio de un permiso es siempre la concesión que lo justifica', () => {
    fc.assert(
      fc.property(scenario, (sample) => {
        const decision = decide(sample);
        return decision.outcome !== 'allow' || sample.ruleset.grants.some((grant) => grant.path === decision.reason.path);
      }),
      { numRuns: 2000 },
    );
  });
});

describe('determinismo', () => {
  it('los mismos hechos producen la misma decisión, siempre', () => {
    fc.assert(
      fc.property(scenario, (sample) => {
        expect(decide(sample)).toEqual(decide(sample));
      }),
      { numRuns: 500 },
    );
  });

  it('reordenar las concesiones no cambia ninguna decisión', () => {
    fc.assert(
      fc.property(scenario, (sample) => {
        const reversed: Ruleset = { ...sample.ruleset, grants: [...sample.ruleset.grants].reverse() };
        const one = decide(sample);
        const other = decide({ ...sample, ruleset: reversed });
        // El `path` señala una de varias concesiones equivalentes, y cuál sea
        // depende del orden. El resultado —y la cuenta contra la que se
        // ejecutaría— no dependen de él, que es lo que importa.
        if (one.outcome !== other.outcome || one.reason.code !== other.reason.code) return false;
        if (one.outcome !== 'allow' || other.outcome !== 'allow') return true;
        return one.account.id === other.account.id && JSON.stringify(one.limits) === JSON.stringify(other.limits);
      }),
      { numRuns: 2000 },
    );
  });
});
