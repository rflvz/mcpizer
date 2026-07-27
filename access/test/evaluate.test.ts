/**
 * `access` es una función de datos a datos, así que estos tests son datos de
 * entrada y una aserción sobre la salida. Ni un doble: si probar esto empezara a
 * necesitar simular algo, el invariante 2 estaría roto
 * (`docs/diseno/verificacion.md` §2.4.3).
 */
import { describe, expect, it } from 'vitest';
import { evaluate, reach, visible } from '../src/index.js';
import type { GrantView, PrincipalView, Ruleset, Usage } from '../src/index.js';

const ANCHORS = { capabilities: '/capabilities', grants: '/grants' };
const AT = Date.parse('2026-01-01T00:00:00Z');

const ANA: PrincipalView = { id: 'corp:ana', issuer: 'corp', attributes: { team: 'ventas', role: 'manager' } };

function ruleset(grants: readonly GrantView[], capabilities = ['crm.read']): Ruleset {
  return {
    capabilities: capabilities.map((id) => ({ id, realized: true, path: `/capabilities/${id}` })),
    grants,
    anchors: ANCHORS,
  };
}

function grant(overrides: Partial<GrantView> = {}): GrantView {
  return {
    issuer: 'corp',
    attributes: { team: 'ventas' },
    capabilities: ['crm.read'],
    account: { id: 'crm-ro', disabled: false },
    limits: undefined,
    path: '/grants/0',
    ...overrides,
  };
}

function ask(rules: Ruleset, capability = 'crm.read', usage: Usage = { kind: 'not-consulted' }) {
  return evaluate({ principal: ANA, capability, at: AT, usage }, rules);
}

describe('el defecto es denegar', () => {
  it('un artefacto vacío deniega todo', () => {
    const decision = ask({ capabilities: [], grants: [], anchors: ANCHORS });
    expect(decision.outcome).toBe('deny');
    expect(decision.reason.code).toBe('capability_not_declared');
    expect(decision.reason.path).toBe(ANCHORS.capabilities);
  });

  it('una capacidad declarada sin concesión deniega, y señala la sección de concesiones', () => {
    const decision = ask(ruleset([]));
    expect(decision.reason.code).toBe('no_grant_matches');
    expect(decision.reason.path).toBe(ANCHORS.grants);
  });

  it('una capacidad que ninguna tool realiza deniega, aunque esté concedida', () => {
    const rules: Ruleset = {
      capabilities: [{ id: 'crm.read', realized: false, path: '/capabilities/0' }],
      grants: [grant()],
      anchors: ANCHORS,
    };
    expect(ask(rules).reason.code).toBe('capability_not_realized');
  });

  it('una denegación no expone la cuenta: es inalcanzable, no `null`', () => {
    const decision = ask(ruleset([]));
    expect(decision.outcome).toBe('deny');
    expect(Object.hasOwn(decision, 'account')).toBe(false);
    expect(Object.hasOwn(decision, 'limits')).toBe(false);
  });
});

describe('el selector', () => {
  it('exige todas las igualdades declaradas', () => {
    const rules = ruleset([grant({ attributes: { team: 'ventas', role: 'director' } })]);
    expect(ask(rules).outcome).toBe('deny');
  });

  it('un selector vacío casa con cualquier principal del emisor', () => {
    expect(ask(ruleset([grant({ attributes: {} })])).outcome).toBe('allow');
  });

  it('el emisor tiene que coincidir', () => {
    expect(ask(ruleset([grant({ issuer: 'otro' })])).outcome).toBe('deny');
  });
});

describe('un permiso', () => {
  it('lleva motivo, cuenta y el sitio de la concesión que lo justifica', () => {
    const decision = ask(ruleset([grant({ path: '/grants/3' })]));
    expect(decision).toMatchObject({
      outcome: 'allow',
      reason: { code: 'granted', path: '/grants/3', subject: 'crm.read' },
      account: { id: 'crm-ro' },
    });
  });

  it('una cuenta deshabilitada deniega', () => {
    const decision = ask(ruleset([grant({ account: { id: 'crm-ro', disabled: true } })]));
    expect(decision.reason.code).toBe('account_disabled');
    expect(decision.reason.subject).toBe('crm-ro');
  });

  it('dos concesiones con cuentas distintas deniegan en lugar de elegir en silencio', () => {
    const decision = ask(
      ruleset([
        grant({ path: '/grants/0' }),
        grant({ path: '/grants/1', attributes: {}, account: { id: 'crm-rw', disabled: false } }),
      ]),
    );
    expect(decision.reason.code).toBe('ambiguous_grant');
  });
});

describe('los techos', () => {
  const limited = (calls: number, per: string, windowMs: number): GrantView =>
    grant({ limits: { calls, per, windowMs } });

  it('el listado no consulta contadores', () => {
    expect(ask(ruleset([limited(0, '1h', 3_600_000)])).outcome).toBe('allow');
  });

  it('uso por debajo del techo permite', () => {
    const decision = ask(ruleset([limited(5, '1h', 3_600_000)]), 'crm.read', {
      kind: 'counted',
      calls: 4,
      windowStart: AT,
    });
    expect(decision.outcome).toBe('allow');
  });

  it('uso en el techo deniega', () => {
    const decision = ask(ruleset([limited(5, '1h', 3_600_000)]), 'crm.read', {
      kind: 'counted',
      calls: 5,
      windowStart: AT,
    });
    expect(decision.reason.code).toBe('limit_exhausted');
  });

  it('una ventana ya expirada vuelve a permitir, y eso se decide con el instante recibido', () => {
    const decision = evaluate(
      {
        principal: ANA,
        capability: 'crm.read',
        at: AT + 3_600_001,
        usage: { kind: 'counted', calls: 99, windowStart: AT },
      },
      ruleset([limited(5, '1h', 3_600_000)]),
    );
    expect(decision.outcome).toBe('allow');
  });

  it('uso desconocido se trata como techo agotado, no como cero', () => {
    const decision = ask(ruleset([limited(5, '1h', 3_600_000)]), 'crm.read', { kind: 'unknown' });
    expect(decision.reason.code).toBe('usage_unknown');
  });

  it('sin techo declarado, un uso desconocido no deniega: no hay nada que agotar', () => {
    expect(ask(ruleset([grant()]), 'crm.read', { kind: 'unknown' }).outcome).toBe('allow');
  });

  it('con la misma cuenta gana el techo más restrictivo', () => {
    const decision = ask(
      ruleset([
        grant({ path: '/grants/0', limits: { calls: 500, per: '1h', windowMs: 3_600_000 } }),
        grant({ path: '/grants/1', attributes: {}, limits: { calls: 20, per: '24h', windowMs: 86_400_000 } }),
      ]),
    );
    expect(decision).toMatchObject({ outcome: 'allow', limits: { calls: 20, per: '24h' } });
  });

  it('un techo declarado gana a la ausencia de techo', () => {
    const decision = ask(
      ruleset([
        grant({ path: '/grants/0', limits: undefined }),
        grant({ path: '/grants/1', attributes: {}, limits: { calls: 3, per: '1h', windowMs: 3_600_000 } }),
      ]),
    );
    expect(decision).toMatchObject({ outcome: 'allow', limits: { calls: 3 } });
  });
});

describe('la misma evaluación contesta las dos preguntas', () => {
  it('lo no concedido no aparece en el listado: no sale marcado, no sale', () => {
    const rules = ruleset([grant()], ['crm.read', 'crm.write']);
    expect(visible(ANA, rules, AT).map((entry) => entry.capability.id)).toEqual(['crm.read']);
  });

  it('el listado y la decisión coinciden, porque son la misma función', () => {
    const rules = ruleset([grant()], ['crm.read', 'crm.write']);
    for (const capability of rules.capabilities) {
      const listed = visible(ANA, rules, AT).some((entry) => entry.capability.id === capability.id);
      const decided = ask(rules, capability.id).outcome === 'allow';
      expect(listed).toBe(decided);
    }
  });
});

describe('la consulta inversa', () => {
  it('enumera quién llega y con qué cuenta', () => {
    const report = reach('crm.read', ruleset([grant({ path: '/grants/0' })]));
    expect(report.through).toEqual([
      {
        issuer: 'corp',
        attributes: { team: 'ventas' },
        account: { id: 'crm-ro', disabled: false },
        limits: undefined,
        path: '/grants/0',
      },
    ]);
  });

  it('distingue "nadie llega" de "no está declarada"', () => {
    expect(reach('crm.read', ruleset([]))).toMatchObject({ declared: true, through: [] });
    expect(reach('otra', ruleset([]))).toMatchObject({ declared: false, through: [] });
  });
});
