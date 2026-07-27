/**
 * El artefacto desplegable, construido y arrancado como lo haría un despliegue.
 *
 * Existe para que el criterio de terminación de S4 —"el artefacto desplegable se
 * construye y arranca desde cero contra una política de ejemplo"
 * (`docs/sesiones.md` §5)— se pueda **ejecutar** en vez de opinarse.
 *
 * Las tres palabras del criterio se toman en serio:
 *
 * - **se construye** — con el mismo `deployment/package.js` que se ejecuta a
 *   mano y que copia la imagen. No hay un segundo empaquetado "para los tests".
 * - **desde cero** — el proceso arranca fuera del repositorio, con un entorno
 *   podado y sin `node_modules` a la vista. Si el artefacto dependiera del árbol
 *   de trabajo, aquí se nota.
 * - **arranca** — no es que el proceso siga vivo: es que un cliente MCP de
 *   verdad se conecta, ve lo concedido y recibe motivo cuando se le deniega.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { build, ENTRY } from '../../deployment/package.js';
import { REPO_ROOT } from './run-checks.js';

/** La política de ejemplo del documento de diseño, que es la que vive en el repositorio. */
export const EJEMPLO = {
  policy: join(REPO_ROOT, 'examples', 'policy.yaml'),
  catalog: join(REPO_ROOT, 'examples', 'catalog.yaml'),
};

const UPSTREAM_STDIO = join(REPO_ROOT, 'verification', 'fixtures', 'upstream', 'server.js');

/** La clave que el cliente presenta y la que la cuenta canjea. Distintas, como en la vida. */
export const CLAVE_DE_CLIENTE = 'clave-de-cliente-de-humo';
export const CREDENCIAL_DE_CUENTA = 'credencial-de-cuenta-de-humo';

export interface Artefacto {
  /** El directorio autocontenido. Es todo lo que un despliegue recibe. */
  readonly dir: string;
  readonly entry: string;
  readonly version: string;
  /** Un directorio de trabajo fuera del repositorio, para arrancar desde cero de verdad. */
  readonly afuera: string;
  /** Una política cuyo upstream sí responde, para que una concesión llegue hasta el final. */
  readonly conUpstream: { readonly policy: string; readonly catalog: string };
  /**
   * Y otra con dos upstreams: uno que responde y otro que no.
   *
   * Es la forma del arranque a medias. Con `--discover`, el primero deja un
   * proceso hijo vivo y el segundo hace fallar el arranque: si nadie cierra el
   * descubrimiento, el fallo no puede ni terminar.
   */
  readonly conUpstreamCaido: { readonly policy: string };
}

let construido: Promise<Artefacto> | undefined;

/**
 * El entorno del proceso desplegado.
 *
 * Podado a propósito: solo `PATH` —que el invocador por stdio necesita para
 * arrancar un upstream— y las dos credenciales que la política referencia. Todo
 * lo demás que hubiera en el entorno de quien lanza los tests se queda fuera, que
 * es lo que convierte "arranca desde cero" en algo comprobable.
 */
export function entorno(extra: Readonly<Record<string, string>> = {}): Record<string, string> {
  return {
    PATH: process.env['PATH'] ?? '',
    MCPIZER_API_KEY: CLAVE_DE_CLIENTE,
    MCPIZER_CI_KEY: CLAVE_DE_CLIENTE,
    BILLING_OPS_KEY: CREDENCIAL_DE_CUENTA,
    ...extra,
  };
}

/**
 * La política con un upstream que responde.
 *
 * `examples/policy.yaml` declara upstreams que no existen —un comando y una URL
 * internas—, que es lo correcto en un ejemplo de documentación y suficiente para
 * listar y denegar. Pero una concesión que nunca llega al otro extremo dejaría
 * sin ejercitar la mitad cliente del protocolo, que es justo la que un
 * empaquetado incompleto se llevaría por delante sin que nada se enterara.
 */
function conUpstreamReal(): { policy: string; catalog: string } {
  return {
    policy: `version: 1
capabilities:
  - id: billing.invoice.issue
upstreams:
  - id: facturacion
    transport:
      kind: mcp-stdio
      command: ${process.execPath}
      args: ["${UPSTREAM_STDIO}"]
    tools:
      - name: create_invoice
        capability: billing.invoice.issue
accounts:
  - id: facturacion-ops
    secret: { ref: "env://BILLING_OPS_KEY" }
principals:
  issuers:
    - id: ci
      kind: static-key
      subject: build-agent
      secret: { ref: "env://MCPIZER_CI_KEY" }
      attributes:
        role: automation
grants:
  - to:
      issuer: ci
      attributes: { role: automation }
    capabilities: [billing.invoice.issue]
    using: facturacion-ops
    limits:
      calls: 5
      per: 1h
`,
    catalog: `version: 1
tools:
  - upstream: facturacion
    name: create_invoice
    inputSchema:
      type: object
      properties:
        customerId: { type: string }
`,
  };
}

/**
 * La misma política, más un upstream que no existe.
 *
 * Con `--discover` el primero deja un proceso hijo vivo y el segundo hace
 * fallar el arranque. Es exactamente la forma del arranque a medias: si nadie
 * cierra el descubrimiento, el proceso fija su código de salida y **no muere**,
 * porque el hijo que sí arrancó mantiene vivo el bucle de eventos.
 */
function conUpstreamCaido(base: string): string {
  return base.replace(
    'accounts:',
    `  - id: inexistente
    transport:
      kind: mcp-stdio
      command: este-binario-no-existe-en-ningun-sitio
    tools:
      - name: lo_que_sea
        capability: billing.invoice.issue
accounts:`,
  );
}

/** Se construye una vez por proceso: el criterio se ejecuta varias veces sobre el mismo artefacto. */
export function empaqueta(): Promise<Artefacto> {
  construido ??= (async (): Promise<Artefacto> => {
    const afuera = await mkdtemp(join(tmpdir(), 'mcpizer-despliegue-'));
    const dir = join(afuera, 'artefacto');
    const { version } = build(dir);

    const fuentes = conUpstreamReal();
    const policy = join(afuera, 'policy.yaml');
    const catalog = join(afuera, 'catalog.yaml');
    const caido = join(afuera, 'policy-con-upstream-caido.yaml');
    await writeFile(policy, fuentes.policy);
    await writeFile(catalog, fuentes.catalog);
    await writeFile(caido, conUpstreamCaido(fuentes.policy));

    return {
      dir,
      entry: join(dir, ENTRY),
      version,
      afuera,
      conUpstream: { policy, catalog },
      conUpstreamCaido: { policy: caido },
    };
  })();
  return construido;
}

// ─────────────────────────────────────────────────────────────────────────────
// Arrancarlo por stdio: el cliente MCP *es* quien lanza el proceso.
// ─────────────────────────────────────────────────────────────────────────────

export interface Llamada {
  readonly isError: boolean;
  readonly texto: string;
}

export interface RecorridoDeCliente {
  readonly listadas: readonly string[];
  llama(nombre: string, args?: Record<string, unknown>): Promise<Llamada>;
  close(): Promise<void>;
}

function texto(content: unknown): string {
  return Array.isArray(content)
    ? content.map((parte) => (parte as { text?: unknown }).text ?? JSON.stringify(parte)).join('\n')
    : String(content);
}

async function recorre(transport: Transport): Promise<RecorridoDeCliente> {
  const client = new Client({ name: 'cliente-de-humo', version: '0.0.0' });
  await client.connect(transport);

  const { tools } = await client.listTools();

  return {
    listadas: tools.map((tool) => tool.name),
    async llama(nombre, args): Promise<Llamada> {
      const result = await client.callTool({ name: nombre, arguments: args ?? {} });
      return { isError: result.isError === true, texto: texto(result.content) };
    },
    close: () => client.close(),
  };
}

/**
 * Un cliente MCP por stdio contra el artefacto empaquetado.
 *
 * `cwd` fuera del repositorio y entorno podado: el proceso no puede alcanzar el
 * árbol de trabajo ni por resolución de módulos ni por ruta relativa.
 */
export async function porStdio(
  artefacto: Artefacto,
  fuentes: { policy: string; catalog: string },
  extra: Readonly<Record<string, string>> = {},
): Promise<RecorridoDeCliente> {
  return recorre(
    new StdioClientTransport({
      command: process.execPath,
      args: [artefacto.entry, 'serve', fuentes.policy, '--catalog', fuentes.catalog, '--issuer', 'ci'],
      env: entorno(extra),
      cwd: artefacto.afuera,
      stderr: 'ignore',
    }),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Arrancarlo por HTTP: el proceso vive por su cuenta, y hay que pararlo.
// ─────────────────────────────────────────────────────────────────────────────

export interface Servidor {
  readonly url: string;
  readonly proceso: ChildProcess;
  readonly stderr: () => string;
  /** Le manda la señal y espera a que termine. Devuelve código y señal reales. */
  para(signal: NodeJS.Signals, plazoMs: number): Promise<{ code: number | null; signal: string | null }>;
}

/**
 * Arranca el artefacto en modo HTTP y espera a que diga por dónde escucha.
 *
 * Se espera al anuncio en vez de sondear un puerto fijo porque `--port 0` deja
 * que lo elija el sistema: dos comprobaciones en paralelo no pueden pelearse por
 * el mismo número.
 */
export async function porHttp(
  artefacto: Artefacto,
  fuentes: { policy: string; catalog: string },
  banderas: readonly string[] = [],
): Promise<Servidor> {
  return lanza(
    [
      artefacto.entry,
      'serve',
      fuentes.policy,
      '--catalog',
      fuentes.catalog,
      '--issuer',
      'ci',
      '--http',
      '--port',
      '0',
      ...banderas,
    ],
    artefacto.afuera,
  );
}

/**
 * Lanza un proceso que anuncia por stderr dónde escucha, y devuelve el asa.
 *
 * Se separa de `porHttp` para que los casos de fallo —un proceso que ignora
 * SIGTERM, otro que lo atiende y no suelta— pasen por **esta misma** máquina de
 * esperar y parar. Un caso de fallo con andamiaje propio no demostraría nada
 * sobre la comprobación de al lado.
 */
export async function lanza(argv: readonly string[], cwd: string): Promise<Servidor> {
  const proceso = spawn(process.execPath, [...argv], {
    cwd,
    env: entorno(),
    stdio: ['ignore', 'ignore', 'pipe'],
  });

  let acumulado = '';
  const url = await new Promise<string>((resolve, reject) => {
    const plazo = setTimeout(() => {
      reject(new Error(`El artefacto no anunció dónde escucha en 30 s. stderr:\n${acumulado}`));
    }, 30_000);

    proceso.stderr?.on('data', (chunk: Buffer) => {
      acumulado += chunk.toString('utf8');
      const anuncio = /(http:\/\/[^\s]+\/mcp)/.exec(acumulado);
      if (anuncio?.[1] !== undefined) {
        clearTimeout(plazo);
        resolve(anuncio[1]);
      }
    });
    proceso.once('exit', (code) => {
      clearTimeout(plazo);
      reject(new Error(`El artefacto salió con ${String(code)} antes de escuchar. stderr:\n${acumulado}`));
    });
  });

  return {
    url,
    proceso,
    stderr: () => acumulado,
    para(signal, plazoMs): Promise<{ code: number | null; signal: string | null }> {
      return new Promise((resolve, reject) => {
        const plazo = setTimeout(() => {
          proceso.kill('SIGKILL');
          reject(new Error(`El proceso no terminó en ${plazoMs} ms tras ${signal}.`));
        }, plazoMs);
        proceso.once('exit', (code, recibida) => {
          clearTimeout(plazo);
          resolve({ code, signal: recibida });
        });
        proceso.kill(signal);
      });
    },
  };
}

/**
 * Arranca el artefacto y espera a que **termine solo**, dentro de un plazo.
 *
 * Un arranque que falla tiene que salir con código. La forma en que esto se
 * rompe no es que el código sea el equivocado: es que el proceso fija el código
 * y no muere, porque algo que abrió a medias —un hijo del descubrimiento, un
 * socket— mantiene vivo el bucle de eventos. Por eso lo que se comprueba no es
 * solo el código, sino que llegue.
 */
export async function termina(
  argv: readonly string[],
  cwd: string = tmpdir(),
  plazoMs = 30_000,
): Promise<{ code: number | null; signal: string | null; stderr: string }> {
  const proceso = spawn(process.execPath, [...argv], {
    cwd,
    env: entorno(),
    stdio: ['ignore', 'ignore', 'pipe'],
  });

  let acumulado = '';
  proceso.stderr?.on('data', (chunk: Buffer) => {
    acumulado += chunk.toString('utf8');
  });

  return new Promise((resolve, reject) => {
    const plazo = setTimeout(() => {
      proceso.kill('SIGKILL');
      reject(new Error(`El proceso no terminó solo en ${plazoMs} ms. stderr:\n${acumulado}`));
    }, plazoMs);
    proceso.once('exit', (code, signal) => {
      clearTimeout(plazo);
      resolve({ code, signal, stderr: acumulado });
    });
  });
}

/** Un cliente MCP contra un servidor HTTP ya levantado, con su credencial por petición. */
export async function clienteHttp(url: string, clave = CLAVE_DE_CLIENTE): Promise<RecorridoDeCliente> {
  return recorre(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { Authorization: `Bearer ${clave}` } },
    }) as unknown as Transport,
  );
}
