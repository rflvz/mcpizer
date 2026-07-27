/**
 * La política compilada: el modelo evaluable que produce `policy`.
 *
 * Es vocabulario de *este* contexto. `access` no lo importa — recibe su propia
 * vista, traducida en composición (decisión 0004). Lo que sí viaja intacto es el
 * `path` de cada elemento, porque es una cadena opaca que cualquier contexto
 * puede declarar en sus propios términos y que solo este módulo sabe resolver.
 */

export type TransportKind = 'mcp-stdio' | 'mcp-http';
export type IssuerKind = 'oidc' | 'static-key' | 'mtls';

export interface CompiledCapability {
  readonly id: string;
  readonly description: string | undefined;
  /** Si alguna tool declarada la realiza. Una capacidad sin tool no es alcanzable. */
  readonly realized: boolean;
  readonly path: string;
}

export interface CompiledToolMapping {
  readonly upstream: string;
  readonly name: string;
  readonly capability: string;
  readonly path: string;
}

export interface CompiledUpstream {
  readonly id: string;
  readonly transport: TransportKind;
  readonly tools: readonly CompiledToolMapping[];
  readonly path: string;
}

export interface CompiledAccount {
  readonly id: string;
  /**
   * La referencia, jamás el material. `CredentialResolver` sabe canjearla, y eso
   * ocurre en la periferia y solo después de que una decisión lo permita.
   */
  readonly secretRef: string;
  readonly disabled: boolean;
  readonly path: string;
}

export interface CompiledIssuer {
  readonly id: string;
  readonly kind: IssuerKind;
  /** Nombre de atributo → origen. Lo no declarado aquí no puede discriminarse. */
  readonly attributes: Readonly<Record<string, string>>;
  readonly path: string;
}

export interface CompiledLimits {
  readonly calls: number;
  /** La ventana tal como se escribió, para poder devolverla al autor. */
  readonly per: string;
  readonly windowMs: number;
}

export interface CompiledGrant {
  readonly issuer: string;
  /** Conjunción de igualdades. Un principal encaja si cumple todas (decisión 0011). */
  readonly attributes: Readonly<Record<string, string>>;
  readonly capabilities: readonly string[];
  readonly account: string;
  readonly limits: CompiledLimits | undefined;
  readonly path: string;
}

/** Punteros a las secciones. Una denegación señala una ausencia, y la ausencia tiene sitio. */
export interface PolicyAnchors {
  readonly capabilities: string;
  readonly upstreams: string;
  readonly accounts: string;
  readonly issuers: string;
  readonly grants: string;
}

export interface CompiledPolicy {
  readonly version: 1;
  readonly capabilities: readonly CompiledCapability[];
  readonly upstreams: readonly CompiledUpstream[];
  readonly accounts: readonly CompiledAccount[];
  readonly issuers: readonly CompiledIssuer[];
  readonly grants: readonly CompiledGrant[];
  readonly anchors: PolicyAnchors;
}

/** Identidad de una tool en el catálogo declarado. */
export interface ToolIdentity {
  readonly upstream: string;
  readonly name: string;
}

const UNITS: Readonly<Record<string, number>> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/** `1h` → 3600000. El esquema ya garantiza la forma; esto solo la interpreta. */
export function windowMillis(per: string): number {
  const amount = Number(per.slice(0, -1));
  const unit = UNITS[per.slice(-1)];
  return unit === undefined ? Number.NaN : amount * unit;
}
