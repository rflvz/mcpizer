/**
 * El mismo upstream de mentira que `server.js`, por HTTP streamable.
 *
 * Es deliberadamente el **mismo** catálogo y la **misma** respuesta: lo único
 * que cambia entre los dos ficheros es el transporte y por dónde llega la
 * credencial —entorno del proceso allí, cabecera aquí—, que es exactamente la
 * variación que S3 tiene que absorber sin tocar el contrato del puerto.
 *
 * Confirma que la credencial **llegó**, y nunca devuelve su valor: es el otro
 * extremo del invariante 6 y no tiene por qué ayudar a romperlo.
 */
import { createServer } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const TOOLS = [
  {
    name: 'create_invoice',
    description: 'Emite una factura contra un cliente',
    inputSchema: {
      type: 'object',
      properties: { customerId: { type: 'string' }, lines: { type: 'array' } },
      required: ['customerId', 'lines'],
    },
  },
  {
    name: 'delete_invoice',
    description: 'Existe aquí arriba y ningún mapeo la cubre',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
];

export async function startHttpUpstream() {
  /** Las cabeceras `authorization` vistas, para afirmar que la credencial viaja por ahí. */
  const autorizaciones = [];

  const http = createServer((request, response) => {
    void (async () => {
      const portador = request.headers['authorization'];
      autorizaciones.push(portador);

      // Un servidor por petición: en modo sin sesión es lo que el SDK espera, y
      // además deja que cada llamada vea su propia cabecera sin compartir estado.
      const mcp = new Server({ name: 'upstream-de-mentira-http', version: '0.0.0' }, { capabilities: { tools: {} } });

      mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

      mcp.setRequestHandler(CallToolRequestSchema, async (peticion) => {
        const credencial =
          typeof portador === 'string' && portador.startsWith('Bearer ')
            ? portador.slice('Bearer '.length)
            : undefined;
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                tool: peticion.params.name,
                arguments: peticion.params.arguments ?? {},
                // Si la credencial llegó, y nunca cuál. La longitud basta para
                // distinguir dos cuentas sin revelar ninguna.
                credentialRecibida: credencial !== undefined && credencial !== '',
                credentialLongitud: credencial === undefined ? 0 : credencial.length,
              }),
            },
          ],
          isError: false,
        };
      });

      const transporte = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      response.on('close', () => {
        void transporte.close();
        void mcp.close();
      });

      await mcp.connect(transporte);
      await transporte.handleRequest(request, response);
    })().catch(() => {
      if (!response.headersSent) response.writeHead(500).end();
    });
  });

  await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));

  return {
    url: `http://127.0.0.1:${http.address().port}/mcp`,
    autorizaciones,
    detiene: () => new Promise((resolve) => http.close(() => resolve())),
    close: () => new Promise((resolve) => http.close(() => resolve())),
  };
}
