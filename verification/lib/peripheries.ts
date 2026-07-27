/**
 * Las dos periferias, montadas del todo, y el recorrido que se les hace a las dos.
 *
 * Existe para que el criterio de terminación de S3 —"cada puerto tiene al menos
 * dos implementaciones intercambiables por configuración"— se pueda **ejecutar**
 * en vez de opinarse: se recorre la misma pasarela dos veces, cambiando solo la
 * periferia, y se comparan las decisiones.
 *
 * La política es **la misma plantilla** en los dos casos, con las declaraciones
 * de periferia sustituidas. Si fueran dos políticas distintas, comparar sus
 * decisiones no diría nada.
 *
 * Se comparte entre el criterio (`checks/port-implementations.test.ts`) y el
 * escáner de fugas (`checks/credential-leak.test.ts`), y eso es deliberado: el
 * escáner tiene que pasar por encima de **estos** adaptadores, no de un montaje
 * propio que no demostraría nada sobre ellos.
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { REPO_ROOT } from './run-checks.js';
import {
  startHttpUpstream,
  startOidc,
  startOtlpCollector,
  startRedis,
  startVault,
  type HttpUpstreamFixture,
  type OidcFixture,
  type OtlpFixture,
  type RedisFixture,
  type VaultFixture,
} from './fixtures.js';

const run = promisify(execFile);

const CLI = join(REPO_ROOT, 'runtime', 'dist', 'cli', 'main.js');
const UPSTREAM_STDIO = join(REPO_ROOT, 'verification', 'fixtures', 'upstream', 'server.js');

/**
 * Los centinelas. Irrepetibles a propósito: buscar una cadena que pudiera
 * aparecer por casualidad convertiría el escáner en una fuente de falsos
 * positivos, y una demasiado corta, en una de falsos negativos.
 */
export const CENTINELAS = {
  claveDeEmisor: 'centinela-clave-de-emisor-7f3a91c4',
  credencialDeCuenta: 'centinela-credencial-de-cuenta-2b8e05d6',
  credencialEnBoveda: 'centinela-credencial-en-boveda-5e70d3b1',
  tokenDeBoveda: 'centinela-token-de-boveda-c82f46a9',
} as const;

/**
 * La política, con dos huecos: cómo se alcanza el upstream y dónde vive la
 * credencial de la cuenta. Todo lo demás —capacidades, mapeo, concesión,
 * techo— es idéntico, que es lo que hace comparables las dos ejecuciones.
 */
function plantilla(transporte: string, secretoDeCuenta: string, emisor: string): string {
  return `version: 1
capabilities:
  - id: billing.invoice.issue
  - id: crm.contact.read
upstreams:
  - id: facturacion
${transporte}
    tools:
      - name: create_invoice
        capability: billing.invoice.issue
      - name: delete_invoice
        capability: crm.contact.read
accounts:
  - id: facturacion-ops
    secret: { ref: "${secretoDeCuenta}" }
principals:
  issuers:
${emisor}
grants:
  - to:
      issuer: quien-invoca
      attributes: { role: automation }
    capabilities: [billing.invoice.issue]
    using: facturacion-ops
    limits:
      calls: 2
      per: 1h
`;
}

const CATALOGO = `version: 1
tools:
  - upstream: facturacion
    name: create_invoice
    inputSchema:
      type: object
      properties:
        customerId: { type: string }
  - upstream: facturacion
    name: delete_invoice
    inputSchema:
      type: object
`;

/** Lo observable de un recorrido: lo que el cliente recibió y lo que se registró. */
export interface Recorrido {
  readonly listadas: readonly string[];
  readonly concedida: { readonly isError: boolean; readonly texto: string };
  readonly denegada: { readonly isError: boolean; readonly texto: string };
  readonly inexistente: { readonly isError: boolean; readonly texto: string };
  readonly agotada: { readonly isError: boolean; readonly texto: string };
  /**
   * Lo que el cliente presentó para autenticarse.
   *
   * También es material: `TransportCredentials.presented` dice "no se guarda, no
   * se registra y no vuelve a salir". Con OIDC no se puede fijar de antemano
   * —el token se firma en cada recorrido—, así que se devuelve para que el
   * escáner lo pueda buscar.
   */
  readonly presentado: string;
  /** Todo lo que un operador puede ver: registro, respuestas y motivos. */
  readonly observable: string;
}

export interface Periferia {
  readonly nombre: string;
  recorre(): Promise<Recorrido>;
  close(): Promise<void>;
}

/**
 * El contenido, aplanado a texto.
 *
 * Sin aplanar, un `JSON.stringify` del bloque entero escaparía las comillas del
 * JSON que el upstream devuelve dentro de su propio texto, y las aserciones
 * pasarían a hablar del escapado en vez de del contenido.
 */
function textoDe(resultado: unknown): { isError: boolean; texto: string } {
  const respuesta = resultado as { content?: unknown; isError?: unknown };
  const bloques = Array.isArray(respuesta.content) ? respuesta.content : [respuesta.content];
  const texto = bloques
    .map((bloque) => {
      const parte = (bloque as { text?: unknown } | null)?.text;
      return typeof parte === 'string' ? parte : JSON.stringify(bloque ?? null);
    })
    .join('\n');
  return { isError: respuesta.isError === true, texto };
}

/** El recorrido, idéntico para las dos periferias. Cambia quién atiende, no qué se pide. */
async function recorreCon(client: Client): Promise<Omit<Recorrido, 'observable' | 'presentado'>> {
  const listadas = (await client.listTools()).tools.map((tool) => tool.name).sort();

  const concedida = textoDe(
    await client.callTool({ name: 'facturacion__create_invoice', arguments: { customerId: 'acme' } }),
  );
  const denegada = textoDe(await client.callTool({ name: 'facturacion__delete_invoice', arguments: {} }));
  const inexistente = textoDe(await client.callTool({ name: 'facturacion__no_existe', arguments: {} }));

  // La segunda concedida agota el techo de 2/1h; la tercera tiene que denegar.
  await client.callTool({ name: 'facturacion__create_invoice', arguments: { customerId: 'acme' } });
  const agotada = textoDe(
    await client.callTool({ name: 'facturacion__create_invoice', arguments: { customerId: 'acme' } }),
  );

  return { listadas, concedida, denegada, inexistente, agotada };
}

/** Arranca la CLI y acumula su stderr, que es donde va el registro de decisiones. */
function arranca(args: string[], env: Record<string, string>): { proceso: ChildProcess; registro: () => string } {
  const proceso = spawn(process.execPath, [CLI, ...args], {
    cwd: REPO_ROOT,
    env: { PATH: process.env['PATH'] ?? '', ...env },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let registro = '';
  proceso.stderr?.on('data', (trozo: Buffer) => {
    registro += trozo.toString('utf8');
  });
  return { proceso, registro: () => registro };
}

// ─────────────────────────────────────────────────────────────────────────────
// Periferia A — la de S2: fichero · catálogo declarado · clave estática ·
// memoria · entorno · stdio · stderr.
// ─────────────────────────────────────────────────────────────────────────────

export async function periferiaA(): Promise<Periferia> {
  const dir = await mkdtemp(join(tmpdir(), 'mcpizer-periferia-a-'));
  const politica = join(dir, 'policy.yaml');
  const catalogo = join(dir, 'catalog.yaml');

  await writeFile(
    politica,
    plantilla(
      `    transport:\n      kind: mcp-stdio\n      command: ${process.execPath}\n      args: ["${UPSTREAM_STDIO}"]`,
      'env://BILLING_OPS_KEY',
      `    - id: quien-invoca
      kind: static-key
      subject: build-agent
      secret: { ref: "env://MCPIZER_CI_KEY" }
      attributes:
        role: automation`,
    ),
  );
  await writeFile(catalogo, CATALOGO);

  return {
    nombre: 'A · fichero · declarado · clave estática · memoria · entorno · stdio · stderr',

    async recorre(): Promise<Recorrido> {
      const client = new Client({ name: 'arnes', version: '0.0.0' });
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [CLI, 'serve', politica, '--catalog', catalogo, '--issuer', 'quien-invoca'],
        env: {
          PATH: process.env['PATH'] ?? '',
          MCPIZER_CI_KEY: CENTINELAS.claveDeEmisor,
          MCPIZER_API_KEY: CENTINELAS.claveDeEmisor,
          BILLING_OPS_KEY: CENTINELAS.credencialDeCuenta,
        },
        // Capturado, no descartado: el registro de decisiones va por aquí, y es
        // la mitad de lo que hay que revisar.
        stderr: 'pipe',
      });

      let registro = '';
      await client.connect(transport as Transport);
      transport.stderr?.on('data', (trozo: Buffer) => {
        registro += trozo.toString('utf8');
      });

      const paso = await recorreCon(client);
      await new Promise((resolve) => setTimeout(resolve, 200));
      await client.close();

      return {
        ...paso,
        presentado: CENTINELAS.claveDeEmisor,
        observable: `${registro}\n${JSON.stringify(paso)}`,
      };
    },

    close: async () => undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Periferia B — la de S3: git · descubrimiento MCP · OIDC · Redis · Vault ·
// HTTP en los dos lados · OTLP.
// ─────────────────────────────────────────────────────────────────────────────

export interface PeriferiaB extends Periferia {
  readonly oidc: OidcFixture;
  readonly vault: VaultFixture;
  readonly redis: RedisFixture;
  readonly otlp: OtlpFixture;
  readonly upstream: HttpUpstreamFixture;
}

export async function periferiaB(): Promise<PeriferiaB> {
  const oidc = await startOidc();
  const upstream = await startHttpUpstream();
  const vault = await startVault({
    token: CENTINELAS.tokenDeBoveda,
    secrets: { 'kv/mcpizer/facturacion': { value: CENTINELAS.credencialEnBoveda } },
  });
  const redis = await startRedis();
  const otlp = await startOtlpCollector();

  // El artefacto vive en git, que es el modo esperado en cuanto se revisa por PR.
  const repositorio = await mkdtemp(join(tmpdir(), 'mcpizer-politica-'));
  const git = async (...args: string[]): Promise<void> => {
    await run('git', ['-C', repositorio, ...args], {
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'arnes',
        GIT_AUTHOR_EMAIL: 'arnes@mcpizer.test',
        GIT_COMMITTER_NAME: 'arnes',
        GIT_COMMITTER_EMAIL: 'arnes@mcpizer.test',
      },
    });
  };

  await git('init', '--quiet', '--initial-branch', 'main');
  await writeFile(
    join(repositorio, 'policy.yaml'),
    plantilla(
      `    transport:\n      kind: mcp-http\n      url: ${upstream.url}`,
      'vault://kv/mcpizer/facturacion',
      `    - id: quien-invoca
      kind: oidc
      discovery: ${oidc.discovery}
      audience: mcpizer
      attributes:
        role: claim:role`,
    ),
  );
  await git('add', 'policy.yaml');
  await git('commit', '--quiet', '-m', 'la política');

  const espejo = await mkdtemp(join(tmpdir(), 'mcpizer-espejo-'));
  const especificador = `git+${repositorio}#refs/heads/main:policy.yaml`;

  let proceso: ChildProcess | undefined;
  let registro: () => string = () => '';

  return {
    nombre: 'B · git · descubrimiento · OIDC · Redis · Vault · HTTP · OTLP',
    oidc,
    vault,
    redis,
    otlp,
    upstream,

    async recorre(): Promise<Recorrido> {
      const arrancado = arranca(
        [
          'serve',
          especificador,
          '--discover',
          '--issuer',
          'quien-invoca',
          '--http',
          '--usage',
          redis.url,
          '--recorder',
          'otlp',
          '--otlp-endpoint',
          otlp.url,
        ],
        {
          VAULT_ADDR: vault.url,
          VAULT_TOKEN: CENTINELAS.tokenDeBoveda,
          // El espejo del repositorio, para no escribir en el temporal común.
          TMPDIR: espejo,
        },
      );
      proceso = arrancado.proceso;
      registro = arrancado.registro;

      // El puerto lo elige el sistema; la pasarela lo dice al arrancar.
      const url = await new Promise<string>((resolve, reject) => {
        const plazo = setTimeout(() => reject(new Error(`La pasarela no arrancó:\n${registro()}`)), 30_000);
        const mira = (): void => {
          const encontrado = /http:\/\/127\.0\.0\.1:\d+\/mcp/.exec(registro());
          if (encontrado !== null) {
            clearTimeout(plazo);
            clearInterval(reloj);
            resolve(encontrado[0]);
          }
        };
        const reloj = setInterval(mira, 50);
        arrancado.proceso.once('exit', () => {
          clearTimeout(plazo);
          clearInterval(reloj);
          reject(new Error(`La pasarela murió al arrancar:\n${registro()}`));
        });
      });

      const token = oidc.emite({ subject: 'build-agent', claims: { role: 'automation' } });
      const client = new Client({ name: 'arnes', version: '0.0.0' });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(url), {
          requestInit: { headers: { Authorization: `Bearer ${token}` } },
        }) as Transport,
      );

      const paso = await recorreCon(client);
      await client.close();
      // Que el lote de auditoría salga antes de mirarlo.
      await new Promise((resolve) => setTimeout(resolve, 2_500));

      return {
        ...paso,
        presentado: token,
        // Todo lo observable: el registro del proceso, lo que el cliente
        // recibió, y lo que llegó al colector — que es un sitio observable más.
        observable: `${registro()}\n${JSON.stringify(paso)}\n${otlp.crudo.join('\n')}`,
      };
    },

    async close(): Promise<void> {
      proceso?.kill('SIGTERM');
      await Promise.all([oidc.close(), upstream.close(), vault.close(), redis.close(), otlp.close()]);
    },
  };
}
