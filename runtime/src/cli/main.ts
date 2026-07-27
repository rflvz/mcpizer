#!/usr/bin/env node
/**
 * La CLI de verificación en seco.
 *
 * Es el primer hito del proyecto porque es el invariante 8 convertido en
 * producto y no en promesa: valida y explica políticas sin infraestructura de
 * ningún tipo. Un linter de políticas ya justifica su existencia, y además se
 * convierte en el banco de pruebas de todo lo posterior (decisión 0007).
 *
 * Esta es la cáscara imperativa: aquí viven el reloj, el sistema de ficheros y
 * la salida estándar. El instante se captura *aquí* y entra en la decisión como
 * un hecho más — por eso no existe un puerto `Clock`.
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  catalogFor,
  declaredCatalogYaml,
  DEFAULT_MAX_BODY,
  HEALTH_PATH,
  mcpHttpServer,
  mcpStdioServer,
  periphery,
  policySourceFor,
  type CatalogPeriphery,
  type DeclaredUpstream,
  type GatewayHandlers,
  type Periphery,
  type PeripheryIssuer,
  type PresentedCredentials,
  type RecorderChoice,
  type RunningServer,
  type UsageChoice,
  type VaultAccess,
} from '@mcpizer/adapters';
import { hasErrors, schema, type CompiledPolicy } from '@mcpizer/policy';
import type { Instant, Usage } from '@mcpizer/access';
import {
  effectiveDiff,
  explain,
  gateway,
  loadPolicy,
  whoCan,
  type CatalogSource,
  type CredentialResolver,
  type DecisionRecorder,
  type GatewayPorts,
  type LoadedPolicy,
  type PolicySource,
  type PrincipalResolver,
  type ToolInvoker,
  type TransportCredentials,
  type UsageReader,
  type UsageWriter,
} from '../index.js';
import { renderCallOutcome, renderDiagnostics, renderDiff, renderExplanation, renderReach } from './render.js';

const USAGE = `mcpizer — verificación en seco de políticas. Sin red, sin credenciales, sin despliegue.

  <politica> es una ruta, \`git+<url>#<ref>:<ruta>\` para leerla de un repositorio a
  una referencia fija —que es el modo esperado en cuanto se revisa por PR— o una
  URL \`https://\`. Solo \`catalog\` y \`serve\` tocan la red.

  mcpizer validate <politica> [--catalog <catalogo.yaml>] [--json]
      Estructura, referencias colgantes, concesiones ambiguas y capacidades que
      ninguna tool realiza. Es lo que corre en CI sobre el PR que toca la política.

  mcpizer explain <politica> --issuer <id> --subject <s> --capability <id>
                  [--attr clave=valor]... [--at <ISO-8601>] [--usage <n|unknown|none>]
                  [--catalog <catalogo.yaml>] [--json]
      La decisión completa con su motivo y el sitio exacto a tocar.

  mcpizer who-can <politica> --capability <id> [--catalog <catalogo.yaml>] [--json]
      Quién llega a una capacidad y con qué cuenta. La pregunta de auditoría real.

  mcpizer diff <antes> <despues> [--at <ISO-8601>] [--catalog <catalogo.yaml>] [--json]
      Qué decisiones cambian. Un diff de texto no lo dice.

  mcpizer schema
      El JSON Schema del artefacto, para editores y validadores externos.

  mcpizer version [--json]
      Qué build está corriendo. Es la primera pregunta de cualquier incidencia.

  mcpizer catalog <politica>
      El catálogo declarado, generado preguntándoles a los upstreams reales.
      Se ejecuta una vez y su salida se versiona junto a la política; a partir de
      ahí \`validate\` y \`explain\` vuelven a funcionar sin red.

  mcpizer serve <politica> --issuer <id> (--catalog <catalogo.yaml> | --discover)
                [--key-env <VAR>] [--http [--host <ip>] [--port <n>] [--key-header <cabecera>]
                [--max-body <bytes>]]
                [--usage <redis://…>] [--recorder <stderr|file|otlp>]
                [--otlp-endpoint <url>]
                [--audit-file <ruta> [--audit-max-bytes <n>] [--audit-keep <n>]]
      La pasarela MCP. Un cliente ve solo lo concedido a la identidad con la que
      se conecta, e invocar una tool no listada deniega con motivo.

      Por stdio la clave se presenta por entorno, porque stdio no tiene
      cabeceras; con --http llega por cabecera y **por petición**, que es lo que
      permite que dos identidades distintas compartan puerto. Un emisor \`mtls\` la
      recibe por la cabecera que añade el terminador TLS: --key-header.

      Qué implementación atiende a cada emisor, upstream y cuenta lo dice el
      propio artefacto: \`kind\` (\`oidc\`, \`static-key\`, \`mtls\`), \`transport.kind\`
      y el esquema de \`secret.ref\` — \`env://\`, \`vault://\`, \`gcp-secrets://\` o
      \`oauth+<url>?client=…&secret=…\`, que acuña un token y lo renueva.
      La bóveda se declara con VAULT_ADDR y VAULT_TOKEN.

      Con --http se atiende además \`GET ${HEALTH_PATH}\`, sin credencial y sin nada
      canjeable dentro. --host por defecto es la interfaz de bucle; dentro de un
      contenedor hay que abrirla (--host 0.0.0.0) para que la sonda llegue.
      --max-body (${DEFAULT_MAX_BODY} bytes por defecto) acota lo que se acepta antes
      de decidir nada: la denegación llega después de haber leído la petición.

      TLS lo termina el despliegue, no este proceso, y aquí no se emite ninguna
      cabecera CORS: un origen web no es un cliente MCP (decisión 0033).

      SIGTERM y SIGINT cierran ordenadamente —clientes, sesiones upstream,
      contadores y auditoría, en ese orden— y salen con 0.

Códigos de salida: 0 sin hallazgos · 1 hallazgos · 2 uso incorrecto · 3 origen inalcanzable.`;

const OPTIONS = {
  catalog: { type: 'string' },
  discover: { type: 'boolean', default: false },
  json: { type: 'boolean', default: false },
  issuer: { type: 'string' },
  subject: { type: 'string' },
  attr: { type: 'string', multiple: true },
  capability: { type: 'string' },
  at: { type: 'string' },
  usage: { type: 'string' },
  'key-env': { type: 'string' },
  http: { type: 'boolean', default: false },
  host: { type: 'string' },
  port: { type: 'string' },
  'max-body': { type: 'string' },
  'key-header': { type: 'string' },
  recorder: { type: 'string' },
  'otlp-endpoint': { type: 'string' },
  'audit-file': { type: 'string' },
  'audit-max-bytes': { type: 'string' },
  'audit-keep': { type: 'string' },
  help: { type: 'boolean', short: 'h', default: false },
} as const;

/** De dónde lee la pasarela la clave que el cliente presenta, si nadie dice otra cosa. */
const DEFAULT_KEY_ENV = 'MCPIZER_API_KEY';

/**
 * En qué interfaz escucha la pasarela si nadie dice otra cosa.
 *
 * La de bucle, no la de todas: abrir un puerto de autorización a la red por
 * defecto es la clase de descuido que no se nota hasta que alguien lo encuentra.
 * Un contenedor sí necesita abrirla, y lo dice explícitamente con `--host`.
 */
const DEFAULT_HOST = '127.0.0.1';

/**
 * Qué build está corriendo.
 *
 * Se lee del manifiesto que acompaña al programa, que es el mismo fichero en el
 * árbol de trabajo y dentro del artefacto desplegable. Un número cableado en el
 * código diría la verdad hasta el primer despliegue en que alguien olvidara
 * tocarlo.
 */
function selfVersion(): string {
  try {
    const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
      version?: unknown;
    };
    return typeof manifest.version === 'string' ? manifest.version : 'desconocida';
  } catch {
    return 'desconocida';
  }
}

class UsageError extends Error {}

function required(value: string | undefined, flag: string): string {
  if (value === undefined || value === '') throw new UsageError(`Falta \`${flag}\`.`);
  return value;
}

function parseAttributes(pairs: readonly string[] | undefined): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const pair of pairs ?? []) {
    const separator = pair.indexOf('=');
    if (separator <= 0) throw new UsageError(`\`--attr ${pair}\` no tiene la forma clave=valor.`);
    attributes[pair.slice(0, separator)] = pair.slice(separator + 1);
  }
  return attributes;
}

/** El instante lo captura la cáscara, y por defecto es ahora. */
function parseInstant(value: string | undefined): Instant {
  if (value === undefined) return Date.now();
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new UsageError(`\`--at ${value}\` no es un instante ISO-8601.`);
  return parsed;
}

/**
 * Uso desconocido se trata como techo agotado, así que no puede ser el defecto
 * de una herramienta de diagnóstico: `explain` denegaría siempre y no serviría
 * para nada. El defecto es cero, y `--usage unknown` deja ejercitar la regla
 * (decisión 0014).
 */
function parseUsage(value: string | undefined, at: Instant): Usage {
  if (value === undefined || value === '0') return { kind: 'counted', calls: 0, windowStart: at };
  if (value === 'unknown') return { kind: 'unknown' };
  if (value === 'none') return { kind: 'not-consulted' };
  const calls = Number(value);
  if (!Number.isInteger(calls) || calls < 0) {
    throw new UsageError(`\`--usage ${value}\` no es un entero, ni \`unknown\`, ni \`none\`.`);
  }
  return { kind: 'counted', calls, windowStart: at };
}

async function load(specifier: string, catalog: CatalogSource | undefined): Promise<LoadedPolicy> {
  const source: PolicySource = policySourceFor(specifier);
  return loadPolicy(source, catalog);
}

/** Con `--catalog`, el catálogo declarado; sin él, nada, que es la verificación en seco pura. */
function declaredCatalog(catalogPath: string | undefined): CatalogPeriphery | undefined {
  return catalogPath === undefined ? undefined : catalogFor({ kind: 'declared', path: catalogPath });
}

/**
 * `discovery` y `audience` de cada emisor, sacados del **documento**.
 *
 * El modelo compilado de `policy` no los lleva: son enganche con la periferia, y
 * la verificación en seco solo les comprueba integridad referencial. Ampliarlo
 * cambiaría el retrato de superficie de `policy`, que es exactamente lo que el
 * criterio de S3 promete no tocar (decisión 0029).
 *
 * La traducción vive aquí, en la cáscara, por la misma razón por la que
 * `wiring.ts` traduce el artefacto para el núcleo: es el único sitio que conoce
 * a la vez el vocabulario del artefacto y el de la periferia.
 */
function oidcEndpoints(document: unknown): Map<string, { discovery?: string; audience?: string }> {
  const endpoints = new Map<string, { discovery?: string; audience?: string }>();
  const issuers = (document as { principals?: { issuers?: unknown } } | null)?.principals?.issuers;
  if (!Array.isArray(issuers)) return endpoints;

  for (const raw of issuers as { id?: unknown; discovery?: unknown; audience?: unknown }[]) {
    if (typeof raw.id !== 'string') continue;
    endpoints.set(raw.id, {
      ...(typeof raw.discovery === 'string' ? { discovery: raw.discovery } : {}),
      ...(typeof raw.audience === 'string' ? { audience: raw.audience } : {}),
    });
  }
  return endpoints;
}

function peripheryIssuers(policy: CompiledPolicy, document: unknown): PeripheryIssuer[] {
  const endpoints = oidcEndpoints(document);
  return policy.issuers.map((issuer) => {
    const extra = endpoints.get(issuer.id);
    return {
      id: issuer.id,
      kind: issuer.kind,
      subject: issuer.subject,
      secretRef: issuer.secretRef,
      attributes: issuer.attributes,
      discovery: extra?.discovery,
      audience: extra?.audience,
    };
  });
}

function upstreamsOf(policy: CompiledPolicy): DeclaredUpstream[] {
  return policy.upstreams.map((upstream) => ({ id: upstream.id, transport: upstream.transport }));
}

/** La bóveda no se declara en el artefacto: es un hecho del despliegue. */
function vaultAccess(): VaultAccess | undefined {
  const address = process.env['VAULT_ADDR'];
  const token = process.env['VAULT_TOKEN'];
  return address === undefined || address === '' || token === undefined || token === ''
    ? undefined
    : { address, token };
}

function usageChoice(value: string | undefined): UsageChoice {
  if (value === undefined || value === '' || value === 'memory') return { kind: 'memory' };
  if (value.startsWith('redis://') || value.startsWith('rediss://')) return { kind: 'redis', url: value };
  throw new UsageError(`\`--usage ${value}\` no es \`memory\` ni una URL \`redis://\`.`);
}

function parsePort(value: string | undefined): number {
  const port = value === undefined ? 0 : Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new UsageError(`\`--port ${String(value)}\` no es un puerto.`);
  }
  return port;
}

/** El techo de tamaño de petición. Un knob de operación: depende de qué tools se atienden. */
function parseMaxBody(value: string | undefined): number {
  if (value === undefined || value === '') return DEFAULT_MAX_BODY;
  const bytes = Number(value);
  if (!Number.isInteger(bytes) || bytes <= 0) {
    throw new UsageError(`\`--max-body ${value}\` no es un número de bytes positivo.`);
  }
  return bytes;
}

function entero(value: string | undefined, flag: string): number | undefined {
  if (value === undefined || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new UsageError(`\`${flag} ${value}\` no es un entero positivo.`);
  return parsed;
}

interface AuditValues {
  readonly recorder?: string | undefined;
  readonly endpoint?: string | undefined;
  readonly file?: string | undefined;
  readonly maxBytes?: string | undefined;
  readonly keep?: string | undefined;
}

function recorderChoice(values: AuditValues): RecorderChoice {
  const kind = values.recorder;
  if (kind === undefined || kind === 'stderr') return { kind: 'stderr' };

  if (kind === 'file') {
    if (values.file === undefined || values.file === '') {
      throw new UsageError('`--recorder file` necesita `--audit-file <ruta>`.');
    }
    const maxBytes = entero(values.maxBytes, '--audit-max-bytes');
    const keep = entero(values.keep, '--audit-keep');
    return {
      kind: 'file',
      path: values.file,
      ...(maxBytes === undefined ? {} : { maxBytes }),
      ...(keep === undefined ? {} : { keep }),
    };
  }

  if (kind !== 'otlp') throw new UsageError(`\`--recorder ${kind}\` no es \`stderr\`, \`file\` ni \`otlp\`.`);

  const target = values.endpoint ?? process.env['OTEL_EXPORTER_OTLP_ENDPOINT'];
  if (target === undefined || target === '') {
    throw new UsageError('`--recorder otlp` necesita `--otlp-endpoint` o `OTEL_EXPORTER_OTLP_ENDPOINT`.');
  }
  return { kind: 'otlp', endpoint: target };
}

interface ServeValues {
  catalog?: string | undefined;
  discover?: boolean | undefined;
  issuer?: string | undefined;
  'key-env'?: string | undefined;
  http?: boolean | undefined;
  host?: string | undefined;
  port?: string | undefined;
  'max-body'?: string | undefined;
  'key-header'?: string | undefined;
  usage?: string | undefined;
  recorder?: string | undefined;
  'otlp-endpoint'?: string | undefined;
  'audit-file'?: string | undefined;
  'audit-max-bytes'?: string | undefined;
  'audit-keep'?: string | undefined;
}

/**
 * Lo que contesta la sonda de salud.
 *
 * Se compone aquí, no en el adaptador, porque es el único sitio que sabe qué hay
 * y qué de eso es publicable. Va sin credencial a quien pregunte, así que la
 * regla es dura: **solo lo que no abre nada y no describe la instalación**.
 *
 * Sale la versión del artefacto de política —una huella del contenido, o el sha
 * en git—, que es lo que un operador necesita para saber si el proceso ya recogió
 * el cambio. No sale `origin`: es una ruta del sistema de ficheros o una URL de
 * repositorio, y una URL de repositorio es el sitio exacto donde alguien acaba
 * embebiendo un token.
 */
function healthReport(version: string, policyVersion: string): () => Readonly<Record<string, unknown>> {
  return () => ({ status: 'ok', version, policy: { version: policyVersion } });
}

/**
 * El cierre ordenado.
 *
 * Un orquestador manda SIGTERM y cuenta hasta su plazo antes de mandar SIGKILL.
 * Lo que se hace con ese margen es: dejar de aceptar, cerrar las sesiones
 * upstream —que en stdio son procesos hijo que quedarían huérfanos— y vaciar la
 * auditoría, que es lo último porque lo ocurrido durante el cierre también se
 * audita.
 *
 * **Se arma antes de abrir nada.** La ventana entre "empieza el arranque" y "hay
 * servidor que parar" no es corta: con `--discover` dura lo que tarde el upstream
 * más lento. Una señal ahí, sin manejador, mata el proceso por disposición por
 * defecto y deja vivos los hijos que el descubrimiento ya había arrancado.
 * Mientras no hay nada que parar, la parada se **anota**; se atiende en cuanto lo
 * hay.
 *
 * No hay temporizador que fuerce la salida. Un proceso que no termina solo tiene
 * un asa abierta que nadie cerró, y taparlo con `process.exit()` convertiría esa
 * fuga en algo que ya no se puede ver. Y como los manejadores son de un solo uso,
 * una **segunda** señal encuentra la disposición por defecto: quien quiera
 * insistir puede, sin llegar a `SIGKILL`.
 */
interface Parada {
  /** Qué parar, en cuanto se sabe. Si ya se había pedido parar, para al asignarlo. */
  atiende(stop: () => void): void;
  desarma(): void;
}

function armaParada(): Parada {
  let pedida = false;
  let parar: (() => void) | undefined;

  const señales: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];
  const manejador = (): void => {
    pedida = true;
    parar?.();
  };
  for (const señal of señales) process.once(señal, manejador);

  return {
    atiende(stop): void {
      parar = stop;
      if (pedida) stop();
    },
    desarma(): void {
      for (const señal of señales) process.off(señal, manejador);
    },
  };
}

/**
 * El catálogo declarado, generado preguntándoles a los upstreams.
 *
 * Cierra la deuda que las decisiones 0021 y 0025 dejaron anotada: el catálogo
 * declarado es lo que hace posible verificar una configuración entera sin
 * levantar nada, y hasta ahora había que escribirlo a mano.
 *
 * Es la única mitad del flujo que **sí** toca la red, y por eso es un comando
 * aparte y no una bandera de `validate`: se ejecuta una vez, contra los
 * upstreams reales, y su resultado se versiona junto a la política. A partir de
 * ahí todo lo demás vuelve a funcionar sin red, que es el invariante 8.
 *
 * Sale por stdout para poder redirigirlo. El registro va a stderr, como siempre.
 */
async function emitCatalog(artifactPath: string): Promise<number> {
  // Sin catálogo: aquí se está generando. Compilar en seco basta para saber qué
  // upstreams hay, que es lo único que hace falta para preguntarles.
  const preliminar = await load(artifactPath, undefined);
  if (preliminar.policy === undefined) {
    print([
      'La política no compila; no hay upstreams a los que preguntar.',
      '',
      ...renderDiagnostics(preliminar.artifact.origin, preliminar.diagnostics),
    ]);
    return 1;
  }

  const discovery = catalogFor({ kind: 'discover', upstreams: upstreamsOf(preliminar.policy) });
  try {
    // Un upstream caído aborta la generación. Escribir un catálogo al que le
    // faltan las tools de quien no contestó convertiría una caída en una
    // revocación silenciosa el día que ese fichero se use para verificar.
    const tools = await discovery.toolsOf();
    process.stdout.write(declaredCatalogYaml(tools));
    return 0;
  } finally {
    await discovery.close();
  }
}

/**
 * La pasarela.
 *
 * Es el único sitio donde se comprueba que los adaptadores cumplen los
 * contratos: `adapters/` no puede importar `runtime/` —sería un ciclo entre
 * paquetes—, así que la conformidad se verifica aquí, al asignar cada uno a una
 * variable del tipo de su puerto. El tipado estructural hace que eso sea una
 * comprobación real y no un gesto, y con dos implementaciones por puerto es
 * además la comprobación de que las dos encajan en el mismo hueco.
 */
async function serve(artifactPath: string, values: ServeValues): Promise<number> {
  // ── Primero, todo lo que puede rechazarse sin abrir nada. ──────────────────
  //
  // El orden importa más de lo que parece: una bandera mal escrita comprobada
  // *después* de arrancar el descubrimiento deja un proceso que sale con código
  // de uso y no termina, porque los hijos que ya arrancó lo mantienen vivo. Lo
  // barato de detectar se detecta antes de que haya algo que cerrar.
  const issuerId = required(values.issuer, '--issuer');
  const keyEnv = values['key-env'] ?? DEFAULT_KEY_ENV;

  if (values.catalog === undefined && values.discover !== true) {
    throw new UsageError('Falta `--catalog <catalogo.yaml>` o `--discover`.');
  }
  if (values.catalog !== undefined && values.discover === true) {
    throw new UsageError('`--catalog` y `--discover` son dos orígenes del catálogo; hay que elegir uno.');
  }

  const puerto = parsePort(values.port);
  const maxBody = parseMaxBody(values['max-body']);
  const contadores = usageChoice(values.usage);
  const auditoria = recorderChoice({
    recorder: values.recorder,
    endpoint: values['otlp-endpoint'],
    file: values['audit-file'],
    maxBytes: values['audit-max-bytes'],
    keep: values['audit-keep'],
  });

  // ── Y la parada, antes del primer recurso. ─────────────────────────────────
  const parada = armaParada();

  let catalog: CatalogPeriphery | undefined;
  let outside: Periphery | undefined;
  try {
    // El descubrimiento necesita saber qué upstreams hay, y eso solo lo dice la
    // política compilada — que a su vez quiere el catálogo para comprobar el
    // mapeo. Se rompe el bucle compilando primero sin catálogo: es una lectura
    // más del artefacto al arrancar, y a cambio ningún contrato se entera.
    catalog = declaredCatalog(values.catalog);
    if (values.discover === true) {
      const preliminar = await load(artifactPath, undefined);
      if (preliminar.policy === undefined) {
        print([
          'La política no compila; no hay upstreams a los que preguntar.',
          '',
          ...renderDiagnostics(preliminar.artifact.origin, preliminar.diagnostics),
        ]);
        return 1;
      }
      catalog = catalogFor({ kind: 'discover', upstreams: upstreamsOf(preliminar.policy) });
    }

    const loaded = await load(artifactPath, catalog);
    if (loaded.policy === undefined) {
      print([
        'La política no compila; no hay pasarela que levantar.',
        '',
        ...renderDiagnostics(loaded.artifact.origin, loaded.diagnostics),
      ]);
      return 1;
    }

    // El catálogo ya ha dicho todo lo que sabía: el descubrimiento ocurre una
    // vez al arrancar (decisión 0025) y lo compilado no vuelve a preguntarle.
    // Cerrarlo aquí devuelve los procesos hijo que abrió, en vez de tenerlos
    // ociosos durante toda la vida del proceso.
    await catalog?.close();
    catalog = undefined;

    outside = periphery({
      issuers: peripheryIssuers(loaded.policy, loaded.document?.value),
      upstreams: upstreamsOf(loaded.policy),
      usage: contadores,
      recorder: auditoria,
      ...(vaultAccess() === undefined ? {} : { vault: vaultAccess() as VaultAccess }),
    });

    // Un emisor que no declara su fontanería no autentica a nadie. No es un error
    // de autoría —el enganche con la periferia es opcional (decisión 0017)— pero
    // tampoco sirve aquí, y decirlo al arrancar es mejor que dejar que el primer
    // cliente se estrelle contra `issuer_unknown`.
    if (!outside.usableIssuers.includes(issuerId)) {
      throw new UsageError(
        `\`--issuer ${issuerId}\` no declara con qué autenticar: un emisor \`static-key\` necesita ` +
          '`subject` y `secret`, y uno `oidc` necesita `discovery`. ' +
          `Los que sí sirven: ${outside.usableIssuers.length === 0 ? 'ninguno' : outside.usableIssuers.join(', ')}.`,
      );
    }

    return await atiende(loaded, outside, parada, {
      issuerId,
      keyEnv,
      http: values.http === true,
      host: values.host ?? DEFAULT_HOST,
      puerto,
      maxBody,
      ...(values['key-header'] === undefined ? {} : { header: values['key-header'] }),
    });
  } finally {
    // Un arranque que falla a medias —descubrimiento contra un upstream caído,
    // puerto ocupado, bóveda mal declarada— tiene que **salir**, no quedarse
    // colgado con un hijo vivo y un código de salida que nunca se entrega.
    parada.desarma();
    await catalog?.close();
    await outside?.close();
  }
}

interface Escucha {
  readonly issuerId: string;
  readonly keyEnv: string;
  readonly http: boolean;
  readonly host: string;
  readonly puerto: number;
  readonly maxBody: number;
  readonly header?: string;
}

async function atiende(
  loaded: LoadedPolicy,
  outside: Periphery,
  parada: Parada,
  escucha: Escucha,
): Promise<number> {
  const ports: GatewayPorts = {
    principals: outside.principals satisfies PrincipalResolver,
    usageReader: outside.usageReader satisfies UsageReader,
    usageWriter: outside.usageWriter satisfies UsageWriter,
    credentials: outside.credentials satisfies CredentialResolver,
    invoker: outside.invoker satisfies ToolInvoker,
    recorder: outside.recorder satisfies DecisionRecorder,
    // El reloj vive aquí, en la cáscara. El instante entra en la decisión como
    // un hecho más, que es la razón de que no exista un puerto `Clock`.
    now: () => Date.now(),
  };

  const door = gateway(loaded, ports);

  const handlers: GatewayHandlers = {
    async listTools(credentials: PresentedCredentials) {
      const outcome = await door.list(credentials satisfies TransportCredentials);
      // Sin identidad no se anuncia nada. Lo no concedido no se marca como
      // prohibido: no sale (invariante 3).
      return outcome.kind === 'listed' ? outcome.tools : [];
    },
    async callTool(credentials: PresentedCredentials, name, args) {
      const outcome = await door.call(credentials satisfies TransportCredentials, name, args);
      if (outcome.kind === 'invoked') return outcome.result;
      return {
        content: [{ type: 'text', text: renderCallOutcome(loaded.artifact.origin, outcome) }],
        isError: true,
      };
    },
  };

  const info = { name: 'mcpizer', version: selfVersion() };
  let running: RunningServer;

  if (escucha.http) {
    const http = await mcpHttpServer(info, handlers, {
      issuer: escucha.issuerId,
      port: escucha.puerto,
      host: escucha.host,
      health: healthReport(info.version, loaded.artifact.version),
      maxBody: escucha.maxBody,
      ...(escucha.header === undefined ? {} : { header: escucha.header }),
    });
    // Por HTTP el proceso no termina cuando un cliente se va: los clientes van y
    // vienen. Lo dice al arrancar y se queda escuchando.
    process.stderr.write(
      `mcpizer ${info.version} escucha en http://${http.host}:${http.port}/mcp ` +
        `(sonda en ${HEALTH_PATH}); política ${loaded.artifact.version}\n`,
    );
    running = http;
  } else {
    /**
     * stdio no tiene cabeceras: el canal por el que llega la credencial es el
     * entorno del proceso que el cliente arranca. Se lee en cada petición y no
     * se guarda en ninguna parte.
     */
    running = await mcpStdioServer(info, handlers, () => ({
      issuer: escucha.issuerId,
      presented: process.env[escucha.keyEnv] ?? '',
    }));
    // Por stdio no hay sonda que valga: el cliente *es* quien arrancó el
    // proceso, y su salud es que el proceso siga vivo. Se anuncia por stderr
    // porque stdout es el protocolo (decisión 0019).
    process.stderr.write(`mcpizer ${info.version} atiende por stdio; política ${loaded.artifact.version}\n`);
  }

  parada.atiende(() => {
    void running.close();
  });

  await running.closed;
  return 0;
}

function print(lines: readonly string[]): void {
  process.stdout.write(`${lines.join('\n')}\n`);
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function run(argv: readonly string[]): Promise<number> {
  const { values, positionals } = parseArgs({ args: [...argv], options: OPTIONS, allowPositionals: true });
  const command = positionals[0];

  if (values.help || command === undefined || command === 'help') {
    print([USAGE]);
    return command === undefined && !values.help ? 2 : 0;
  }

  if (command === 'schema') {
    printJson(schema);
    return 0;
  }

  if (command === 'version') {
    const version = selfVersion();
    if (values.json) printJson({ mcpizer: version, node: process.version });
    else print([`mcpizer ${version}`, `node ${process.version}`]);
    return 0;
  }

  const artifactPath = required(positionals[1], '<politica.yaml>');

  if (command === 'validate') {
    const loaded = await load(artifactPath, declaredCatalog(values.catalog));
    if (values.json) {
      printJson({ origin: loaded.artifact.origin, version: loaded.artifact.version, diagnostics: loaded.diagnostics });
    } else if (loaded.diagnostics.length === 0) {
      print([`${loaded.artifact.origin}: sin hallazgos. La política compila y es coherente.`]);
    } else {
      print(renderDiagnostics(loaded.artifact.origin, loaded.diagnostics));
    }
    return hasErrors(loaded.diagnostics) ? 1 : 0;
  }

  if (command === 'explain') {
    const loaded = await load(artifactPath, declaredCatalog(values.catalog));
    if (loaded.policy === undefined) {
      print(['La política no compila; no hay nada que explicar todavía.', '', ...renderDiagnostics(loaded.artifact.origin, loaded.diagnostics)]);
      return 1;
    }
    const at = parseInstant(values.at);
    const explanation = explain(loaded, {
      issuer: required(values.issuer, '--issuer'),
      subject: required(values.subject, '--subject'),
      attributes: parseAttributes(values.attr),
      capability: required(values.capability, '--capability'),
      at,
      usage: parseUsage(values.usage, at),
    });
    if (values.json) printJson(explanation);
    else print(renderExplanation(loaded.artifact.origin, explanation));
    return 0;
  }

  if (command === 'who-can') {
    const loaded = await load(artifactPath, declaredCatalog(values.catalog));
    const report = whoCan(loaded, required(values.capability, '--capability'));
    if (report === undefined) {
      print(['La política no compila; la consulta inversa necesita un modelo evaluable.', '', ...renderDiagnostics(loaded.artifact.origin, loaded.diagnostics)]);
      return 1;
    }
    if (values.json) printJson(report);
    else print(renderReach(loaded.artifact.origin, report));
    return 0;
  }

  if (command === 'diff') {
    const afterPath = required(positionals[2], '<despues.yaml>');
    const [before, after] = await Promise.all([
      load(artifactPath, declaredCatalog(values.catalog)),
      load(afterPath, declaredCatalog(values.catalog)),
    ]);
    const changes = effectiveDiff(before, after, parseInstant(values.at));
    if (values.json) printJson({ before: before.artifact.version, after: after.artifact.version, changes });
    else print(renderDiff(changes));
    return changes.length === 0 ? 0 : 1;
  }

  if (command === 'catalog') return emitCatalog(artifactPath);

  if (command === 'serve') return serve(artifactPath, values);

  throw new UsageError(`\`${command}\` no es un comando. Prueba \`mcpizer help\`.`);
}

try {
  process.exitCode = await run(process.argv.slice(2));
} catch (error) {
  if (error instanceof UsageError) {
    process.stderr.write(`${error.message}\n\n${USAGE}\n`);
    process.exitCode = 2;
  } else {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 3;
  }
}
