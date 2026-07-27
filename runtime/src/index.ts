/**
 * `runtime` — composición: traduce, orquesta, ejecuta efectos.
 *
 * Es el único sitio donde los cinco contextos se ven a la vez. Conoce a todos, y
 * ninguno la conoce a ella.
 *
 * Hay dos cáscaras, y se distinguen por si ejecutan el efecto. `dry-run.ts`
 * reúne los hechos y decide, y ahí se detiene: es el invariante 8, y funciona
 * sin red, sin credenciales y sin despliegue. `gateway.ts` completa el ciclo
 * —resuelve la credencial, invoca la tool, registra la decisión— y es la
 * pasarela que un cliente MCP ve.
 *
 * Que las dos llamen a la **misma** función de decisión es lo que garantiza que
 * lo que `explain` promete en seco sea lo que la pasarela hace en caliente.
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
export {
  exposedName,
  gateway,
  type CallOutcome,
  type ExposedTool,
  type Gateway,
  type GatewayPorts,
  type ListOutcome,
} from './gateway.js';
export type {
  AuthenticationFailure,
  CatalogSource,
  CredentialMaterial,
  CredentialResolver,
  DecisionRecord,
  DecisionRecorder,
  DiscoveredTool,
  PolicyArtifact,
  PolicySource,
  PrincipalResolver,
  ResolvedPrincipal,
  ToolCall,
  ToolInvoker,
  ToolOutcome,
  TransportCredentials,
  UpstreamTransport,
  UsageCount,
  UsageKey,
  UsageReader,
  UsageWriter,
} from './ports.js';
export { literalAttributes, wire, type Wiring } from './wiring.js';
