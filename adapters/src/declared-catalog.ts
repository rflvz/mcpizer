/**
 * `CatalogSource` sobre catálogo declarado.
 *
 * No es un doble de test: es lo que hace posible el invariante 8, porque permite
 * verificar una configuración entera sin levantar ningún upstream
 * (`docs/diseno/puertos.md` §2.3). Las otras dos implementaciones previstas
 * —MCP por stdio y MCP por HTTP— llegan con la pasarela.
 */
import { readFile } from 'node:fs/promises';
import { parse, stringify } from 'yaml';

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

/**
 * El catálogo declarado, escrito.
 *
 * Es la otra mitad de este adaptador, y la que cierra lo que las decisiones 0021
 * y 0025 dejaron anotado dos veces: el catálogo declarado es lo que hace posible
 * el invariante 8 —verificar una configuración entera sin levantar ningún
 * upstream— y hasta ahora había que escribirlo a mano.
 *
 * Va aquí, junto al lector, a propósito. El formato tiene un solo dueño: si el
 * que escribe y el que lee vivieran separados, la primera vez que uno de los dos
 * cambiara se descubriría en un despliegue.
 *
 * Se ordena por upstream y por nombre porque el resultado se versiona: un orden
 * que dependiera de en qué orden contestaron los upstreams produciría un diff
 * distinto en cada ejecución, y un fichero cuyo diff es ruido deja de revisarse.
 */
export function declaredCatalogYaml(tools: readonly DiscoveredTool[]): string {
  const ordenadas = [...tools].sort(
    (a, b) => a.upstreamId.localeCompare(b.upstreamId) || a.name.localeCompare(b.name),
  );

  return stringify(
    {
      version: 1,
      tools: ordenadas.map((tool) => ({
        upstream: tool.upstreamId,
        name: tool.name,
        ...(tool.description === undefined ? {} : { description: tool.description }),
        // El esquema viaja tal cual lo dio el upstream: reescribirlo aquí sería
        // inventarse un contrato que nadie ha declarado.
        ...(tool.inputSchema === undefined ? {} : { inputSchema: tool.inputSchema }),
      })),
    },
    { lineWidth: 0 },
  );
}
