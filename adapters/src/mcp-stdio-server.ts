/**
 * El servidor MCP por stdio: el borde por el que entra un cliente.
 *
 * Es periferia pura. No conoce política, ni contextos, ni decisiones: recibe dos
 * callbacks y los cablea a `tools/list` y `tools/call`. Quién decide qué se
 * lista y qué se ejecuta vive en la composición, que es donde los cinco
 * contextos se ven a la vez.
 *
 * Ese corte es lo que permite que el SDK de MCP sea dependencia de `adapters/` y
 * de nada más — `runtime/` orquesta sin saber qué protocolo hay debajo.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

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

export interface GatewayHandlers {
  listTools(): Promise<readonly ExposedTool[]>;
  callTool(name: string, args: Readonly<Record<string, unknown>> | undefined): Promise<InvocationResult>;
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

export async function mcpStdioServer(
  info: { readonly name: string; readonly version: string },
  handlers: GatewayHandlers,
): Promise<RunningServer> {
  const server = new Server(info, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = await handlers.listTools();
    return {
      tools: tools.map((tool) => ({
        name: tool.name,
        ...(tool.description === undefined ? {} : { description: tool.description }),
        inputSchema: inputSchema(tool.inputSchema),
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const result = await handlers.callTool(request.params.name, request.params.arguments);
    // El protocolo distingue "la tool falló" de "la petición fue inválida". Una
    // denegación de política es lo primero: la petición era correcta y la
    // respuesta es que no. Devolver un error de protocolo la haría indistinguible
    // de un cliente mal escrito.
    return {
      content: Array.isArray(result.content) ? result.content : [{ type: 'text', text: String(result.content) }],
      isError: result.isError,
    };
  });

  const closed = new Promise<void>((resolve) => {
    server.onclose = (): void => {
      resolve();
    };
  });

  await server.connect(new StdioServerTransport());

  return {
    closed,
    async close(): Promise<void> {
      await server.close();
    },
  };
}
