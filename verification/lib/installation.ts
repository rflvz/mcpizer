/**
 * Lo que se publica, instalado con el `npm` de verdad.
 *
 * Existe para que el criterio de esta sesión se pueda **ejecutar** en vez de
 * opinarse: *lo que se publica se instala y arranca*. Las tres partes se toman
 * tan en serio como las tres de S4 (`verification/lib/artifact.ts`):
 *
 * - **lo que se publica** — los siete tarballs los produce `pnpm pack`, que es
 *   el mismo camino que recorre `pnpm publish`. No hay un segundo empaquetado
 *   "para los tests", igual que no hay un segundo empaquetado del artefacto.
 * - **se instala** — con el cliente de npm real, contra un registro que habla su
 *   protocolo, y **sin red**: el espejo sale del cierre que fijó el fichero de
 *   bloqueo. Lo que no esté en el espejo no se puede instalar, así que una
 *   dependencia que nadie declaró no se resuelve por casualidad.
 * - **y arranca** — el binario instalado, ejecutado fuera del repositorio y con
 *   el entorno podado. Es donde aparece lo que ningún manifiesto delata: un
 *   paquete cuyo código pide algo que su manifiesto no pidió.
 */
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { espeja, startRegistry } from '../fixtures/registry/server.js';
import { extrae } from '../fixtures/registry/tarball.js';
import { PRODUCTO } from '../../deployment/publish.js';
import { REPO_ROOT } from './run-checks.js';

const execFileAsync = promisify(execFile);

/** El nombre del workspace, que no se publica: es el taller, no el producto. */
const TALLER = 'mcpizer-workspace';

export interface Paquete {
  readonly manifiesto: Record<string, unknown> & { name: string; version: string };
  readonly tarball: Buffer;
}

export interface Registro {
  readonly url: string;
  readonly peticiones: readonly string[];
  detiene(): Promise<void>;
}

export interface Instalacion {
  /** El `mcpizer` que ha quedado en el PATH de quien instaló. */
  readonly bin: string;
  /** El paquete instalado, con su cierre dentro. */
  readonly raiz: string;
  readonly version: string;
  /** Un directorio fuera del repositorio: instalar «desde cero» tiene que ser literal. */
  readonly afuera: string;
  readonly registro: Registro;
}

/** ¿Es uno de los siete? Lo propio no se sirve desde el almacén: se sirve empaquetado. */
export function esPropio(nombre: string): boolean {
  return nombre === PRODUCTO || nombre.startsWith('@mcpizer/');
}

let empaquetados: Promise<Paquete[]> | undefined;

/**
 * Los siete, empaquetados como se publicarían.
 *
 * `pnpm pack` es quien sustituye `workspace:*` por la versión real. Ese
 * reemplazo es el punto exacto en que un publicado se rompe sin que nada avise
 * —queda en el registro un paquete que pide una versión que no existe—, así que
 * el manifiesto que acaba en el documento del registro se lee **del tarball**, y
 * no del árbol de trabajo.
 */
export function propios(): Promise<Paquete[]> {
  empaquetados ??= (async (): Promise<Paquete[]> => {
    const destino = await mkdtemp(join(tmpdir(), 'mcpizer-tarballs-'));

    await execFileAsync(
      'pnpm',
      ['-r', `--filter=!${TALLER}`, 'pack', '--pack-destination', destino],
      { cwd: REPO_ROOT, maxBuffer: 32 * 1024 * 1024 },
    );

    const tgz = (await readdir(destino)).filter((fichero) => fichero.endsWith('.tgz'));
    return tgz.map((fichero) => {
      const tarball = readFileSync(join(destino, fichero));
      const manifiesto = JSON.parse(extrae(tarball, 'package/package.json').toString('utf8')) as
        Paquete['manifiesto'];
      return { manifiesto, tarball };
    });
  })();
  return empaquetados;
}

let espejo: Paquete[] | undefined;

/** El cierre de terceros, empaquetado una sola vez por proceso: son casi cien. */
function terceros(): Paquete[] {
  espejo ??= espeja(REPO_ROOT, esPropio) as Paquete[];
  return espejo;
}

/**
 * Un registro con los siete y su cierre.
 *
 * `retoca` permite alterar el manifiesto que se **anuncia** sin tocar el
 * tarball. Es lo que hacen los casos de fallo, y no es un atajo: npm resuelve
 * las dependencias del documento del registro, así que anunciar un manifiesto al
 * que le falta una dependencia produce exactamente el `node_modules` que
 * produciría haberla declarado mal. Lo que decide si el proceso arranca es qué
 * ha aterrizado, no qué ponía en el manifiesto.
 */
export async function registro(
  retoca: (manifiesto: Paquete['manifiesto']) => Paquete['manifiesto'] = (m) => m,
): Promise<Registro> {
  const siete = await propios();
  return startRegistry([
    ...siete.map((paquete) => ({ ...paquete, manifiesto: retoca(paquete.manifiesto) })),
    ...terceros(),
  ]);
}

/**
 * `npm install -g <nombre>` contra ese registro, en un prefijo recién hecho.
 *
 * El entorno se poda hasta lo imprescindible. `HOME` apunta al directorio
 * temporal para que no se lea el `.npmrc` de quien ejecuta los tests: un
 * registro configurado ahí convertiría esta comprobación en una que depende de
 * la red, y dejaría de comprobar lo que dice comprobar.
 */
export async function instala(
  reg: Registro,
  nombre: string = PRODUCTO,
): Promise<{ bin: string; raiz: string; afuera: string }> {
  const afuera = await mkdtemp(join(tmpdir(), 'mcpizer-instalacion-'));
  const prefijo = join(afuera, 'prefijo');

  await execFileAsync(
    'npm',
    [
      'install',
      '--global',
      nombre,
      '--registry',
      reg.url,
      '--prefix',
      prefijo,
      '--cache',
      join(afuera, 'cache'),
      '--no-audit',
      '--no-fund',
    ],
    {
      cwd: afuera,
      env: {
        PATH: process.env['PATH'] ?? '',
        HOME: afuera,
        // Sin esto npm consulta si hay una versión suya más nueva, que es una
        // petición a la red dentro de una comprobación que no la tiene.
        npm_config_update_notifier: 'false',
      },
      maxBuffer: 32 * 1024 * 1024,
    },
  );

  return {
    bin: join(prefijo, 'bin', PRODUCTO),
    raiz: join(prefijo, 'lib', 'node_modules', nombre),
    afuera,
  };
}

let instalado: Promise<Instalacion> | undefined;

/** El camino feliz, una vez por proceso: varias comprobaciones sobre la misma instalación. */
export function instalacion(): Promise<Instalacion> {
  instalado ??= (async (): Promise<Instalacion> => {
    const reg = await registro();
    const { bin, raiz, afuera } = await instala(reg);
    const siete = await propios();
    const producto = siete.find(({ manifiesto }) => manifiesto.name === PRODUCTO);
    if (producto === undefined) throw new Error(`No se ha empaquetado \`${PRODUCTO}\`.`);

    return { bin, raiz, version: producto.manifiesto.version, afuera, registro: reg };
  })();
  return instalado;
}

/**
 * Ejecuta el binario instalado como lo haría quien lo instaló: por su nombre.
 *
 * No se invoca `node <ruta>`: lo que hay que comprobar es que el enlace que npm
 * dejó en el PATH funciona, y eso incluye el shebang. Un fichero sin shebang se
 * instala igual y lo ejecuta el intérprete que el sistema decida.
 */
export async function ejecuta(
  donde: { readonly bin: string; readonly afuera: string },
  args: readonly string[],
  extra: Readonly<Record<string, string>> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(donde.bin, [...args], {
      cwd: donde.afuera,
      env: { PATH: process.env['PATH'] ?? '', HOME: donde.afuera, ...extra },
      maxBuffer: 32 * 1024 * 1024,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const fallo = error as { code?: number; stdout?: string; stderr?: string };
    return { code: fallo.code ?? 1, stdout: fallo.stdout ?? '', stderr: fallo.stderr ?? '' };
  }
}
