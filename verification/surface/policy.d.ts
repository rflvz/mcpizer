// Retrato de la superficie pública de `policy`.
// Generado por `pnpm surface`; no se edita a mano.

declare const compile: (text: string, options?: CompileOptions) => CompileResult;

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

export interface CompiledCapability {
  readonly id: string;
  readonly description: string | undefined;
  /** Si alguna tool declarada la realiza. Una capacidad sin tool no es alcanzable. */
  readonly realized: boolean;
  readonly path: string;
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

export interface CompiledIssuer {
  readonly id: string;
  readonly kind: IssuerKind;
  /** Nombre de atributo → origen. Lo no declarado aquí no puede discriminarse. */
  readonly attributes: Readonly<Record<string, string>>;
  /**
   * A quién identifica la clave, en los emisores `static-key`. Una clave estática
   * no trae sujeto consigo como lo trae un token: hay que declararlo.
   */
  readonly subject: string | undefined;
  /**
   * Dónde está la clave que se compara, jamás la clave. Es la misma regla que
   * gobierna las cuentas: el artefacto vive en git y solo lleva referencias.
   */
  readonly secretRef: string | undefined;
  readonly path: string;
}

export interface CompiledLimits {
  readonly calls: number;
  /** La ventana tal como se escribió, para poder devolverla al autor. */
  readonly per: string;
  readonly windowMs: number;
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

export interface CompiledToolMapping {
  readonly upstream: string;
  readonly name: string;
  readonly capability: string;
  readonly path: string;
}

export type CompiledTransport =
  | { readonly kind: 'mcp-stdio'; readonly command: string; readonly args: readonly string[] }
  | { readonly kind: 'mcp-http'; readonly url: string };

export interface CompiledUpstream {
  readonly id: string;
  readonly transport: CompiledTransport;
  readonly tools: readonly CompiledToolMapping[];
  readonly path: string;
}

export interface CompileOptions {
  /**
   * El catálogo declarado. Sin él no se puede saber si un mapeo apunta a una
   * tool que ya no existe; con él, la verificación en seco detecta también lo
   * que de otro modo solo aparecería en ejecución
   * (`docs/diseno/artefacto.md` §4).
   */
  readonly catalog?: readonly ToolIdentity[] | undefined;
}

export interface CompileResult {
  readonly document: PolicyDocument | undefined;
  /** Ausente si hay algún diagnóstico de severidad `error`. */
  readonly policy: CompiledPolicy | undefined;
  readonly diagnostics: readonly Diagnostic[];
}

export interface Diagnostic {
  readonly severity: DiagnosticSeverity;
  readonly code: DiagnosticCode;
  readonly message: string;
  /** Puntero RFC 6901 al lugar del artefacto que lo origina. */
  readonly path: string;
  readonly position: DocumentPosition | undefined;
  readonly related: readonly RelatedLocation[];
}

export type DiagnosticCode =
  | 'yaml_syntax'
  | 'schema_violation'
  | 'duplicate_id'
  | 'unknown_capability_in_grant'
  | 'unknown_capability_in_tool'
  | 'unknown_account_in_grant'
  | 'unknown_issuer_in_grant'
  | 'ambiguous_grant'
  | 'capability_not_realized'
  | 'unused_account'
  | 'tool_not_in_catalog'
  | 'catalog_tool_unmapped'
  | 'attribute_not_declared'
  | 'claim_mapping_expected';

export type DiagnosticSeverity = 'error' | 'warning';

export interface DocumentPosition {
  /** Línea, empezando en 1. */
  readonly line: number;
  /** Columna, empezando en 1. */
  readonly column: number;
  /** Desplazamiento en caracteres desde el principio del documento. */
  readonly offset: number;
}

declare const hasErrors: (diagnostics: readonly Diagnostic[]) => boolean;

export type IssuerKind = 'oidc' | 'static-key' | 'mtls';

declare const pointer: (...segments: readonly (string | number)[]) => string;

export interface PolicyAnchors {
  readonly capabilities: string;
  readonly upstreams: string;
  readonly accounts: string;
  readonly issuers: string;
  readonly grants: string;
}

export interface PolicyDocument {
  readonly text: string;
  /** El documento como datos planos, listo para validar contra el esquema. */
  readonly value: unknown;
  /** Traduce un puntero RFC 6901 a una posición real, o `undefined` si no apunta a nada. */
  resolve(pointer: string): DocumentPosition | undefined;
}

declare const readDocument: (text: string) => { readonly document: PolicyDocument | undefined; readonly diagnostics: readonly Diagnostic[]; };

export interface RelatedLocation {
  readonly path: string;
  readonly position: DocumentPosition | undefined;
  readonly note: string;
}

declare const schema: unknown;

export interface ToolIdentity {
  readonly upstream: string;
  readonly name: string;
}

export type TransportKind = 'mcp-stdio' | 'mcp-http';

declare const windowMillis: (per: string) => number;
