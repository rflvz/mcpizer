// Retrato de la superficie pública de `runtime`.
// Generado por `pnpm surface`; no se edita a mano.

export type AuthenticationFailure =
  | 'credential_missing'
  | 'credential_invalid'
  | 'credential_expired'
  | 'issuer_unknown';

export type CallOutcome =
  | { readonly kind: 'invoked'; readonly result: ToolOutcome }
  | { readonly kind: 'unauthenticated'; readonly problem: AuthenticationProblem }
  | { readonly kind: 'unknown-tool'; readonly name: string }
  | {
      readonly kind: 'denied';
      readonly reason: Reason;
      readonly position: DocumentPosition | undefined;
    }
  | { readonly kind: 'credential-failed'; readonly account: string; readonly detail: string }
  | { readonly kind: 'upstream-failed'; readonly upstreamId: string; readonly detail: string };

export interface CatalogSource {
  toolsOf(upstreamId?: string): Promise<readonly DiscoveredTool[]>;
}

export interface CredentialMaterial {
  readonly value: string;
}

export interface CredentialResolver {
  resolve(secretRef: string): Promise<CredentialMaterial>;
}

export interface DecisionChange {
  readonly issuer: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly capability: string;
  readonly before: DecisionSummary | undefined;
  readonly after: DecisionSummary | undefined;
}

export interface DecisionRecord {
  readonly at: number;
  readonly principal: string;
  readonly issuer: string;
  readonly capability: string | undefined;
  /** El nombre expuesto, cuando la entrada viene de una invocación. */
  readonly tool: string | undefined;
  readonly outcome: 'allow' | 'deny';
  readonly code: string;
  readonly path: string;
  /** La referencia de cuenta, que es opaca por diseño. Jamás el material. */
  readonly account: string | undefined;
}

export interface DecisionRecorder {
  record(entry: DecisionRecord): void;
}

export interface DecisionSummary {
  readonly outcome: 'allow' | 'deny';
  readonly code: string;
  readonly account: string | undefined;
  readonly path: string;
}

export interface DiscoveredTool {
  readonly upstreamId: string;
  readonly name: string;
  readonly description: string | undefined;
  readonly inputSchema: unknown;
}

declare const effectiveDiff: (before: LoadedPolicy, after: LoadedPolicy, at: number) => readonly DecisionChange[];

declare const explain: (loaded: LoadedPolicy, question: Question) => Explanation;

export interface Explanation {
  readonly resolution: Resolution;
  /** Ausente si el principal no resuelve: sin quién invoca no hay nada que decidir. */
  readonly decision: Decision | undefined;
  /** El sitio exacto a tocar. Es lo que convierte "denegado" en "denegado, y aquí". */
  readonly position: DocumentPosition | undefined;
  /** Las tools que el principal vería por esta capacidad. Vacío si no se le concede. */
  readonly tools: readonly ToolDescriptor[];
}

declare const exposedName: (tool: { readonly upstreamId: string; readonly name: string; }) => string;

export interface ExposedTool {
  readonly name: string;
  readonly description: string | undefined;
  readonly inputSchema: unknown;
  readonly capability: string;
}

declare const gateway: (loaded: LoadedPolicy, ports: GatewayPorts) => Gateway;

export interface Gateway {
  list(credentials: TransportCredentials | undefined): Promise<ListOutcome>;
  call(
    credentials: TransportCredentials | undefined,
    name: string,
    args: Readonly<Record<string, unknown>> | undefined,
  ): Promise<CallOutcome>;
}

export interface GatewayPorts {
  readonly principals: PrincipalResolver;
  readonly usageReader: UsageReader;
  readonly usageWriter: UsageWriter;
  readonly credentials: CredentialResolver;
  readonly invoker: ToolInvoker;
  readonly recorder: DecisionRecorder;
  /** El instante lo captura la cáscara y entra en la decisión como un hecho. No hay puerto `Clock`. */
  readonly now: () => Instant;
}

export type ListOutcome =
  | { readonly kind: 'listed'; readonly tools: readonly ExposedTool[] }
  | { readonly kind: 'unauthenticated'; readonly problem: AuthenticationProblem };

declare const literalAttributes: (policy: CompiledPolicy, issuerId: string) => Readonly<Record<string, string>>;

export interface LoadedPolicy {
  readonly artifact: PolicyArtifact;
  readonly document: PolicyDocument | undefined;
  readonly policy: CompiledPolicy | undefined;
  readonly diagnostics: readonly Diagnostic[];
  /** Ausente cuando la política no compila: sin modelo evaluable no hay nada que cablear. */
  readonly wiring: Wiring | undefined;
}

declare const loadPolicy: (source: PolicySource, catalog?: CatalogSource | undefined) => Promise<LoadedPolicy>;

export interface PolicyArtifact {
  readonly text: string;
  /** Etiqueta de versión: permite saber si el artefacto ha cambiado. */
  readonly version: string;
  readonly origin: string;
}

export interface PolicySource {
  load(): Promise<PolicyArtifact>;
}

export interface PrincipalResolver {
  resolve(credentials: TransportCredentials | undefined): Promise<ResolvedPrincipal>;
}

export interface Question {
  readonly issuer: string;
  readonly subject: string;
  /** Atributos dados a mano. Se completan con los literales que declare el emisor. */
  readonly attributes: Readonly<Record<string, string>>;
  readonly capability: string;
  readonly at: Instant;
  readonly usage: Usage;
}

export interface ReachReport {
  readonly reachability: Reachability;
  readonly positions: Readonly<Record<string, DocumentPosition | undefined>>;
  readonly tools: readonly ToolDescriptor[];
}

export type ResolvedPrincipal =
  | {
      readonly ok: true;
      readonly issuer: string;
      readonly subject: string;
      readonly attributes: Readonly<Record<string, string>>;
    }
  | { readonly ok: false; readonly problem: AuthenticationFailure };

declare const seenBy: (loaded: LoadedPolicy, principal: PrincipalView, at: number) => readonly ToolDescriptor[];

export interface ToolCall {
  readonly upstreamId: string;
  readonly transport: UpstreamTransport;
  /**
   * El asa de la cuenta autorizada. No sirve para canjear nada: está aquí para
   * que la sesión con el upstream se pueda aislar por cuenta, porque compartir
   * una sesión entre cuentas compartiría su credencial.
   */
  readonly account: string;
  /** El nombre **upstream** de la tool, no el que ve el cliente. */
  readonly tool: string;
  readonly arguments: Readonly<Record<string, unknown>> | undefined;
  readonly credential: CredentialMaterial;
}

export interface ToolInvoker {
  invoke(call: ToolCall): Promise<ToolOutcome>;
  close(): Promise<void>;
}

export interface ToolOutcome {
  readonly content: unknown;
  readonly isError: boolean;
}

export interface TransportCredentials {
  /** Qué emisor dice representar quien se conecta. */
  readonly issuer: string;
  /** El material presentado. No se guarda, no se registra y no vuelve a salir. */
  readonly presented: string;
}

export type UpstreamTransport =
  | { readonly kind: 'mcp-stdio'; readonly command: string; readonly args: readonly string[] }
  | { readonly kind: 'mcp-http'; readonly url: string };

export interface UsageCount {
  readonly calls: number;
  readonly windowStart: number;
}

export interface UsageKey {
  readonly principal: string;
  readonly capability: string;
}

export interface UsageReader {
  read(key: UsageKey): Promise<UsageCount | undefined>;
}

export interface UsageWriter {
  record(key: UsageKey, at: number, windowMs: number): Promise<void>;
}

declare const whoCan: (loaded: LoadedPolicy, capability: string) => ReachReport | undefined;

declare const wire: (policy: CompiledPolicy, discovered?: readonly DiscoveredTool[] | undefined) => Wiring;

export interface Wiring {
  readonly catalog: Catalog;
  readonly accounts: AccountRegistry;
  readonly issuers: readonly IssuerProfile[];
  readonly ruleset: Ruleset;
}
