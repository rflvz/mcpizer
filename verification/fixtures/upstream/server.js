#!/usr/bin/env node
/**
 * Un upstream MCP de mentira, por stdio.
 *
 * No es un doble de los que la sección 2.4 de `docs/diseno/verificacion.md`
 * prohíbe: aquellos son los que sustituirían a algo *dentro* del núcleo, y el
 * núcleo se prueba sin ninguno. Esto es el otro lado del cable — un servidor MCP
 * real, hablando el protocolo real, que existe para que la pasarela tenga a
 * quién llamar sin depender de un servicio de verdad.
 *
 * Va en JavaScript a propósito: `verification/fixtures/` queda fuera del alcance
 * de la compilación y del ejecutor de tests, así que en TypeScript no
 * compilaría, y aquí se arranca como proceso.
 *
 * Confirma que la credencial **llegó**, y nunca devuelve su valor: es el otro
 * extremo del invariante 6 y no tiene por qué ayudar a romperlo.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
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

const server = new Server({ name: 'upstream-de-mentira', version: '0.0.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const credential = process.env['MCP_UPSTREAM_CREDENTIAL'];
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          tool: request.params.name,
          arguments: request.params.arguments ?? {},
          // Si la credencial llegó, y nunca cuál. La longitud basta para
          // distinguir dos cuentas sin revelar ninguna.
          credentialRecibida: typeof credential === 'string' && credential !== '',
          credentialLongitud: credential === undefined ? 0 : credential.length,
        }),
      },
    ],
    isError: false,
  };
});

await server.connect(new StdioServerTransport());
