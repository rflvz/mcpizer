#!/usr/bin/env node
/**
 * Los seis casos que hacen fallar "los siete se pueden publicar".
 *
 *   node mutila.js <destino> <descuido>
 *
 * Copia los siete manifiestos —y el `dist/` mínimo que la comprobación mira— a
 * un árbol nuevo, y le hace **un** descuido. Cada uno es una forma real en que
 * publicar sale mal sin que el registro se queje:
 *
 * | descuido | qué pasa si nadie lo ve |
 * |---|---|
 * | `privado` | `pnpm publish -r` salta ese paquete y sube los otros seis. En el registro queda un producto al que le falta una pieza |
 * | `desalineado` | `mcpizer` pide sus contextos por versión exacta; publicar uno a otra versión deja algo que no se resuelve |
 * | `sin-construir` | `files: ["dist"]` sobre un `dist/` que no existe sube un paquete que se instala sin error y está vacío |
 * | `sin-shebang` | el binario se instala igual, y lo ejecuta el intérprete que el sistema decida |
 * | `sin-licencia` | queda publicado un paquete que nadie tiene permiso para usar, y esa versión no se corrige |
 * | `sin-fichero-de-licencia` | el manifiesto dice MIT y el tarball no lleva el aviso que MIT obliga a incluir |
 *
 * Se genera en vez de vivir escrito porque son siete manifiestos por caso, y
 * seis copias congeladas del árbol real envejecerían por separado: el día que
 * un paquete octavo entrara en `PUBLICABLES`, los fixtures seguirían diciendo
 * que hay siete y pasarían por la razón equivocada.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLICABLES } from '../../../../deployment/publish.js';

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

/** Lo que cada descuido le hace al árbol recién copiado. */
const DESCUIDOS = {
  privado: (manifiestos) => {
    manifiestos['policy'].private = true;
  },
  desalineado: (manifiestos) => {
    manifiestos['accounts'].version = '0.2.0';
  },
  'sin-construir': (_manifiestos, destino) => {
    // El manifiesto es correcto: lo que falta es lo que dice llevar.
    rmSync(join(destino, 'capabilities', 'dist', 'index.js'));
  },
  'sin-shebang': (_manifiestos, destino) => {
    const bin = join(destino, 'runtime', 'dist', 'cli', 'main.js');
    writeFileSync(bin, readFileSync(bin, 'utf8').replace(/^#![^\n]*\n/, ''));
  },
  // Mientras el repositorio no tenía licencia, este caso lo ejercitaba el
  // propio árbol real: la comprobación fallaba sola. Elegida ya (decisión
  // 0044), la negativa se quedaría sin nadie que la hiciera fallar, y una
  // comprobación que nunca ha fallado no está verificada (`docs/sesiones.md` §2).
  'sin-licencia': (manifiestos) => {
    delete manifiestos['adapters'].license;
  },
  'sin-fichero-de-licencia': (_manifiestos, destino) => {
    // El manifiesto sigue diciendo MIT: lo que falta es el texto que MIT obliga
    // a incluir en las copias, y una copia es justo lo que recibe quien instala.
    rmSync(join(destino, 'policy', 'LICENSE'));
  },
};

const [, , destino, descuido] = process.argv;
if (destino === undefined || DESCUIDOS[descuido] === undefined) {
  process.stderr.write(`Uso: node mutila.js <destino> <${Object.keys(DESCUIDOS).join('|')}>\n`);
  process.exit(2);
}

const manifiestos = {};
for (const dir of PUBLICABLES) {
  mkdirSync(join(destino, dir, 'dist'), { recursive: true });
  manifiestos[dir] = JSON.parse(readFileSync(join(REPO_ROOT, dir, 'package.json'), 'utf8'));

  // El `dist/` no se copia entero: la comprobación mira que exista el punto de
  // entrada, y para `runtime` además el binario. Copiar el árbol compilado
  // completo tardaría lo mismo que construirlo.
  writeFileSync(join(destino, dir, 'dist', 'index.js'), '');
}
mkdirSync(join(destino, 'runtime', 'dist', 'cli'), { recursive: true });
writeFileSync(join(destino, 'runtime', 'dist', 'cli', 'main.js'), '#!/usr/bin/env node\n');

// El árbol copiado está sano: sin esto, los casos pasarían por lo que les falta
// al fixture y no por el descuido que traen.
for (const dir of PUBLICABLES) {
  manifiestos[dir].license = 'MIT';
  writeFileSync(join(destino, dir, 'LICENSE'), 'MIT License\n');
}

DESCUIDOS[descuido](manifiestos, destino);

for (const dir of PUBLICABLES) {
  writeFileSync(join(destino, dir, 'package.json'), JSON.stringify(manifiestos[dir], null, 2));
}

process.stdout.write(`${destino}\n`);
