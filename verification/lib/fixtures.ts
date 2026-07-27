/**
 * La fachada tipada de los servidores de fixture.
 *
 * Los fixtures viven en JavaScript porque `verification/fixtures/` queda fuera
 * de la compilación y del linter — son el otro lado del cable, no código del
 * producto. Pero los tests sí se compilan, así que aquí se les pone tipo una vez
 * y no en cada test.
 *
 * Se cargan con `import()` dinámico contra una URL de fichero: un import
 * estático los metería en el programa de TypeScript, que es justo lo que su
 * exclusión evita.
 */
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// La raíz se calcula aquí y no se toma de `run-checks.ts`: ese módulo arrastra
// ESLint y dependency-cruiser, y los tests de `adapters/` no tienen por qué
// cargar el arnés entero para levantar un servidor de fixture.
const FIXTURES = join(fileURLToPath(new URL('../..', import.meta.url)), 'verification', 'fixtures');

async function load(...segments: string[]): Promise<Record<string, unknown>> {
  return (await import(pathToFileURL(join(FIXTURES, ...segments)).href)) as Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────

export interface TokenOptions {
  readonly subject?: string;
  readonly audience?: string;
  readonly issuer?: string;
  readonly claims?: Readonly<Record<string, unknown>>;
  readonly expiresInSeconds?: number;
  readonly notBeforeSeconds?: number;
  readonly at?: number;
}

export interface OidcFixture {
  /** La URL de descubrimiento, tal como se declara en el artefacto. */
  readonly discovery: string;
  readonly issuer: string;
  emite(options?: TokenOptions): string;
  /** Firma con una clave que el JWKS no publica: token bien formado, firma que no valida. */
  emiteConFirmaAjena(options?: TokenOptions): string;
  close(): Promise<void>;
}

export async function startOidc(): Promise<OidcFixture> {
  const module = await load('oidc', 'server.js');
  return (module['startOidc'] as () => Promise<OidcFixture>)();
}

// ─────────────────────────────────────────────────────────────────────────────

export interface VaultFixture {
  readonly url: string;
  readonly token: string;
  readonly peticiones: readonly string[];
  /** Cae la bóveda: el caso de "inalcanzable". */
  detiene(): Promise<void>;
  close(): Promise<void>;
}

export async function startVault(options?: {
  token?: string;
  secrets?: Readonly<Record<string, Readonly<Record<string, string>>>>;
}): Promise<VaultFixture> {
  const module = await load('vault', 'server.js');
  return (module['startVault'] as (o?: unknown) => Promise<VaultFixture>)(options);
}

// ─────────────────────────────────────────────────────────────────────────────

export interface RedisFixture {
  readonly url: string;
  readonly recibidos: readonly (readonly string[])[];
  volcado(): Record<string, Record<string, string>>;
  /** Cae el almacén, con las conexiones cortadas de golpe. */
  detiene(): Promise<void>;
  close(): Promise<void>;
}

export async function startRedis(): Promise<RedisFixture> {
  const module = await load('redis', 'server.js');
  return (module['startRedis'] as () => Promise<RedisFixture>)();
}

// ─────────────────────────────────────────────────────────────────────────────

export interface OtlpRecord {
  readonly timeUnixNano?: string;
  readonly body?: { stringValue?: string };
  readonly attributes?: readonly { key: string; value: Record<string, unknown> }[];
}

export interface OtlpFixture {
  readonly url: string;
  readonly crudo: readonly string[];
  registros(): readonly OtlpRecord[];
  close(): Promise<void>;
}

export async function startOtlpCollector(options?: { falla?: boolean }): Promise<OtlpFixture> {
  const module = await load('otlp', 'collector.js');
  return (module['startOtlpCollector'] as (o?: unknown) => Promise<OtlpFixture>)(options);
}

// ─────────────────────────────────────────────────────────────────────────────

export interface HttpUpstreamFixture {
  readonly url: string;
  readonly autorizaciones: readonly (string | undefined)[];
  detiene(): Promise<void>;
  close(): Promise<void>;
}

export async function startHttpUpstream(): Promise<HttpUpstreamFixture> {
  const module = await load('upstream', 'http-server.js');
  return (module['startHttpUpstream'] as () => Promise<HttpUpstreamFixture>)();
}

// ─────────────────────────────────────────────────────────────────────────────

export interface GcpFixture {
  readonly metadataUrl: string;
  readonly apiBase: string;
  /** Cada identidad prestada. Su longitud dice si se guardó o se pidió de nuevo. */
  readonly identidades: readonly string[];
  readonly lecturas: readonly string[];
  /** Rota la identidad: la que el adaptador tuviera guardada deja de valer. */
  rota(nueva?: string): void;
  /** Deja de aceptar cualquier identidad: el caso de "me han revocado". */
  revoca(): void;
  admite(): void;
  detiene(): Promise<void>;
  close(): Promise<void>;
}

export async function startGcp(options?: {
  secrets?: Record<string, string>;
  expiresIn?: number;
}): Promise<GcpFixture> {
  const module = await load('gcp', 'server.js');
  return (module['startGcp'] as (o?: unknown) => Promise<GcpFixture>)(options);
}

// ─────────────────────────────────────────────────────────────────────────────

export interface OauthFixture {
  readonly tokenUrl: string;
  /** Cada acuñación. Su longitud dice si el token se guardó o se pidió de nuevo. */
  readonly acuñaciones: readonly { client: string | null; scope: string | undefined }[];
  detiene(): Promise<void>;
  close(): Promise<void>;
}

export async function startOauth(options?: {
  clients?: Record<string, string>;
  expiresIn?: number;
}): Promise<OauthFixture> {
  const module = await load('oauth', 'server.js');
  return (module['startOauth'] as (o?: unknown) => Promise<OauthFixture>)(options);
}

// ─────────────────────────────────────────────────────────────────────────────

export interface PolicyHttpFixture {
  readonly url: string;
  readonly peticiones: readonly { path: string | undefined; cacheControl: string | undefined }[];
  /** Cambia lo que se sirve, sin tocar ninguna cabecera de versión. */
  sirve(nuevo: string, nuevoCodigo?: number): void;
  detiene(): Promise<void>;
  close(): Promise<void>;
}

export async function startPolicyHttp(options?: {
  body?: string;
  status?: number;
  contentType?: string;
}): Promise<PolicyHttpFixture> {
  const module = await load('policy-http', 'server.js');
  return (module['startPolicyHttp'] as (o?: unknown) => Promise<PolicyHttpFixture>)(options);
}
