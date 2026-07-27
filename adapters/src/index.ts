/**
 * `adapters` — la periferia.
 *
 * Implementa los contratos de puerto que declara `runtime/`. No importa ningún
 * contexto: la traducción entre vocabularios ocurre en composición.
 *
 * Hay **una implementación por puerto, la más simple de cada uno**. Es
 * deliberado: S2 cierra el camino completo, no la variación. La segunda
 * implementación de cada frontera —OIDC, git, MCP sobre HTTP, Vault, Redis,
 * OpenTelemetry— es S3, y es donde se sabrá si algún contrato estaba mal
 * planteado.
 *
 * `mcp-stdio-server.ts` es la excepción de forma: no implementa ningún puerto,
 * porque es un adaptador de **entrada**. Consume la orquestación en vez de
 * servirla.
 */
export { policyFile, type LoadedArtifact } from './policy-file.js';
export { policyGit, parseGitOrigin, type GitOrigin } from './policy-git.js';
export { declaredCatalogFile, type DiscoveredTool } from './declared-catalog.js';
export { staticKeyPrincipals, type IssuerVault, type StaticKeyIssuer } from './static-key-principal.js';
export { memoryUsage, type MemoryUsage } from './memory-usage.js';
export { redisUsage, type RedisUsage } from './redis-usage.js';
export { envCredentials } from './env-credentials.js';
export { vaultCredentials, type VaultOptions } from './vault-credentials.js';
export { mcpStdioInvoker, UPSTREAM_CREDENTIAL_ENV, type StdioInvoker } from './mcp-stdio-invoker.js';
export { mcpHttpInvoker, type HttpInvoker } from './mcp-http-invoker.js';
export { mcpDiscovery, type DeclaredUpstream, type McpDiscovery } from './mcp-discovery.js';
export { stderrRecorder } from './stderr-recorder.js';
export {
  type ExposedTool,
  type GatewayHandlers,
  type InvocationResult,
  type PresentedCredentials,
  type RunningServer,
} from './mcp-server.js';
export { mcpStdioServer } from './mcp-stdio-server.js';
export { mcpHttpServer, type HttpServerOptions, type RunningHttpServer } from './mcp-http-server.js';
export { otlpRecorder, type OtlpOptions, type OtlpRecorder } from './otlp-recorder.js';
export {
  catalogFor,
  periphery,
  policySourceFor,
  type CatalogPeriphery,
  type Periphery,
  type PeripheryIssuer,
  type PeripherySpec,
  type RecorderChoice,
  type UsageChoice,
  type VaultAccess,
} from './periphery.js';
