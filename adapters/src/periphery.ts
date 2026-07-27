/**
 * El compositor de la periferia: qué implementación atiende cada puerto.
 *
 * Es la pieza que hace literal el criterio de S3 —"cada puerto tiene al menos
 * dos implementaciones **intercambiables por configuración**"— y la que explica
 * dónde vive esa configuración (decisión 0022).
 *
 * Cuatro de los siete puertos **no eligen una implementación, eligen una por
 * elemento**, porque el artefacto ya lo declara: `issuers[].kind` dice si un
 * emisor es OIDC o clave estática, `upstreams[].transport.kind` dice si un
 * upstream se alcanza por stdio o por HTTP, y el esquema de `accounts[].secret.ref`
 * dice si una credencial está en el entorno o en la bóveda. La misma ejecución
 * habla stdio con un upstream y HTTP con otro. Eso no es una bandera: es un
 * **despachador**.
 *
 * Los otros tres se eligen al arrancar, porque no caben en el artefacto: de
 * dónde se carga el propio artefacto, dónde viven los contadores y adónde va la
 * auditoría son hechos del despliegue, no de la política.
 *
 * Y aquí vive el **ciclo de vida** (decisión 0023). `DecisionRecorder` no
 * declara `close()` y `UsageReader` tampoco; añadírselo obligaría a tocar
 * `runtime/src/ports.ts`, que es justo lo que S3 promete no hacer. Así que lo
 * recoge el compositor: un solo `close()` que cierra invocadores, descubrimiento,
 * almacén y exportador.
 */
import { declaredCatalogFile } from './declared-catalog.js';
import { envCredentials } from './env-credentials.js';
import { mcpDiscovery, type DeclaredUpstream, type DiscoveredTool } from './mcp-discovery.js';
import { mcpHttpInvoker } from './mcp-http-invoker.js';
import { mcpStdioInvoker } from './mcp-stdio-invoker.js';
import { memoryUsage } from './memory-usage.js';
import { oidcPrincipals, type OidcIssuer } from './oidc-principal.js';
import { otlpRecorder } from './otlp-recorder.js';
import { policyFile } from './policy-file.js';
import { parseGitOrigin, policyGit } from './policy-git.js';
import { redisUsage } from './redis-usage.js';
import { staticKeyPrincipals, type IssuerVault, type StaticKeyIssuer } from './static-key-principal.js';
import { stderrRecorder } from './stderr-recorder.js';
import { vaultCredentials } from './vault-credentials.js';

// ─────────────────────────────────────────────────────────────────────────────
// Lo que el compositor necesita saber.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Un emisor tal como el artefacto lo declara.
 *
 * `discovery` y `audience` los trae la cáscara desde el documento, porque el
 * modelo compilado de `policy` no los lleva y ampliarlo cambiaría su retrato de
 * superficie (decisión 0029).
 */
export interface PeripheryIssuer {
  readonly id: string;
  readonly kind: string;
  readonly subject: string | undefined;
  readonly secretRef: string | undefined;
  readonly attributes: Readonly<Record<string, string>>;
  readonly discovery: string | undefined;
  readonly audience: string | undefined;
}

export type UsageChoice = { readonly kind: 'memory' } | { readonly kind: 'redis'; readonly url: string };

export type RecorderChoice =
  | { readonly kind: 'stderr' }
  | { readonly kind: 'otlp'; readonly endpoint: string; readonly serviceName?: string };

/** Dónde está la bóveda. Sin ella, `vault://` no se resuelve y se dice por qué. */
export interface VaultAccess {
  readonly address: string;
  readonly token: string;
}

export interface PeripherySpec {
  readonly issuers: readonly PeripheryIssuer[];
  readonly upstreams: readonly DeclaredUpstream[];
  readonly usage?: UsageChoice;
  readonly recorder?: RecorderChoice;
  readonly vault?: VaultAccess;
}

// ─────────────────────────────────────────────────────────────────────────────
// Los puertos que se eligen antes de compilar.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `PolicySource`: fichero o git, según la forma del argumento.
 *
 * `git+<url>#<ref>:<ruta>` en vez de una bandera nueva: así los cinco comandos
 * de la CLI aceptan las dos formas sin que ninguno tenga que enterarse.
 */
export function policySourceFor(specifier: string): { load(): Promise<{ text: string; version: string; origin: string }> } {
  const git = parseGitOrigin(specifier);
  return git === undefined ? policyFile(specifier) : policyGit(git);
}

export interface CatalogPeriphery {
  toolsOf(upstreamId?: string): Promise<readonly DiscoveredTool[]>;
  close(): Promise<void>;
}

/**
 * `CatalogSource`: el catálogo declarado o el descubrimiento MCP.
 *
 * Los dos son implementaciones de pleno derecho. El declarado **no es un
 * sustituto pobre**: es lo que hace posible el invariante 8, porque permite
 * verificar una configuración entera sin levantar ningún upstream.
 */
export function catalogFor(
  choice: { readonly kind: 'declared'; readonly path: string } | { readonly kind: 'discover'; readonly upstreams: readonly DeclaredUpstream[] },
): CatalogPeriphery {
  if (choice.kind === 'declared') {
    const source = declaredCatalogFile(choice.path);
    return { toolsOf: (upstreamId) => source.toolsOf(upstreamId), close: async () => undefined };
  }
  return mcpDiscovery(choice.upstreams);
}

// ─────────────────────────────────────────────────────────────────────────────
// El compositor.
// ─────────────────────────────────────────────────────────────────────────────

interface Credentials {
  readonly issuer: string;
  readonly presented: string;
}

type Failure = 'credential_missing' | 'credential_invalid' | 'credential_expired' | 'issuer_unknown';

type Resolved =
  | {
      readonly ok: true;
      readonly issuer: string;
      readonly subject: string;
      readonly attributes: Readonly<Record<string, string>>;
    }
  | { readonly ok: false; readonly problem: Failure };

type Transport =
  | { readonly kind: 'mcp-stdio'; readonly command: string; readonly args: readonly string[] }
  | { readonly kind: 'mcp-http'; readonly url: string };

interface Call {
  readonly upstreamId: string;
  readonly transport: Transport;
  readonly account: string;
  readonly tool: string;
  readonly arguments: Readonly<Record<string, unknown>> | undefined;
  readonly credential: { readonly value: string };
}

interface UsageKey {
  readonly principal: string;
  readonly capability: string;
}

interface UsageCount {
  readonly calls: number;
  readonly windowStart: number;
}

interface DecisionEntry {
  readonly at: number;
  readonly principal: string;
  readonly issuer: string;
  readonly capability: string | undefined;
  readonly tool: string | undefined;
  readonly outcome: 'allow' | 'deny';
  readonly code: string;
  readonly path: string;
  readonly account: string | undefined;
}

export interface Periphery {
  readonly principals: { resolve(credentials: Credentials | undefined): Promise<Resolved> };
  readonly usageReader: { read(key: UsageKey): Promise<UsageCount | undefined> };
  readonly usageWriter: { record(key: UsageKey, at: number, windowMs: number): Promise<void> };
  readonly credentials: { resolve(secretRef: string): Promise<{ value: string }> };
  readonly invoker: { invoke(call: Call): Promise<{ content: unknown; isError: boolean }>; close(): Promise<void> };
  readonly recorder: { record(entry: DecisionEntry): void };
  /** Qué emisores pueden autenticar de verdad, para poder decirlo al arrancar. */
  readonly usableIssuers: readonly string[];
  close(): Promise<void>;
}

/**
 * Cierra lo que tenga que cerrarse.
 *
 * Ni `UsageReader` ni `DecisionRecorder` declaran ciclo de vida, y sus dos
 * implementaciones no coinciden en si lo necesitan: memoria y stderr no cierran
 * nada, Redis y OTLP sí. La comprobación se hace aquí, en el compositor, en vez
 * de obligar a las cuatro a fingir un `close()` que la mitad no usa.
 */
async function cierra(candidato: object): Promise<void> {
  const close = (candidato as { close?: unknown }).close;
  if (typeof close === 'function') await (close as () => Promise<void>).call(candidato);
}

/** Un emisor `static-key` solo sirve si declara sujeto y clave (decisión 0017). */
function staticKeyIssuersOf(issuers: readonly PeripheryIssuer[]): StaticKeyIssuer[] {
  return issuers.flatMap((issuer) =>
    issuer.kind === 'static-key' && issuer.subject !== undefined && issuer.secretRef !== undefined
      ? [{ id: issuer.id, subject: issuer.subject, secretRef: issuer.secretRef, attributes: issuer.attributes }]
      : [],
  );
}

/** Y uno `oidc` solo sirve si declara descubrimiento: sin él no hay con qué validar. */
function oidcIssuersOf(issuers: readonly PeripheryIssuer[]): OidcIssuer[] {
  return issuers.flatMap((issuer) =>
    issuer.kind === 'oidc' && issuer.discovery !== undefined
      ? [{ id: issuer.id, discovery: issuer.discovery, audience: issuer.audience, attributes: issuer.attributes }]
      : [],
  );
}

export function periphery(spec: PeripherySpec): Periphery {
  const vault: IssuerVault | undefined = spec.vault;

  // ── PrincipalResolver: despacho por `issuers[].kind`. ──────────────────────
  const estaticos = staticKeyIssuersOf(spec.issuers);
  const oidc = oidcIssuersOf(spec.issuers);
  const porClave = staticKeyPrincipals(estaticos, vault);
  const porToken = oidcPrincipals(oidc);
  const kindOf = new Map<string, 'static-key' | 'oidc'>([
    ...estaticos.map((issuer) => [issuer.id, 'static-key'] as const),
    ...oidc.map((issuer) => [issuer.id, 'oidc'] as const),
  ]);

  const principals = {
    async resolve(credentials: Credentials | undefined): Promise<Resolved> {
      if (credentials === undefined || credentials.presented === '') {
        return { ok: false, problem: 'credential_missing' };
      }
      const kind = kindOf.get(credentials.issuer);
      // Un emisor declarado pero sin fontanería no autentica a nadie, y eso es
      // lo mismo que uno que no existe: no hay contra qué validar.
      if (kind === undefined) return { ok: false, problem: 'issuer_unknown' };
      return kind === 'oidc' ? porToken.resolve(credentials) : porClave.resolve(credentials);
    },
  };

  // ── CredentialResolver: despacho por el esquema de la referencia. ──────────
  const porEntorno = envCredentials();
  const porBoveda = vault === undefined ? undefined : vaultCredentials(vault);

  const credentials = {
    async resolve(secretRef: string): Promise<{ value: string }> {
      if (secretRef.startsWith('env://')) return porEntorno.resolve(secretRef);
      if (secretRef.startsWith('vault://')) {
        if (porBoveda === undefined) {
          // Se dice qué falta, no se degrada. Ninguna forma de fallo puede
          // acabar en ejecutar sin credencial.
          throw new Error(
            `La referencia \`${secretRef}\` necesita una bóveda, y no hay ninguna configurada. ` +
              'Declara `VAULT_ADDR` y `VAULT_TOKEN`.',
          );
        }
        return porBoveda.resolve(secretRef);
      }
      throw new Error(`La referencia \`${secretRef}\` usa un esquema que ningún adaptador resuelve.`);
    },
  };

  // ── ToolInvoker: despacho por `upstreams[].transport.kind`. ────────────────
  const porStdio = mcpStdioInvoker();
  const porHttp = mcpHttpInvoker();

  const invoker = {
    invoke(call: Call): Promise<{ content: unknown; isError: boolean }> {
      return call.transport.kind === 'mcp-http' ? porHttp.invoke(call) : porStdio.invoke(call);
    },
    async close(): Promise<void> {
      await Promise.all([porStdio.close(), porHttp.close()]);
    },
  };

  // ── UsageReader / UsageWriter: elección de despliegue. ─────────────────────
  const usage = spec.usage ?? { kind: 'memory' };
  const contadores = usage.kind === 'redis' ? redisUsage(usage.url) : memoryUsage();

  // ── DecisionRecorder: elección de despliegue. ──────────────────────────────
  const recorderChoice = spec.recorder ?? { kind: 'stderr' };
  const recorder =
    recorderChoice.kind === 'otlp'
      ? otlpRecorder({
          endpoint: recorderChoice.endpoint,
          ...(recorderChoice.serviceName === undefined ? {} : { serviceName: recorderChoice.serviceName }),
        })
      : stderrRecorder();

  return {
    principals,
    usageReader: contadores,
    usageWriter: contadores,
    credentials,
    invoker,
    recorder,
    usableIssuers: [...kindOf.keys()],

    async close(): Promise<void> {
      // El orden importa: primero se dejan de hacer cosas, y lo último que se
      // cierra es la auditoría, para que lo que ocurrió mientras se cerraba
      // también quede registrado.
      await invoker.close();
      await cierra(contadores);
      await cierra(recorder);
    },
  };
}
