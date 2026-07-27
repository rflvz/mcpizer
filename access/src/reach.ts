/**
 * La consulta inversa: dada una capacidad, quién llega a ella y con qué cuenta.
 *
 * Es la pregunta de auditoría real —"¿quién puede emitir facturas?"— y solo
 * tiene respuesta exacta porque no hay denegaciones ni precedencia: basta con
 * recorrer las concesiones (decisión 0005). Con precedencia, esta pregunta solo
 * se contestaría simulando.
 */
import type { AccountView, LimitsView, Ruleset } from './model.js';

export interface ReachEntry {
  readonly issuer: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly account: AccountView;
  readonly limits: LimitsView | undefined;
  readonly path: string;
}

export interface Reachability {
  readonly capability: string;
  /** Vacío significa que nadie llega: la capacidad existe y no está concedida. */
  readonly through: readonly ReachEntry[];
  readonly declared: boolean;
  readonly realized: boolean;
}

export function reach(capability: string, ruleset: Ruleset): Reachability {
  const declared = ruleset.capabilities.find((entry) => entry.id === capability);
  const through = ruleset.grants
    .filter((grant) => grant.capabilities.includes(capability))
    .map<ReachEntry>((grant) => ({
      issuer: grant.issuer,
      attributes: grant.attributes,
      account: grant.account,
      limits: grant.limits,
      path: grant.path,
    }));
  return {
    capability,
    through,
    declared: declared !== undefined,
    realized: declared?.realized ?? false,
  };
}
