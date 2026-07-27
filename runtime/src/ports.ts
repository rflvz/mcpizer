/**
 * Los puertos: contratos que declara la composición e implementa la periferia.
 *
 * En la mayoría de proyectos hexagonales los declara el dominio y los llama el
 * dominio. Aquí no, porque el núcleo es una función pura: el dominio no solo no
 * importa infraestructura, es que no tiene ningún punto por el que pudiera
 * hacerlo (`docs/diseno/puertos.md` §1).
 *
 * Se dividen por el momento en que actúan. Los **de entrada** reúnen hechos
 * antes de decidir; los **de salida** ejecutan efectos después. No es
 * decoración: los de entrada nunca se consultan después de decidir, y los de
 * salida nunca influyen en la decisión. Si un adaptador de salida acabara
 * alimentando la evaluación, el núcleo dejaría de ser puro.
 *
 * Ninguno importa de un contexto, y es deliberado: `adapters/` no puede
 * alcanzarlos —la regla es transitiva— así que un puerto que hablara el
 * vocabulario de `capabilities` no se podría implementar. Cada contrato declara
 * sus propias formas, y el tipado estructural hace el resto.
 */

// ─────────────────────────────────────────────────────────────────────────────
// De entrada: reúnen hechos.
// ─────────────────────────────────────────────────────────────────────────────

export interface PolicyArtifact {
  readonly text: string;
  /** Etiqueta de versión: permite saber si el artefacto ha cambiado. */
  readonly version: string;
  readonly origin: string;
}

/** De entrada. Entrega el artefacto declarativo sin interpretarlo. */
export interface PolicySource {
  load(): Promise<PolicyArtifact>;
}

export interface DiscoveredTool {
  readonly upstreamId: string;
  readonly name: string;
  readonly description: string | undefined;
  readonly inputSchema: unknown;
}

/** De entrada. Descubre qué tools ofrecen los upstreams; describe lo que hay, sin filtrar ni decidir. */
export interface CatalogSource {
  toolsOf(upstreamId?: string): Promise<readonly DiscoveredTool[]>;
}

/** Las credenciales del transporte, tal como llegan. */
export interface TransportCredentials {
  /** Qué emisor dice representar quien se conecta. */
  readonly issuer: string;
  /** El material presentado. No se guarda, no se registra y no vuelve a salir. */
  readonly presented: string;
}

/**
 * Los cuatro casos se distinguen porque acaban en motivos distintos
 * (`docs/diseno/puertos.md` §2.1).
 */
export type AuthenticationFailure =
  | 'credential_missing'
  | 'credential_invalid'
  | 'credential_expired'
  | 'issuer_unknown';

export type ResolvedPrincipal =
  | {
      readonly ok: true;
      readonly issuer: string;
      readonly subject: string;
      readonly attributes: Readonly<Record<string, string>>;
    }
  | { readonly ok: false; readonly problem: AuthenticationFailure };

/**
 * De entrada. Convierte lo que trae el transporte en un principal del dominio.
 *
 * **Garantiza**: no devuelve nunca un principal cuya credencial no haya
 * validado. Un principal "anónimo" no es un valor válido de retorno; la
 * ausencia de identidad es fallo, no un principal vacío. Esto es fallo cerrado
 * en el borde exterior.
 */
export interface PrincipalResolver {
  resolve(credentials: TransportCredentials | undefined): Promise<ResolvedPrincipal>;
}

/** Qué contador. El uso se acumula por principal y capacidad, que es el par que un techo limita. */
export interface UsageKey {
  readonly principal: string;
  readonly capability: string;
}

export interface UsageCount {
  readonly calls: number;
  readonly windowStart: number;
}

/**
 * De entrada. Uso acumulado frente a los techos declarados.
 *
 * **Garantiza**: leer no muta. La decisión de si un techo se ha superado la toma
 * `access` con los valores recibidos; el puerto no evalúa techos.
 *
 * **Falla**: si el almacén no responde, `read` **rechaza**. Uso desconocido se
 * trata como techo agotado, no como cero (invariante 3). Devolver `undefined`
 * es otra cosa: significa que aún no hay contador, que sí es cero.
 */
export interface UsageReader {
  read(key: UsageKey): Promise<UsageCount | undefined>;
}

// ─────────────────────────────────────────────────────────────────────────────
// De salida: ejecutan efectos.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * De salida. Registra el consumo tras ejecutar.
 *
 * Separar lectura y escritura no es ceremonia: la lectura ocurre antes de
 * decidir y la escritura después, y colapsarlas invitaría a incrementar el
 * contador durante la evaluación, contaminando el núcleo.
 */
export interface UsageWriter {
  record(key: UsageKey, at: number, windowMs: number): Promise<void>;
}

/**
 * Material de credencial. Es lo único canjeable de todo el sistema, y vive
 * exclusivamente entre `CredentialResolver` y `ToolInvoker`.
 */
export interface CredentialMaterial {
  readonly value: string;
}

/**
 * De salida. Canjea una referencia de cuenta por material utilizable. **Es la
 * frontera que hace cierto el invariante 6.**
 *
 * **Garantiza**: se invoca **después** de decidir y **solo** con una referencia
 * que una decisión permitió. Nunca antes, nunca especulativamente, nunca para
 * varias cuentas "por si acaso". El material que devuelve no vuelve hacia el
 * núcleo bajo ninguna forma, ni siquiera derivada: no entra en motivos, ni en
 * registros, ni en mensajes de error.
 *
 * **Falla**: referencia desconocida, cuenta revocada, bóveda inalcanzable,
 * credencial caducada. Todos abortan la ejecución. Ninguno degrada a ejecutar
 * sin credencial.
 */
export interface CredentialResolver {
  resolve(secretRef: string): Promise<CredentialMaterial>;
}

/** Cómo se alcanza un upstream, en los términos de este contrato. */
export type UpstreamTransport =
  | { readonly kind: 'mcp-stdio'; readonly command: string; readonly args: readonly string[] }
  | { readonly kind: 'mcp-http'; readonly url: string };

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

export interface ToolOutcome {
  readonly content: unknown;
  readonly isError: boolean;
}

/**
 * De salida. Ejecuta la tool upstream con el material resuelto.
 *
 * **Garantiza**: no reinterpreta la decisión. Si llega aquí, está autorizado;
 * este puerto no vuelve a comprobar la política, y tampoco la relaja. Es el
 * único punto del sistema que ve a la vez credenciales y argumentos, y por eso
 * es el único que necesita cuidado explícito con lo que registra.
 *
 * **Falla**: los fallos del upstream se propagan **distinguibles** de las
 * denegaciones de mcpizer. Confundir "denegado por política" con "el proveedor
 * está caído" haría inútil el bucle de corrección del invariante 4.
 */
export interface ToolInvoker {
  invoke(call: ToolCall): Promise<ToolOutcome>;
  close(): Promise<void>;
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

/**
 * De salida. Registra la decisión y su motivo.
 *
 * **Garantiza**: registra tanto permisos como denegaciones. Registrar solo
 * denegaciones dejaría sin rastro justo el caso que más importa auditar: quién
 * usó qué cuenta. **Nunca recibe material de credencial** — recibe la
 * referencia, que es opaca por diseño, y `DecisionRecord` no tiene ningún campo
 * donde el material pudiera colarse.
 *
 * **Falla**: un fallo al registrar no revierte una ejecución ya hecha, pero sí
 * es visible. Que la auditoría falle en silencio es un fallo de seguridad.
 */
export interface DecisionRecorder {
  record(entry: DecisionRecord): void;
}
