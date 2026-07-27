/**
 * `runtime` — composición: traduce, orquesta, ejecuta efectos.
 *
 * En S1 el único efecto es imprimir: la verificación en seco no invoca nada, no
 * resuelve credenciales y no registra decisiones. Esa es exactamente la razón de
 * que este hito vaya primero — el invariante 8 convertido en producto, y el
 * banco de pruebas de todo lo posterior.
 */
export {
  effectiveDiff,
  explain,
  loadPolicy,
  seenBy,
  whoCan,
  type DecisionChange,
  type DecisionSummary,
  type Explanation,
  type LoadedPolicy,
  type Question,
  type ReachReport,
} from './dry-run.js';
export type { CatalogSource, DiscoveredTool, PolicyArtifact, PolicySource } from './ports.js';
export { literalAttributes, wire, type Wiring } from './wiring.js';
