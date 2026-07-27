/**
 * El vocabulario común de los adaptadores de **entrada**: el borde por el que
 * entra un cliente.
 *
 * Es periferia pura. No conoce política, ni contextos, ni decisiones: recibe dos
 * callbacks y los cablea a `tools/list` y `tools/call`. Quién decide qué se
 * lista y qué se ejecuta vive en la composición, que es donde los cinco
 * contextos se ven a la vez (decisión 0015).
 *
 * Ese corte es lo que permite que el SDK de MCP sea dependencia de `adapters/` y
 * de nada más, y es también lo que hace que `mcp-stdio-server.ts` y
 * `mcp-http-server.ts` compartan **todo** menos el transporte: si el corte
 * estuviera mal puesto, el segundo habría tenido que reimplementar el primero.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

/**
 * El puente entre la estrictez de este repositorio y la del SDK.
 *
 * `Transport` declara `sessionId?: string` y `onclose?: () => void`; los
 * transportes de HTTP los declaran como `string | undefined` y
 * `(() => void) | undefined`. Con `exactOptionalPropertyTypes` —que
 * `tsconfig.base.json` activa a propósito— "opcional" y "puede ser undefined" no
 * son lo mismo, aunque en ejecución sí lo sean.
 *
 * Se concentra la afirmación en una sola función, comentada, en vez de
 * repartirla por cuatro puntos de llamada: así hay un solo sitio que revisar
 * cuando el SDK ajuste sus tipos, y ninguna otra conversión suelta que pueda
 * esconder un error de verdad.
 */
export function connectable(transport: { close(): Promise<void> }): Transport {
  return transport as Transport;
}

/** Una tool tal como el cliente acaba viéndola. */
export interface ExposedTool {
  readonly name: string;
  readonly description: string | undefined;
  readonly inputSchema: unknown;
}

/** Lo que la composición devuelve para una invocación. Ya resuelto: aquí solo se transporta. */
export interface InvocationResult {
  readonly content: unknown;
  readonly isError: boolean;
}

/**
 * Lo que el transporte trae, tal como llega.
 *
 * Que sea un argumento y no una clausura es la diferencia que introduce HTTP:
 * con stdio la credencial es del **proceso** y vale para toda la sesión; con
 * HTTP es de la **petición**, y dos clientes distintos comparten servidor. Un
 * servidor HTTP que cerrara sobre una credencial fija atendería a todos con la
 * identidad del primero (decisión 0027).
 */
export interface PresentedCredentials {
  readonly issuer: string;
  readonly presented: string;
}

export interface GatewayHandlers {
  listTools(credentials: PresentedCredentials): Promise<readonly ExposedTool[]>;
  callTool(
    credentials: PresentedCredentials,
    name: string,
    args: Readonly<Record<string, unknown>> | undefined,
  ): Promise<InvocationResult>;
}

export interface RunningServer {
  /** Se resuelve cuando el cliente se va. Es lo que mantiene vivo al proceso. */
  readonly closed: Promise<void>;
  close(): Promise<void>;
}

/**
 * El esquema de entrada que el protocolo exige.
 *
 * Una tool cuyo catálogo no declara esquema se anuncia como objeto sin
 * restricciones, no se oculta: ocultarla convertiría un catálogo incompleto en
 * una revocación silenciosa, que es justo lo que el fallo cerrado quiere hacer
 * visible en otro sitio —el mapeo— y no aquí.
 */
function inputSchema(declared: unknown): Record<string, unknown> {
  return typeof declared === 'object' && declared !== null
    ? (declared as Record<string, unknown>)
    : { type: 'object' };
}

/**
 * Un servidor MCP sin transporte: los dos manejadores, y nada más.
 *
 * `credentials` se evalúa **en cada petición**, no al construir. Con stdio eso
 * relee el entorno; con HTTP, la cabecera de esa petición.
 */
export function mcpServer(
  info: { readonly name: string; readonly version: string },
  handlers: GatewayHandlers,
  credentials: () => PresentedCredentials,
): Server {
  const server = new Server(info, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = await handlers.listTools(credentials());
    return {
      tools: tools.map((tool) => ({
        name: tool.name,
        ...(tool.description === undefined ? {} : { description: tool.description }),
        inputSchema: inputSchema(tool.inputSchema),
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const result = await handlers.callTool(credentials(), request.params.name, request.params.arguments);
    // El protocolo distingue "la tool falló" de "la petición fue inválida". Una
    // denegación de política es lo primero: la petición era correcta y la
    // respuesta es que no. Devolver un error de protocolo la haría indistinguible
    // de un cliente mal escrito.
    return {
      content: Array.isArray(result.content) ? result.content : [{ type: 'text', text: String(result.content) }],
      isError: result.isError,
    };
  });

  return server;
}
