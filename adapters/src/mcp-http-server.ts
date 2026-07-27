/**
 * El servidor MCP por HTTP streamable: el mismo borde, con cabeceras.
 *
 * Es la mitad que el README anunciaba desde S2 — "la clave llega por entorno
 * porque stdio no tiene cabeceras; con HTTP, en la sesión 3, será una cabecera".
 *
 * Y es la que obliga a que la credencial sea un **argumento** de los
 * manejadores y no una clausura: con stdio hay un proceso por cliente, así que
 * la identidad es del proceso; con HTTP hay un proceso para todos, y dos
 * clientes con identidades distintas llegan por el mismo puerto. Cerrar sobre
 * una credencial fija aquí atendería a todo el mundo con la del primero, que es
 * un fallo de autorización, no de fontanería (decisión 0027).
 *
 * Cada petición se atiende con su propio servidor MCP, sin sesión: es el modo
 * que el SDK llama *stateless*, y es lo que hace que la identidad no pueda
 * filtrarse de una petición a la siguiente por un estado compartido.
 */
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  connectable,
  mcpServer,
  type GatewayHandlers,
  type PresentedCredentials,
  type RunningServer,
} from './mcp-server.js';

export interface HttpServerOptions {
  /** El emisor que se le atribuye a quien se conecta por este puerto. */
  readonly issuer: string;
  readonly port?: number;
  readonly host?: string;
  /** La ruta del endpoint MCP. */
  readonly path?: string;
  /** De qué cabecera se toma la credencial. `Authorization` acepta el prefijo `Bearer`. */
  readonly header?: string;
}

export interface RunningHttpServer extends RunningServer {
  /** El puerto real: con `port: 0` lo elige el sistema, y hace falta saberlo. */
  readonly port: number;
}

/**
 * Lo presentado, extraído de la cabecera.
 *
 * La ausencia se traduce a cadena vacía y no a un error de transporte: quien
 * decide qué significa "sin credencial" es `PrincipalResolver`, y adelantarlo
 * aquí convertiría una denegación explicable en un 401 mudo.
 */
function presented(request: IncomingMessage, header: string): string {
  const raw = request.headers[header.toLowerCase()];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || value === '') return '';
  return value.startsWith('Bearer ') ? value.slice('Bearer '.length) : value;
}

export async function mcpHttpServer(
  info: { readonly name: string; readonly version: string },
  handlers: GatewayHandlers,
  options: HttpServerOptions,
): Promise<RunningHttpServer> {
  const path = options.path ?? '/mcp';
  const header = options.header ?? 'Authorization';

  const abiertas = new Set<{ close(): Promise<void> }>();

  const atiende = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    if (url.pathname !== path) {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: `El endpoint MCP de este servidor es \`${path}\`.` }));
      return;
    }

    const credentials: PresentedCredentials = {
      issuer: options.issuer,
      presented: presented(request, header),
    };

    const server = mcpServer(info, handlers, () => credentials);
    // Sin `sessionIdGenerator`: el SDK llama a eso modo *stateless*, y es lo que
    // impide que la identidad de una petición sobreviva a la siguiente.
    const transport = new StreamableHTTPServerTransport({});

    const cerrable = {
      close: async (): Promise<void> => {
        await transport.close().catch(() => undefined);
        await server.close().catch(() => undefined);
      },
    };
    abiertas.add(cerrable);
    response.on('close', () => {
      abiertas.delete(cerrable);
      void cerrable.close();
    });

    await server.connect(connectable(transport));
    await transport.handleRequest(request, response);
  };

  const http: HttpServer = createServer((request, response) => {
    void atiende(request, response).catch(() => {
      if (!response.headersSent) {
        response.writeHead(500, { 'content-type': 'application/json' });
        // Sin detalle: lo que falla aquí es transporte, y un mensaje de
        // diagnóstico en el borde exterior es superficie que nadie ha pedido.
        response.end(JSON.stringify({ error: 'La pasarela no pudo atender la petición.' }));
      } else {
        response.end();
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(options.port ?? 0, options.host ?? '127.0.0.1', () => {
      http.removeListener('error', reject);
      resolve();
    });
  });

  const address = http.address();
  const port = typeof address === 'object' && address !== null ? address.port : (options.port ?? 0);

  let resolveClosed: () => void = () => undefined;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });

  return {
    port,
    closed,
    async close(): Promise<void> {
      await Promise.all([...abiertas].map((cerrable) => cerrable.close()));
      abiertas.clear();
      await new Promise<void>((resolve) => http.close(() => resolve()));
      resolveClosed();
    },
  };
}
