// Retrato de la superficie pública de `access`.
// Generado por `pnpm surface`; no se edita a mano.

export interface AccountView {
  readonly id: string;
  readonly disabled: boolean;
}

export interface CapabilityView {
  readonly id: string;
  /** Si alguna tool declarada la realiza. Conceder una capacidad sin tool no expone nada. */
  readonly realized: boolean;
  readonly path: string;
}

export type Decision =
  | {
      readonly outcome: 'allow';
      readonly reason: Reason;
      readonly account: AccountView;
      readonly limits: LimitsView | undefined;
    }
  | { readonly outcome: 'deny'; readonly reason: Reason };

declare const evaluate: (invocation: Invocation, ruleset: Ruleset) => Decision;

export interface GrantView {
  readonly issuer: string;
  /** Conjunción de igualdades: el principal encaja si las cumple todas. */
  readonly attributes: Readonly<Record<string, string>>;
  readonly capabilities: readonly string[];
  readonly account: AccountView;
  readonly limits: LimitsView | undefined;
  readonly path: string;
}

export type Instant = number;

export interface Invocation {
  readonly principal: PrincipalView;
  readonly capability: string;
  readonly at: Instant;
  readonly usage: Usage;
}

export interface LimitsView {
  readonly calls: number;
  readonly per: string;
  readonly windowMs: number;
}

export interface PrincipalView {
  readonly id: string;
  readonly issuer: string;
  /** Ya normalizados. Este contexto no sabe si vinieron de un token o de un certificado. */
  readonly attributes: Readonly<Record<string, string>>;
}

declare const reach: (capability: string, ruleset: Ruleset) => Reachability;

export interface Reachability {
  readonly capability: string;
  /** Vacío significa que nadie llega: la capacidad existe y no está concedida. */
  readonly through: readonly ReachEntry[];
  readonly declared: boolean;
  readonly realized: boolean;
}

export interface ReachEntry {
  readonly issuer: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly account: AccountView;
  readonly limits: LimitsView | undefined;
  readonly path: string;
}

export interface Reason {
  readonly code: ReasonCode;
  /** Dónde, en el artefacto, se originó. Nunca contiene material sensible. */
  readonly path: string;
  readonly subject: string | undefined;
}

export type ReasonCode =
  | 'granted'
  | 'capability_not_declared'
  | 'capability_not_realized'
  | 'no_grant_matches'
  | 'ambiguous_grant'
  | 'account_disabled'
  | 'usage_unknown'
  | 'limit_exhausted';

export interface Ruleset {
  readonly capabilities: readonly CapabilityView[];
  readonly grants: readonly GrantView[];
  readonly anchors: RulesetAnchors;
}

export interface RulesetAnchors {
  readonly capabilities: string;
  readonly grants: string;
}

export type Usage =
  | { readonly kind: 'not-consulted' }
  | { readonly kind: 'unknown' }
  | { readonly kind: 'counted'; readonly calls: number; readonly windowStart: Instant };

declare const visible: (principal: PrincipalView, ruleset: Ruleset, at: number) => readonly VisibleCapability[];

export interface VisibleCapability {
  readonly capability: CapabilityView;
  readonly account: AccountView;
  readonly limits: LimitsView | undefined;
}
