/**
 * `capabilities` — ¿qué puede hacerse, y a qué tools reales corresponde?
 *
 * Es el contexto que hace posible el invariante 7: la política se escribe en
 * términos de capacidades, y las tools reales cambian de nombre, se reorganizan
 * y se sustituyen sin que ninguna configuración existente se rompa.
 *
 * No decide nada. Traduce.
 */
export {
  buildCatalog,
  realizedCapabilities,
  visibleTools,
  type Capability,
  type Catalog,
  type CatalogEntry,
  type ToolDescriptor,
  type ToolIdentity,
} from './catalog.js';
