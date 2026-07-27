/**
 * `ToolInvoker` como cliente MCP por HTTP streamable.
 *
 * Es el otro transporte del propio protocolo, simétrico a
 * `mcp-stdio-invoker.ts`. Lo que cambia es **por dónde viaja la credencial**:
 * allí es el entorno del proceso hijo, porque stdio no tiene cabeceras; aquí es
 * `Authorization: Bearer`, tal como el README anunciaba. El contrato del puerto
 * no se entera, que es justo lo que S3 tenía que demostrar.
 *
 * **No reinterpreta la decisión.** Si una llamada llega aquí, está autorizada.
 * Es el único punto del sistema que ve a la vez credenciales y argumentos, y por
 * eso el único que necesita cuidado explícito con lo que registra: no registra
 * nada.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { connectable } from './mcp-server.js';

type Transport =
  | { readonly kind: 'mcp-stdio'; readonly command: string; readonly args: readonly string[] }
  | { readonly kind: 'mcp-http'; readonly url: string };

interface Call {
  readonly upstreamId: string;
  readonly transport: Transport;
  readonly account: string;
  readonly tool: string;
  readonly arguments: Readonly<Record<string, unknown>> | undefined;
  readonly credential: { readonly value: string };
}

interface Outcome {
  readonly content: unknown;
  readonly isError: boolean;
}

export interface HttpInvoker {
  invoke(call: Call): Promise<Outcome>;
  close(): Promise<void>;
}

/**
 * Una sesión por `(upstream, cuenta)`, igual que en stdio y por el mismo motivo
 * de fondo (decisión 0020).
 *
 * Cambia la forma: aquí la credencial no se inyecta al arrancar un proceso sino
 * que se fija en las cabeceras del transporte. Compartir una sesión entre
 * cuentas compartiría esa cabecera, así que la clave sigue teniendo que ser
 * compuesta. Que el motivo sobreviva al cambio de transporte confirma la
 * decisión en vez de obligar a revisarla.
 */
export function mcpHttpInvoker(): HttpInvoker {
  const sessions = new Map<string, Promise<Client>>();

  function connect(call: Call): Promise<Client> {
    if (call.transport.kind !== 'mcp-http') {
      return Promise.reject(
        new Error(
          `El upstream \`${call.upstreamId}\` declara transporte \`${call.transport.kind}\`, ` +
            'y este adaptador solo habla HTTP.',
        ),
      );
    }

    const client = new Client({ name: 'mcpizer', version: '0.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(call.transport.url), {
      // La credencial va aquí y en ningún otro sitio. No se guarda en el cliente,
      // no se copia a un registro y no vuelve hacia dentro.
      requestInit: { headers: { Authorization: `Bearer ${call.credential.value}` } },
    });

    return client.connect(connectable(transport)).then(() => client);
  }

  return {
    async invoke(call: Call): Promise<Outcome> {
      const key = `${call.upstreamId} ${call.account}`;
      let session = sessions.get(key);
      if (session === undefined) {
        session = connect(call);
        sessions.set(key, session);
      }

      let client: Client;
      try {
        client = await session;
      } catch (cause) {
        // Una sesión que no arrancó no se cachea: el siguiente intento vuelve a
        // probar en vez de heredar el fallo para siempre.
        sessions.delete(key);
        throw new Error(`El upstream \`${call.upstreamId}\` no responde.`, { cause });
      }

      const result = await client.callTool({
        name: call.tool,
        arguments: call.arguments === undefined ? {} : { ...call.arguments },
      });

      return { content: result.content, isError: result.isError === true };
    },

    async close(): Promise<void> {
      const open = [...sessions.values()];
      sessions.clear();
      await Promise.all(open.map((session) => session.then((client) => client.close()).catch(() => undefined)));
    },
  };
}
