/**
 * El catálogo y el mapeo tool→capacidad.
 *
 * **La dirección del mapeo importa**: va de tool a capacidad, muchas a una.
 * Varias tools de distintos upstreams pueden realizar la misma capacidad, y esa
 * es la situación normal, no la excepción — es lo que permite sustituir un
 * proveedor por otro sin tocar la política.
 */

/** El término estable en el que se escribe la política. */
export interface Capability {
  readonly id: string;
  readonly description: string | undefined;
}

/** Dónde vive una tool, en los términos de este contexto. */
export interface ToolIdentity {
  readonly upstreamId: string;
  readonly name: string;
}

/** Una tool real que declara qué capacidad realiza. */
export interface ToolDescriptor extends ToolIdentity {
  readonly description: string | undefined;
  readonly inputSchema: unknown;
  readonly capability: string;
}

/** Lo que llega del descubrimiento: una tool que puede tener capacidad declarada o no. */
export interface CatalogEntry extends ToolIdentity {
  readonly description: string | undefined;
  readonly inputSchema: unknown;
  readonly capability: string | undefined;
}

export interface Catalog {
  readonly tools: readonly ToolDescriptor[];
  /**
   * Las que existen y ninguna declaración cubre. No están en `tools`, así que
   * no son visibles ni invocables; se conservan aparte solo para poder
   * señalarlas en la verificación en seco.
   */
  readonly unmapped: readonly ToolIdentity[];
}

/**
 * Una tool sin capacidad declarada **no entra en el catálogo**.
 *
 * No es un caso de error de configuración que haya que recordar comprobar: es
 * fallo cerrado aplicado al catálogo (invariante 3). Un upstream que añade una
 * tool nueva no la expone a nadie hasta que alguien declara qué realiza.
 */
export function buildCatalog(entries: readonly CatalogEntry[]): Catalog {
  const tools: ToolDescriptor[] = [];
  const unmapped: ToolIdentity[] = [];
  for (const entry of entries) {
    if (entry.capability === undefined) {
      unmapped.push({ upstreamId: entry.upstreamId, name: entry.name });
      continue;
    }
    tools.push({
      upstreamId: entry.upstreamId,
      name: entry.name,
      description: entry.description,
      inputSchema: entry.inputSchema,
      capability: entry.capability,
    });
  }
  return { tools, unmapped };
}

/** Las capacidades que alguna tool del catálogo realiza de verdad. */
export function realizedCapabilities(catalog: Catalog): readonly string[] {
  return [...new Set(catalog.tools.map((tool) => tool.capability))].sort();
}

/**
 * El catálogo filtrado que el cliente acaba viendo, dada una lista de
 * capacidades concedidas. Lo no concedido no se anuncia.
 */
export function visibleTools(catalog: Catalog, granted: readonly string[]): readonly ToolDescriptor[] {
  const allowed = new Set(granted);
  return catalog.tools.filter((tool) => allowed.has(tool.capability));
}
