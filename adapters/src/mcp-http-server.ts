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
  /**
   * Qué contesta `/health`.
   *
   * Es lo único que este servidor atiende sin credencial, y por eso lo compone
   * quien arranca el proceso y no este adaptador: una sonda la interroga un
   * orquestador anónimo, así que todo lo que aparezca aquí es público. Sin este
   * campo no hay endpoint de salud, que es lo correcto cuando nadie sondea.
   */
  readonly health?: () => Readonly<Record<string, unknown>>;
  /**
   * Cuánto cuerpo se acepta en una petición, en bytes.
   *
   * Sin techo, cualquiera que alcance el puerto puede agotar la memoria del
   * proceso antes de que nadie haya decidido si tiene permiso para algo: la
   * denegación llega después de haber leído lo que se envió. Es la deuda que la
   * decisión 0027 dejó anotada para el empaquetado.
   */
  readonly maxBody?: number;
}

/** Un mensaje JSON-RPC de MCP no se parece a una subida de fichero. */
export const DEFAULT_MAX_BODY = 1024 * 1024;

export interface RunningHttpServer extends RunningServer {
  /** El puerto real: con `port: 0` lo elige el sistema, y hace falta saberlo. */
  readonly port: number;
  /** La interfaz en la que se escucha. En un contenedor no puede ser la de bucle. */
  readonly host: string;
}

/** La ruta de la sonda. Fija: un orquestador la configura en su lado, no en el nuestro. */
export const HEALTH_PATH = '/health';

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

/**
 * El techo de tamaño, comprobado antes de leer un solo byte del cuerpo.
 *
 * Se exige `Content-Length` en vez de contar lo que llega: contar obligaría a
 * consumir el flujo que el transporte necesita íntegro, y un contador que
 * interfiere con la lectura es peor que no tener techo. La contrapartida es que
 * un cuerpo troceado sin longitud se rechaza — ningún cliente MCP los manda, y
 * aceptarlos sería dejar abierta justo la vía que este techo cierra.
 */
function demasiadoGrande(
  request: IncomingMessage,
  maxBody: number,
): { status: number; mensaje: string } | undefined {
  // Sin cuerpo no hay nada que medir: `GET` abre el flujo de vuelta y `DELETE`
  // cierra la sesión.
  if (request.method !== 'POST') return undefined;

  const declared = request.headers['content-length'];
  if (declared === undefined) {
    return { status: 411, mensaje: 'Una petición con cuerpo tiene que declarar `Content-Length`.' };
  }

  const length = Number(declared);
  if (!Number.isInteger(length) || length < 0) {
    return { status: 400, mensaje: '`Content-Length` no es un número de bytes.' };
  }
  if (length > maxBody) {
    return { status: 413, mensaje: `El cuerpo excede el máximo de ${maxBody} bytes.` };
  }
  return undefined;
}

export async function mcpHttpServer(
  info: { readonly name: string; readonly version: string },
  handlers: GatewayHandlers,
  options: HttpServerOptions,
): Promise<RunningHttpServer> {
  const path = options.path ?? '/mcp';
  const header = options.header ?? 'Authorization';
  const maxBody = options.maxBody ?? DEFAULT_MAX_BODY;

  const abiertas = new Set<{ close(): Promise<void> }>();

  const atiende = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

    // La sonda va antes que el endpoint MCP y **sin credencial**: quien la
    // interroga es un orquestador que no tiene ninguna, y exigirle una
    // convertiría un proceso sano en uno que se reinicia en bucle.
    if (options.health !== undefined && url.pathname === HEALTH_PATH) {
      // Solo se lee. Contestar a cualquier verbo sería superficie que nadie ha
      // diseñado, en el único sitio del servidor al que se llega sin credencial.
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { 'content-type': 'application/json', allow: 'GET, HEAD' });
        response.end(JSON.stringify({ error: 'La sonda solo se lee.' }));
        return;
      }
      const body = JSON.stringify(options.health());
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(request.method === 'HEAD' ? undefined : body);
      return;
    }

    if (url.pathname !== path) {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: `El endpoint MCP de este servidor es \`${path}\`.` }));
      return;
    }

    const rechazo = demasiadoGrande(request, maxBody);
    if (rechazo !== undefined) {
      response.writeHead(rechazo.status, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: rechazo.mensaje }));
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

  const host = options.host ?? '127.0.0.1';

  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(options.port ?? 0, host, () => {
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
    host,
    closed,
    async close(): Promise<void> {
      await Promise.all([...abiertas].map((cerrable) => cerrable.close()));
      abiertas.clear();
      // `close()` deja de aceptar y espera a que **todas** las conexiones
      // abiertas terminen, y ahí es donde un cierre ordenado se cuelga para
      // siempre: basta un socket aceptado que no ha pedido nada —una sonda TCP
      // de un balanceador, un escaneo de puertos, un cliente que abre y calla—
      // para que ese `close()` no complete nunca. No es ocioso, así que
      // `closeIdleConnections()` no lo toca.
      //
      // Se cierran todas. Las peticiones en vuelo ya se han cerrado justo
      // arriba, una a una, así que aquí no queda trabajo que interrumpir.
      http.closeAllConnections();
      await new Promise<void>((resolve) => http.close(() => resolve()));
      resolveClosed();
    },
  };
}
