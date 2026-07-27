/**
 * La pasarela: reúne → decide → ejecuta.
 *
 * Es la cáscara imperativa completa, la que `dry-run.ts` deja a medias porque en
 * seco no hay efecto. Aquí sí lo hay, y el orden de los pasos es la parte
 * vinculante: los puertos de entrada nunca se consultan después de decidir, y
 * los de salida nunca influyen en la decisión.
 *
 * El sitio donde eso se ve mejor es el paso 5 de `call`. La referencia al
 * secreto no se toca hasta que hay un permiso, y se toca **una sola**: la de la
 * cuenta que ese permiso nombró. Nunca antes, nunca especulativamente, nunca
 * para varias cuentas por si acaso. Es el invariante 6 convertido en el orden de
 * unas líneas.
 */
import { evaluate, visible, type Decision, type Instant, type PrincipalView, type Reason, type Usage } from '@mcpizer/access';
import { bind } from '@mcpizer/accounts';
import { visibleTools, type ToolDescriptor } from '@mcpizer/capabilities';
import type { CompiledTransport, DocumentPosition } from '@mcpizer/policy';
import { normalize, type AuthenticationProblem } from '@mcpizer/principals';
import type { LoadedPolicy } from './dry-run.js';
import type {
  CredentialResolver,
  DecisionRecorder,
  PrincipalResolver,
  ToolInvoker,
  ToolOutcome,
  TransportCredentials,
  UsageReader,
  UsageWriter,
} from './ports.js';

/** El separador entre upstream y tool en el nombre expuesto. Ver `exposedName`. */
const SEPARATOR = '__';

/**
 * El nombre con el que una tool se anuncia al cliente.
 *
 * Se cualifica **siempre**, no solo al colisionar: cualificar solo en conflicto
 * haría que el nombre visible dependiera de qué otros upstreams estén
 * declarados, y añadir un proveedor renombraría tools ajenas.
 *
 * El separador es `__` y no `-` porque los identificadores de upstream ya
 * admiten guiones, y con `-` el mapeo inverso dejaría de ser único.
 */
export function exposedName(tool: { readonly upstreamId: string; readonly name: string }): string {
  return `${tool.upstreamId}${SEPARATOR}${tool.name}`;
}

export interface ExposedTool {
  readonly name: string;
  readonly description: string | undefined;
  readonly inputSchema: unknown;
  readonly capability: string;
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

/**
 * Lo que puede salir de un listado.
 *
 * Sin identidad no hay nada que listar: un principal "anónimo" no es un valor
 * válido, así que la ausencia de credencial es fallo y no un catálogo vacío.
 */
export type ListOutcome =
  | { readonly kind: 'listed'; readonly tools: readonly ExposedTool[] }
  | { readonly kind: 'unauthenticated'; readonly problem: AuthenticationProblem };

/**
 * Lo que puede salir de una invocación.
 *
 * `ReasonCode` es un vocabulario **cerrado**: un consumidor ramifica
 * exhaustivamente sobre él y sabe que no le llegará uno que no contempla. Los
 * fallos que `access` nunca ve —no autenticar, un nombre que no existe, una
 * bóveda caída, un upstream muerto— no pueden entrar ahí sin abrirlo. Así que se
 * envuelve la decisión en vez de ampliarla.
 *
 * Y separa lo que `docs/diseno/puertos.md` §2.6 exige separar: "denegado por
 * política" y "el proveedor está caído" son cosas distintas, y confundirlas
 * haría inútil el bucle de corrección del invariante 4.
 */
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

export interface Gateway {
  list(credentials: TransportCredentials | undefined): Promise<ListOutcome>;
  call(
    credentials: TransportCredentials | undefined,
    name: string,
    args: Readonly<Record<string, unknown>> | undefined,
  ): Promise<CallOutcome>;
}

interface Authenticated {
  readonly principal: PrincipalView;
}

function detailOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Cablea los puertos alrededor de una política ya compilada.
 *
 * La política se carga una vez, al arrancar: `PolicySource` es un puerto de
 * entrada y no se consulta por invocación. Que un origen inalcanzable produzca
 * arranque fallido —y no una política vacía— es del contrato de ese puerto.
 */
export function gateway(loaded: LoadedPolicy, ports: GatewayPorts): Gateway {
  const { policy, document } = loaded;
  if (policy === undefined || loaded.wiring === undefined) {
    throw new Error('La política no compila; no hay pasarela que levantar.');
  }
  const wiring = loaded.wiring;

  // El índice inverso del nombre expuesto. Se construye una vez porque el
  // catálogo no cambia durante la vida del proceso.
  const byExposedName = new Map<string, ToolDescriptor>();
  for (const tool of wiring.catalog.tools) byExposedName.set(exposedName(tool), tool);

  const transports = new Map<string, CompiledTransport>(
    policy.upstreams.map((upstream) => [upstream.id, upstream.transport]),
  );

  async function authenticate(
    credentials: TransportCredentials | undefined,
  ): Promise<Authenticated | { readonly problem: AuthenticationProblem }> {
    const resolved = await ports.principals.resolve(credentials);
    if (!resolved.ok) return { problem: resolved.problem };

    // El adaptador ya validó la credencial; `principals` decide qué atributos
    // sobreviven. Lo que el emisor no declara se descarta: la política no puede
    // discriminar sobre algo que no esté escrito en el artefacto.
    const profile = wiring.issuers.find((issuer) => issuer.id === resolved.issuer);
    const resolution = normalize(profile, { subject: resolved.subject, attributes: resolved.attributes });
    if (!resolution.ok) return { problem: resolution.problem };

    return {
      principal: {
        id: resolution.principal.id,
        issuer: resolution.principal.issuer,
        attributes: resolution.principal.attributes,
      },
    };
  }

  function record(
    principal: PrincipalView,
    at: Instant,
    decision: Decision,
    capability: string | undefined,
    tool: string | undefined,
  ): void {
    ports.recorder.record({
      at,
      principal: principal.id,
      issuer: principal.issuer,
      capability,
      tool,
      outcome: decision.outcome,
      code: decision.reason.code,
      path: decision.reason.path,
      account: decision.outcome === 'allow' ? decision.account.id : undefined,
    });
  }

  return {
    /**
     * "¿Qué tools ve?" — la misma evaluación aplicada a cada capacidad conocida.
     * La visibilidad no es un filtro aparte que haya que mantener sincronizado
     * con la autorización, y por eso el fallo clásico —una tool oculta que sigue
     * siendo invocable si el cliente adivina su nombre— no puede ocurrir aquí.
     *
     * El listado **no carga contadores**: los techos solo tienen sentido cuando
     * hay algo que consumir (decisión 0014).
     */
    async list(credentials: TransportCredentials | undefined): Promise<ListOutcome> {
      const at = ports.now();
      const who = await authenticate(credentials);
      if (!('principal' in who)) return { kind: 'unauthenticated', problem: who.problem };

      const granted = visible(who.principal, wiring.ruleset, at);
      const tools = visibleTools(
        wiring.catalog,
        granted.map((entry) => entry.capability.id),
      );

      // Se registra lo concedido, que es lo que responde "¿qué llegó a ver este
      // principal, y contra qué cuenta?". Las denegaciones de un listado son el
      // estado por defecto de todo lo no concedido, no un suceso: registrarlas
      // ahogaría el rastro que sí importa auditar.
      for (const entry of granted) {
        ports.recorder.record({
          at,
          principal: who.principal.id,
          issuer: who.principal.issuer,
          capability: entry.capability.id,
          tool: undefined,
          outcome: 'allow',
          code: 'granted',
          path: entry.capability.path,
          account: entry.account.id,
        });
      }

      return {
        kind: 'listed',
        tools: tools.map((tool) => ({
          name: exposedName(tool),
          description: tool.description,
          inputSchema: tool.inputSchema,
          capability: tool.capability,
        })),
      };
    },

    /** "¿Puede ejecutar esta?" — la misma evaluación, ahora con argumentos y con uso cargado. */
    async call(
      credentials: TransportCredentials | undefined,
      name: string,
      args: Readonly<Record<string, unknown>> | undefined,
    ): Promise<CallOutcome> {
      const at = ports.now();

      // 1. Quién invoca.
      const who = await authenticate(credentials);
      if (!('principal' in who)) return { kind: 'unauthenticated', problem: who.problem };
      const { principal } = who;

      // 2. Qué pretende hacer. Un nombre que no corresponde a ninguna tool del
      //    catálogo no llega a `access`: no hay capacidad sobre la que decidir, y
      //    fabricar una para obtener un motivo abriría el vocabulario cerrado.
      const tool = byExposedName.get(name);
      if (tool === undefined) return { kind: 'unknown-tool', name };

      // 3. El uso acumulado, como hecho. Que el almacén falle es *desconocido*, y
      //    desconocido se trata como techo agotado, jamás como cero.
      const key = { principal: principal.id, capability: tool.capability };
      let usage: Usage;
      try {
        const counted = await ports.usageReader.read(key);
        usage =
          counted === undefined
            ? { kind: 'counted', calls: 0, windowStart: at }
            : { kind: 'counted', calls: counted.calls, windowStart: counted.windowStart };
      } catch {
        usage = { kind: 'unknown' };
      }

      // 4. La decisión.
      const decision = evaluate({ principal, capability: tool.capability, at, usage }, wiring.ruleset);
      record(principal, at, decision, tool.capability, name);
      if (decision.outcome === 'deny') {
        return { kind: 'denied', reason: decision.reason, position: document?.resolve(decision.reason.path) };
      }

      // 5. Y solo ahora, el material. La cuenta la nombró la decisión; la
      //    referencia vive en `accounts` y no cruzó nunca hacia el núcleo.
      const binding = bind(wiring.accounts, decision.account.id);
      if (binding.kind !== 'bound') {
        return {
          kind: 'credential-failed',
          account: decision.account.id,
          detail: 'la cuenta no resuelve a ningún registro utilizable',
        };
      }

      let credential;
      try {
        credential = await ports.credentials.resolve(binding.record.secret.uri);
      } catch (error) {
        return { kind: 'credential-failed', account: decision.account.id, detail: detailOf(error) };
      }

      // 6. El efecto.
      const transport = transports.get(tool.upstreamId);
      if (transport === undefined) {
        return {
          kind: 'upstream-failed',
          upstreamId: tool.upstreamId,
          detail: 'el upstream no está declarado en el artefacto',
        };
      }

      let result: ToolOutcome;
      try {
        result = await ports.invoker.invoke({
          upstreamId: tool.upstreamId,
          transport,
          account: decision.account.id,
          tool: tool.name,
          arguments: args,
          credential,
        });
      } catch (error) {
        return { kind: 'upstream-failed', upstreamId: tool.upstreamId, detail: detailOf(error) };
      }

      // 7. Y el contador, después de ejecutar. Un fallo al anotarlo no revierte
      //    una llamada ya hecha, pero tampoco puede pasar en silencio.
      if (decision.limits !== undefined) {
        try {
          await ports.usageWriter.record(key, at, decision.limits.windowMs);
        } catch {
          ports.recorder.record({
            at,
            principal: principal.id,
            issuer: principal.issuer,
            capability: tool.capability,
            tool: name,
            outcome: 'allow',
            code: 'usage_not_recorded',
            path: decision.reason.path,
            account: decision.account.id,
          });
        }
      }

      return { kind: 'invoked', result };
    },
  };
}
