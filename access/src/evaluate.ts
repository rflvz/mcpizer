/**
 * La evaluación. Una función de datos a datos: mismos valores, misma decisión,
 * siempre, y sin un solo doble en los tests.
 *
 * Denegar es el defecto **estructural**, no una comprobación al final: cada
 * salida temprana es una denegación con motivo, y llegar al permiso exige haber
 * atravesado todas las condiciones.
 */
import type {
  AccountView,
  CapabilityView,
  Decision,
  GrantView,
  Instant,
  Invocation,
  LimitsView,
  PrincipalView,
  ReasonCode,
  Ruleset,
} from './model.js';

function deny(code: ReasonCode, path: string, subject: string | undefined): Decision {
  return { outcome: 'deny', reason: { code, path, subject } };
}

/** Un principal encaja si cumple todas las igualdades del selector (decisión 0011). */
function matches(grant: GrantView, principal: PrincipalView): boolean {
  if (grant.issuer !== principal.issuer) return false;
  for (const [name, expected] of Object.entries(grant.attributes)) {
    if (principal.attributes[name] !== expected) return false;
  }
  return true;
}

/** Llamadas por milisegundo. Sin techo declarado es el caso más permisivo de todos. */
function rate(limits: LimitsView | undefined): number {
  return limits === undefined ? Number.POSITIVE_INFINITY : limits.calls / limits.windowMs;
}

/**
 * Cuando varias concesiones coinciden con la misma cuenta, las capacidades se
 * unen y **gana el límite más restrictivo**: la única combinación que no puede
 * ampliar el acceso por accidente (`docs/diseno/artefacto.md` §3).
 *
 * Se comparan como llamadas por milisegundo, y en un empate gana la ventana más
 * corta, que es la que antes obliga a esperar (decisión 0013).
 */
function mostRestrictive(grants: readonly GrantView[]): GrantView {
  return grants.reduce((best, candidate) => {
    const bestRate = rate(best.limits);
    const candidateRate = rate(candidate.limits);
    if (candidateRate !== bestRate) return candidateRate < bestRate ? candidate : best;
    const bestWindow = best.limits?.windowMs ?? Number.POSITIVE_INFINITY;
    const candidateWindow = candidate.limits?.windowMs ?? Number.POSITIVE_INFINITY;
    return candidateWindow < bestWindow ? candidate : best;
  });
}

export function evaluate(invocation: Invocation, ruleset: Ruleset): Decision {
  const capability = ruleset.capabilities.find((declared) => declared.id === invocation.capability);
  if (capability === undefined) {
    return deny('capability_not_declared', ruleset.anchors.capabilities, invocation.capability);
  }
  if (!capability.realized) {
    return deny('capability_not_realized', capability.path, capability.id);
  }

  const matching = ruleset.grants.filter(
    (grant) => matches(grant, invocation.principal) && grant.capabilities.includes(capability.id),
  );
  const first = matching[0];
  if (first === undefined) {
    return deny('no_grant_matches', ruleset.anchors.grants, capability.id);
  }

  // La ambigüedad sobre la segunda identidad es error de compilación en `policy`.
  // Que aquí sea además una denegación es fallo cerrado: si una política llegara
  // sin compilar, elegir cuenta en silencio sería lo peor que podría pasar.
  if (new Set(matching.map((grant) => grant.account.id)).size > 1) {
    return deny('ambiguous_grant', first.path, capability.id);
  }

  // Basta con que *una* de las concesiones coincidentes traiga la cuenta
  // deshabilitada. Mirar solo la ganadora haría que el resultado dependiera de
  // cuál gana, y por tanto del orden del fichero — justo lo que la política solo
  // aditiva existe para impedir (decisión 0005).
  const revoked = matching.find((grant) => grant.account.disabled);
  if (revoked !== undefined) {
    return deny('account_disabled', revoked.path, revoked.account.id);
  }

  const winner = mostRestrictive(matching);

  const limits = winner.limits;
  if (limits !== undefined && invocation.usage.kind !== 'not-consulted') {
    if (invocation.usage.kind === 'unknown') {
      return deny('usage_unknown', winner.path, winner.account.id);
    }
    const expired = invocation.at - invocation.usage.windowStart >= limits.windowMs;
    const consumed = expired ? 0 : invocation.usage.calls;
    if (consumed >= limits.calls) {
      return deny('limit_exhausted', winner.path, capability.id);
    }
  }

  return {
    outcome: 'allow',
    reason: { code: 'granted', path: winner.path, subject: capability.id },
    account: winner.account,
    limits,
  };
}

export interface VisibleCapability {
  readonly capability: CapabilityView;
  readonly account: AccountView;
  readonly limits: LimitsView | undefined;
}

/**
 * Qué capacidades ve un principal. **Es la misma función**, aplicada a cada
 * capacidad conocida: la visibilidad no es un filtro aparte que haya que
 * mantener sincronizado con la autorización.
 *
 * Las no concedidas no aparecen. No salen marcadas como prohibidas: no salen
 * (invariante 3).
 */
export function visible(principal: PrincipalView, ruleset: Ruleset, at: Instant): readonly VisibleCapability[] {
  const seen: VisibleCapability[] = [];
  for (const capability of ruleset.capabilities) {
    const decision = evaluate(
      { principal, capability: capability.id, at, usage: { kind: 'not-consulted' } },
      ruleset,
    );
    if (decision.outcome === 'allow') {
      seen.push({ capability, account: decision.account, limits: decision.limits });
    }
  }
  return seen;
}
