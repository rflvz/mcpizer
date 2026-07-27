/**
 * `CatalogSource` sobre catálogo declarado.
 *
 * No es un doble de test: es lo que hace posible el invariante 8, porque permite
 * verificar una configuración entera sin levantar ningún upstream
 * (`docs/diseno/puertos.md` §2.3). Las otras dos implementaciones previstas
 * —MCP por stdio y MCP por HTTP— llegan con la pasarela.
 */
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';

export interface DiscoveredTool {
  readonly upstreamId: string;
  readonly name: string;
  readonly description: string | undefined;
  readonly inputSchema: unknown;
}

interface RawCatalog {
  tools?: { upstream?: unknown; name?: unknown; description?: unknown; inputSchema?: unknown }[];
}

/**
 * Describe lo que hay, sin filtrar ni decidir. Una respuesta ininteligible se
 * propaga como fallo del origen: degradarla a "sin tools" permitiría que un
 * fichero roto pasara por una revocación.
 */
export function declaredCatalogFile(path: string): { toolsOf(upstreamId?: string): Promise<readonly DiscoveredTool[]> } {
  const read = async (): Promise<readonly DiscoveredTool[]> => {
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch (cause) {
      throw new Error(`No se pudo leer el catálogo declarado en \`${path}\`.`, { cause });
    }

    let parsed: unknown;
    try {
      parsed = parse(text);
    } catch (cause) {
      throw new Error(`El catálogo declarado en \`${path}\` no es YAML válido.`, { cause });
    }

    const tools = (parsed as RawCatalog | null)?.tools;
    if (!Array.isArray(tools)) {
      throw new Error(`El catálogo declarado en \`${path}\` no contiene una lista \`tools\`.`);
    }

    return tools.map((tool, index) => {
      if (typeof tool.upstream !== 'string' || typeof tool.name !== 'string') {
        throw new Error(`La entrada ${index} del catálogo \`${path}\` no declara \`upstream\` y \`name\`.`);
      }
      return {
        upstreamId: tool.upstream,
        name: tool.name,
        description: typeof tool.description === 'string' ? tool.description : undefined,
        inputSchema: tool.inputSchema,
      };
    });
  };

  return {
    async toolsOf(upstreamId?: string): Promise<readonly DiscoveredTool[]> {
      const all = await read();
      return upstreamId === undefined ? all : all.filter((tool) => tool.upstreamId === upstreamId);
    },
  };
}
