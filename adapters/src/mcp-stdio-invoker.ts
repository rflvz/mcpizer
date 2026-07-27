/**
 * `ToolInvoker` como cliente MCP por stdio.
 *
 * Es uno de los dos transportes del propio protocolo, así que la variación
 * existe desde el primer día; el cliente por HTTP streamable llega en S3
 * (`docs/diseno/puertos.md` §2.6).
 *
 * **No reinterpreta la decisión.** Si una llamada llega aquí, está autorizada:
 * este adaptador no vuelve a comprobar la política y tampoco la relaja. Es el
 * único punto del sistema que ve a la vez credenciales y argumentos, y por eso
 * es el único que necesita cuidado explícito con lo que registra — de ahí que
 * el `stderr` del proceso hijo se descarte en vez de heredarse.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

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

/**
 * El nombre de la variable con que la credencial llega al upstream.
 *
 * stdio no tiene cabeceras: el canal es el entorno del proceso que se arranca.
 * Con HTTP (S3) pasa a ser una cabecera sin que el contrato del puerto cambie.
 */
export const UPSTREAM_CREDENTIAL_ENV = 'MCP_UPSTREAM_CREDENTIAL';

export interface StdioInvoker {
  invoke(call: Call): Promise<Outcome>;
  close(): Promise<void>;
}

/**
 * Una sesión por `(upstream, cuenta)`.
 *
 * La clave tiene que ser compuesta: el material difiere por cuenta y en stdio se
 * inyecta al arrancar el proceso hijo, así que una sesión por upstream
 * compartiría la credencial de la primera cuenta que llegara con todas las
 * demás. Y una sesión por llamada arrancaría un proceso por invocación.
 */
export function mcpStdioInvoker(): StdioInvoker {
  const sessions = new Map<string, Promise<Client>>();

  function connect(call: Call): Promise<Client> {
    if (call.transport.kind !== 'mcp-stdio') {
      return Promise.reject(
        new Error(
          `El upstream \`${call.upstreamId}\` declara transporte \`${call.transport.kind}\`, ` +
            'y este adaptador solo habla stdio.',
        ),
      );
    }
    const { command, args } = call.transport;

    const client = new Client({ name: 'mcpizer', version: '0.0.0' });
    const transport = new StdioClientTransport({
      command,
      args: [...args],
      // Solo lo que el hijo necesita. Heredar el entorno entero le entregaría
      // las credenciales de todas las demás cuentas declaradas.
      env: { PATH: process.env['PATH'] ?? '', [UPSTREAM_CREDENTIAL_ENV]: call.credential.value },
      // El `stderr` del hijo no se hereda: es el sitio por el que un upstream
      // descuidado devolvería la credencial a nuestra propia salida.
      stderr: 'ignore',
    });

    return client.connect(transport).then(() => client);
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
      await Promise.all(
        open.map((session) => session.then((client) => client.close()).catch(() => undefined)),
      );
    },
  };
}
