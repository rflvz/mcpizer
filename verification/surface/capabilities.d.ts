// Retrato de la superficie pública de `capabilities`.
// Generado por `pnpm surface`; no se edita a mano.

declare const buildCatalog: (entries: readonly CatalogEntry[]) => Catalog;

export interface Capability {
  readonly id: string;
  readonly description: string | undefined;
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

export interface CatalogEntry extends ToolIdentity {
  readonly description: string | undefined;
  readonly inputSchema: unknown;
  readonly capability: string | undefined;
}

declare const realizedCapabilities: (catalog: Catalog) => readonly string[];

export interface ToolDescriptor extends ToolIdentity {
  readonly description: string | undefined;
  readonly inputSchema: unknown;
  readonly capability: string;
}

export interface ToolIdentity {
  readonly upstreamId: string;
  readonly name: string;
}

declare const visibleTools: (catalog: Catalog, granted: readonly string[]) => readonly ToolDescriptor[];
