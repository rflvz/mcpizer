/**
 * `adapters` — la periferia.
 *
 * Implementa los contratos de puerto que declara `runtime/`. No importa ningún
 * contexto: la traducción entre vocabularios ocurre en composición.
 *
 * Hay **al menos dos implementaciones por puerto**, y ninguna de las segundas
 * —OIDC, git, MCP sobre HTTP, Vault, Redis, OpenTelemetry— obligó a cambiar un
 * contrato. Era lo que el invariante 9 prometía y lo que S3 existía para poner a
 * prueba: la variación se absorbe en la frontera, no en el modelo.
 *
 * Qué implementación atiende a cada emisor, upstream y cuenta lo despacha
 * `periphery.ts`, y lo dice el propio artefacto (decisión 0022).
 *
 * Los dos servidores MCP son la excepción de forma: no implementan ningún
 * puerto, porque son adaptadores de **entrada**. Consumen la orquestación en vez
 * de servirla.
 */
export { policyFile, type LoadedArtifact } from './policy-file.js';
export { policyGit, parseGitOrigin, type GitOrigin } from './policy-git.js';
export { policyHttp, parseHttpOrigin, type HttpOrigin } from './policy-http.js';
export { declaredCatalogFile, declaredCatalogYaml, type DiscoveredTool } from './declared-catalog.js';
export { staticKeyPrincipals, type IssuerVault, type StaticKeyIssuer } from './static-key-principal.js';
export { mtlsPrincipals, type MtlsIssuer } from './mtls-principal.js';
export { memoryUsage, type MemoryUsage } from './memory-usage.js';
export { redisUsage, type RedisUsage } from './redis-usage.js';
export { envCredentials } from './env-credentials.js';
export { vaultCredentials, type VaultOptions } from './vault-credentials.js';
export { gcpSecretsCredentials, type GcpSecretsOptions } from './gcp-secrets-credentials.js';
export { oauthCredentials, type OauthOptions } from './oauth-credentials.js';
export { mcpStdioInvoker, UPSTREAM_CREDENTIAL_ENV, type StdioInvoker } from './mcp-stdio-invoker.js';
export { mcpHttpInvoker, type HttpInvoker } from './mcp-http-invoker.js';
export { mcpDiscovery, type DeclaredUpstream, type McpDiscovery } from './mcp-discovery.js';
export { stderrRecorder } from './stderr-recorder.js';
export { fileRecorder, type FileRecorder, type FileRecorderOptions } from './file-recorder.js';
export {
  type ExposedTool,
  type GatewayHandlers,
  type InvocationResult,
  type PresentedCredentials,
  type RunningServer,
} from './mcp-server.js';
export { mcpStdioServer } from './mcp-stdio-server.js';
export {
  DEFAULT_MAX_BODY,
  HEALTH_PATH,
  mcpHttpServer,
  type HttpServerOptions,
  type RunningHttpServer,
} from './mcp-http-server.js';
export { otlpRecorder, type OtlpOptions, type OtlpRecorder } from './otlp-recorder.js';
export {
  catalogFor,
  periphery,
  policySourceFor,
  type CatalogPeriphery,
  type CloudSecretsAccess,
  type Periphery,
  type PeripheryIssuer,
  type PeripherySpec,
  type RecorderChoice,
  type UsageChoice,
  type VaultAccess,
} from './periphery.js';
