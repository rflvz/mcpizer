/**
 * El vocabulario de `access`: decisión, concesión, denegación, motivo, techo.
 *
 * Los tipos son propios de este contexto. `access` no recibe *el* principal de
 * `principals` ni *la* política de `policy`: recibe su propia vista, y la
 * traducción ocurre en composición (decisión 0004). El `path` viaja como cadena
 * opaca — este contexto no sabe resolverlo y no lo necesita.
 */

/** El instante, como dato. No hay reloj aquí: entra en la invocación (decisión 0002). */
export type Instant = number;

/** Quién invoca, en los términos que la evaluación necesita. */
export interface PrincipalView {
  readonly id: string;
  readonly issuer: string;
  /** Ya normalizados. Este contexto no sabe si vinieron de un token o de un certificado. */
  readonly attributes: Readonly<Record<string, string>>;
}

/**
 * Contra qué cuenta se ejecuta. Un asa y su estado; nada canjeable.
 * Es un tipo distinto de `PrincipalView` a propósito: si compartieran forma, un
 * parámetro que espera una identidad aceptaría las dos (invariante 5).
 */
export interface AccountView {
  readonly id: string;
  readonly disabled: boolean;
}

export interface LimitsView {
  readonly calls: number;
  readonly per: string;
  readonly windowMs: number;
}

export interface CapabilityView {
  readonly id: string;
  /** Si alguna tool declarada la realiza. Conceder una capacidad sin tool no expone nada. */
  readonly realized: boolean;
  readonly path: string;
}

export interface GrantView {
  readonly issuer: string;
  /** Conjunción de igualdades: el principal encaja si las cumple todas. */
  readonly attributes: Readonly<Record<string, string>>;
  readonly capabilities: readonly string[];
  readonly account: AccountView;
  readonly limits: LimitsView | undefined;
  readonly path: string;
}

/** Punteros a las secciones del artefacto, para que una denegación pueda señalar una ausencia. */
export interface RulesetAnchors {
  readonly capabilities: string;
  readonly grants: string;
}

/** La política compilada, en los términos de este contexto. */
export interface Ruleset {
  readonly capabilities: readonly CapabilityView[];
  readonly grants: readonly GrantView[];
  readonly anchors: RulesetAnchors;
}

/**
 * Uso acumulado, como hecho recibido.
 *
 * - `not-consulted` — el listado no carga contadores: los límites solo tienen
 *   sentido cuando hay algo que consumir (`docs/diseno/modelo.md` §5).
 * - `unknown` — el almacén no respondió. Se trata como techo agotado, nunca
 *   como cero (`docs/diseno/puertos.md` §2.4).
 * - `counted` — valores reales.
 */
export type Usage =
  | { readonly kind: 'not-consulted' }
  | { readonly kind: 'unknown' }
  | { readonly kind: 'counted'; readonly calls: number; readonly windowStart: Instant };

/** Todo lo que el núcleo necesita, ya reunido por la cáscara. Si algo no está aquí, no se puede consultar. */
export interface Invocation {
  readonly principal: PrincipalView;
  readonly capability: string;
  readonly at: Instant;
  readonly usage: Usage;
}

/**
 * Vocabulario cerrado de motivos. Cerrado significa que un consumidor puede
 * ramificar exhaustivamente y saber que no le va a llegar uno que no contempla.
 */
export type ReasonCode =
  | 'granted'
  | 'capability_not_declared'
  | 'capability_not_realized'
  | 'no_grant_matches'
  | 'ambiguous_grant'
  | 'account_disabled'
  | 'usage_unknown'
  | 'limit_exhausted';

/** Un motivo es un dato que se consume, no un mensaje que se lee. */
export interface Reason {
  readonly code: ReasonCode;
  /** Dónde, en el artefacto, se originó. Nunca contiene material sensible. */
  readonly path: string;
  readonly subject: string | undefined;
}

/**
 * `account` y `limits` solo existen en un permiso, y son **inalcanzables** en
 * una denegación: es estructural, no un `null` en el que haya que confiar
 * (`docs/diseno/modelo.md` §4).
 *
 * `reason` está en ambos: la pregunta "¿por qué este agente pudo usar esta
 * cuenta?" es tan auditable como su contraria.
 */
export type Decision =
  | {
      readonly outcome: 'allow';
      readonly reason: Reason;
      readonly account: AccountView;
      readonly limits: LimitsView | undefined;
    }
  | { readonly outcome: 'deny'; readonly reason: Reason };
