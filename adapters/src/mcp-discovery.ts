/**
 * `CatalogSource` por descubrimiento MCP: le pregunta `tools/list` a cada
 * upstream declarado.
 *
 * Cierra lo que la decisión 0021 dejó pendiente en S2, y contesta las dos
 * preguntas que aquella decisión señalaba como el trabajo de verdad:
 *
 * **Cuándo se descubre.** Una vez, al arrancar — que es cuando `loadPolicy`
 * llama a `toolsOf()`. Refrescar en caliente cambiaría el catálogo que un
 * cliente ya vio sin que ninguna decisión lo hubiera autorizado, y eso es una
 * revocación silenciosa por la puerta de atrás.
 *
 * **Qué pasa si un upstream está caído.** Se propaga como fallo. Un upstream
 * caído **no** puede degradarse a "sin tools": eso permitiría que una caída
 * pasara silenciosamente por una revocación (`docs/diseno/puertos.md` §2.3).
 *
 * Sirve los dos transportes con el mismo código, así que este puerto pasa a
 * tener sus tres implementaciones previstas. El descubrimiento va **sin
 * autenticar**: `toolsOf()` no lleva credencial y abrirle una obligaría a tocar
 * el contrato del puerto (decisión 0025).
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { connectable } from './mcp-server.js';

type Transport =
  | { readonly kind: 'mcp-stdio'; readonly command: string; readonly args: readonly string[] }
  | { readonly kind: 'mcp-http'; readonly url: string };

export interface DeclaredUpstream {
  readonly id: string;
  readonly transport: Transport;
}

export interface DiscoveredTool {
  readonly upstreamId: string;
  readonly name: string;
  readonly description: string | undefined;
  readonly inputSchema: unknown;
}

export interface McpDiscovery {
  toolsOf(upstreamId?: string): Promise<readonly DiscoveredTool[]>;
  /** Cierra las sesiones abiertas. No está en el puerto; lo recoge el compositor (decisión 0023). */
  close(): Promise<void>;
}

export function mcpDiscovery(upstreams: readonly DeclaredUpstream[]): McpDiscovery {
  const sessions = new Map<string, Promise<Client>>();

  function connect(upstream: DeclaredUpstream): Promise<Client> {
    const client = new Client({ name: 'mcpizer', version: '0.0.0' });

    if (upstream.transport.kind === 'mcp-http') {
      return client
        .connect(connectable(new StreamableHTTPClientTransport(new URL(upstream.transport.url))))
        .then(() => client);
    }

    const { command, args } = upstream.transport;
    return client
      .connect(
        new StdioClientTransport({
          command,
          args: [...args],
          // Sin credencial: descubrir no es invocar. Y solo lo que el hijo
          // necesita — heredar el entorno entero le entregaría las credenciales
          // de todas las cuentas declaradas.
          env: { PATH: process.env['PATH'] ?? '' },
          // El `stderr` del hijo no se hereda: es el sitio por el que un upstream
          // descuidado devolvería algo a nuestra propia salida.
          stderr: 'ignore',
        }),
      )
      .then(() => client);
  }

  async function describe(upstream: DeclaredUpstream): Promise<readonly DiscoveredTool[]> {
    let session = sessions.get(upstream.id);
    if (session === undefined) {
      session = connect(upstream);
      sessions.set(upstream.id, session);
    }

    let client: Client;
    try {
      client = await session;
    } catch (cause) {
      sessions.delete(upstream.id);
      throw new Error(`El upstream \`${upstream.id}\` no responde; no se puede descubrir su catálogo.`, { cause });
    }

    let listed: Awaited<ReturnType<Client['listTools']>>;
    try {
      listed = await client.listTools();
    } catch (cause) {
      throw new Error(`El upstream \`${upstream.id}\` contestó algo ininteligible a \`tools/list\`.`, { cause });
    }

    // Describe lo que hay, sin filtrar ni decidir. El filtrado por capacidades
    // concedidas es de `capabilities` y `access`.
    return listed.tools.map((tool) => ({
      upstreamId: upstream.id,
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  }

  return {
    async toolsOf(upstreamId?: string): Promise<readonly DiscoveredTool[]> {
      const objetivo = upstreamId === undefined ? upstreams : upstreams.filter((up) => up.id === upstreamId);
      // En serie y no en paralelo: el primero que falle para el arranque, y
      // arrancar a medias con el catálogo de unos y no de otros sería servir un
      // catálogo que nadie declaró.
      const todas: DiscoveredTool[] = [];
      for (const upstream of objetivo) todas.push(...(await describe(upstream)));
      return todas;
    },

    async close(): Promise<void> {
      const open = [...sessions.values()];
      sessions.clear();
      await Promise.all(open.map((session) => session.then((client) => client.close()).catch(() => undefined)));
    },
  };
}
