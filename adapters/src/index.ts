/**
 * `adapters` — la periferia.
 *
 * Implementa los contratos de puerto que declara `runtime/`. No importa ningún
 * contexto: la traducción entre vocabularios ocurre en composición.
 *
 * En S1 solo existen los dos que la verificación en seco necesita —el artefacto
 * y el catálogo declarado—; el resto llega con la pasarela.
 */
export { policyFile, type LoadedArtifact } from './policy-file.js';
export { declaredCatalogFile, type DiscoveredTool } from './declared-catalog.js';
