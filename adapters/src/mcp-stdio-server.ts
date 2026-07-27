/**
 * El servidor MCP por stdio: el borde por el que entra un cliente.
 *
 * Todo lo que no es transporte vive en `mcp-server.ts` y se comparte con el
 * servidor por HTTP. Lo que queda aquí es lo único que de verdad distingue a
 * stdio: **no tiene cabeceras**, así que la credencial llega por el entorno del
 * proceso que el cliente arranca, y vale para toda la sesión porque la sesión
 * *es* el proceso.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { mcpServer, type GatewayHandlers, type PresentedCredentials, type RunningServer } from './mcp-server.js';

export async function mcpStdioServer(
  info: { readonly name: string; readonly version: string },
  handlers: GatewayHandlers,
  /** Se lee en cada petición y no se guarda en ninguna parte. */
  credentials: () => PresentedCredentials,
): Promise<RunningServer> {
  const server = mcpServer(info, handlers, credentials);

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
