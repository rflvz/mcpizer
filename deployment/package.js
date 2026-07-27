/**
 * Construye el artefacto desplegable.
 *
 *   node deployment/package.js [--out <directorio>]
 *
 * El artefacto es un **directorio autocontenido**: el programa compilado y el
 * cierre de sus dependencias de producción, y nada más. Con eso y un Node 22
 * hay pasarela; no hace falta este repositorio, ni pnpm, ni una instalación
 * previa, ni red (decisión 0030).
 *
 * Quien lo produce es `pnpm deploy`, no un empaquetador propio. El fichero de
 * bloqueo es el que dice qué versión de cada dependencia entra, así que lo que
 * se despliega es exactamente lo que se verificó — un empaquetador que
 * resolviera por su cuenta rompería esa cadena en el único punto donde no se
 * nota hasta producción.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** El paquete que *es* el producto: la composición, con su cierre. */
const DEPLOYABLE = '@mcpizer/runtime';

/** Dónde vive el punto de entrada dentro del artefacto. */
export const ENTRY = join('dist', 'cli', 'main.js');

/** Dónde se deja el artefacto si nadie dice otra cosa. */
export const DEFAULT_OUT = join(REPO_ROOT, 'deployment', 'dist');

function manifest(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * La versión del producto, comprobada en sus dos sitios.
 *
 * El artefacto hereda el manifiesto de `runtime/`, así que es ese el número que
 * `mcpizer version` acaba diciendo; el de la raíz es el que ve quien abre el
 * repositorio. Que se separen no rompe nada visible, y por eso hay que
 * comprobarlo aquí: un despliegue que dice una versión que no es la que se
 * publicó no se detecta hasta que hace falta.
 *
 * Recibe la raíz para que el arnés pueda ejercitarla contra un caso desalineado:
 * una comprobación que nunca ha fallado no está verificada.
 */
export function productVersion(root = REPO_ROOT) {
  const declarada = manifest(join(root, 'package.json')).version;
  const desplegada = manifest(join(root, 'runtime', 'package.json')).version;
  if (declarada !== desplegada) {
    throw new Error(
      `La versión del repositorio (${declarada}) y la del artefacto (${desplegada}) no coinciden. ` +
        'El artefacto lleva la de `runtime/package.json`; son la misma cosa y tienen que decir lo mismo.',
    );
  }
  return declarada;
}

function run(command, args) {
  execFileSync(command, args, { cwd: REPO_ROOT, stdio: 'inherit' });
}

export function build(out = DEFAULT_OUT) {
  const version = productVersion();

  // Se compila siempre. Empaquetar sobre un `dist/` de hace tres commits es el
  // fallo que produce un artefacto que arranca y hace lo que ya no dice el
  // código.
  run('pnpm', ['build']);

  // Y se parte de vacío: `pnpm deploy` no borra lo que encuentra, así que sin
  // esto un fichero que dejó de generarse seguiría viajando en el artefacto.
  rmSync(out, { recursive: true, force: true });

  run('pnpm', ['deploy', '--legacy', '--prod', '--filter', DEPLOYABLE, out]);

  const entry = join(out, ENTRY);
  if (!existsSync(entry)) throw new Error(`El artefacto no tiene punto de entrada en \`${ENTRY}\`.`);

  return { out, version, entry };
}

// Solo cuando se invoca como programa: el arnés de verificación lo importa.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const flag = process.argv.indexOf('--out');
  const out = flag === -1 ? DEFAULT_OUT : process.argv[flag + 1];
  if (out === undefined) {
    process.stderr.write('`--out` necesita un directorio.\n');
    process.exit(2);
  }

  const artifact = build(out);
  process.stdout.write(
    `mcpizer ${artifact.version} empaquetado en ${artifact.out}\n` +
      `Arranca con: node ${join(artifact.out, ENTRY)} serve <politica> --issuer <id> --catalog <catalogo>\n`,
  );
}
