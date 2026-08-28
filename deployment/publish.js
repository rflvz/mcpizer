/**
 * Publica los siete paquetes en un registro npm.
 *
 *   node deployment/publish.js [--publish] [--registry <url>] [--tag <etiqueta>]
 *
 * **En seco por defecto**, como el producto que publica (decisión 0014). Sin
 * `--publish` no sale nada de esta máquina: se comprueba lo comprobable y se
 * imprime exactamente qué se subiría. Publicar es irreversible —una versión en
 * un registro no se puede corregir, solo suceder—, así que el defecto tiene que
 * ser el que no hace nada.
 *
 * Quien publica es `pnpm publish -r`, no un subidor propio, por la misma razón
 * que empaqueta `pnpm deploy` y no un empaquetador propio (decisión 0030): es
 * quien sabe sustituir `workspace:*` por la versión real, y esa sustitución es
 * el punto exacto donde un publicador casero rompería el producto sin avisar.
 *
 * Lo que este guion aporta no es subir ficheros: es **negarse a subirlos** en
 * los seis casos en que lo publicado quedaría roto y el registro no lo diría.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * Los siete, en el orden en que se leen.
 *
 * No se descubren recorriendo el workspace a propósito: un directorio nuevo con
 * manifiesto no debe convertirse en un paquete publicado porque alguien lo
 * creara. Lo que se publica se escribe aquí.
 */
export const PUBLICABLES = [
  'principals',
  'capabilities',
  'accounts',
  'access',
  'policy',
  'adapters',
  'runtime',
];

/** El paquete que trae la CLI, y el único cuyo nombre teclea alguien (decisión 0041). */
export const PRODUCTO = 'mcpizer';

function manifiesto(root, dir) {
  return JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8'));
}

/**
 * Comprueba que los siete se pueden publicar, y devuelve qué se publicaría.
 *
 * Cada comprobación es una forma real en que esto se rompe **sin que el
 * registro se queje**: publicar es la operación en la que un descuido no falla,
 * se queda publicado.
 *
 * Recibe la raíz para que el arnés pueda ejercitarla contra árboles rotos: una
 * comprobación que nunca ha fallado no está verificada (`docs/sesiones.md` §2).
 */
export function publicables(root = REPO_ROOT) {
  const paquetes = PUBLICABLES.map((dir) => ({ dir, manifest: manifiesto(root, dir) }));
  const problemas = [];

  // 1. Una sola versión para el producto (decisión 0035, extendida por la 0041).
  //
  // Los siete se instalan juntos: `mcpizer` los pide por versión exacta, porque
  // eso es lo que `pnpm` escribe al sustituir `workspace:*`. Publicar seis a una
  // versión y uno a otra deja en el registro un paquete que no se puede resolver.
  const versiones = new Set(paquetes.map(({ manifest }) => manifest.version));
  if (versiones.size !== 1) {
    problemas.push(
      `Los siete paquetes tienen que decir la misma versión, y dicen ${versiones.size}: ` +
        paquetes.map(({ dir, manifest }) => `${dir}@${manifest.version}`).join(', ') +
        '. Se instalan juntos o no se instala ninguno.',
    );
  }

  for (const { dir, manifest } of paquetes) {
    // 2. Un `private` olvidado.
    //
    // El peor de los cuatro, porque **publica**: `pnpm publish -r` salta el
    // privado y sube los otros seis. En el registro queda un producto cuya
    // dependencia no existe, y el primero que lo instale se lo encuentra.
    if (manifest.private === true) {
      problemas.push(
        `${dir}: sigue marcado como \`private\`. No se publicaría, y los otros seis sí: ` +
          'lo que queda en el registro es un producto al que le falta una pieza.',
      );
    }

    // 3. Un paquete sin lo que dice llevar.
    //
    // `files: ["dist"]` sobre un `dist/` que no se construyó produce un tarball
    // que se instala sin error y no tiene código dentro.
    if (!Array.isArray(manifest.files) || !manifest.files.includes('dist')) {
      problemas.push(`${dir}: no declara \`files: ["dist"]\`; lo que viaja es lo compilado.`);
    } else if (!existsSync(join(root, dir, 'dist', 'index.js'))) {
      problemas.push(
        `${dir}: no está construido. Publicar ahora subiría un paquete vacío, ` +
          'que se instala sin error y no tiene código dentro.',
      );
    }

    // 4. La licencia: declarada, y dentro del paquete.
    //
    // No fue una decisión de diseño sino del dueño del repositorio (decisión
    // 0042), y es MIT (decisión 0044). Publicar sin ella deja un paquete que
    // nadie puede usar legalmente y que npm marca como propietario para siempre
    // en esa versión, así que se bloquea aquí en vez de avisarse.
    //
    // Y el campo del manifiesto no basta: MIT pide que el aviso viaje en las
    // copias, y quien instala solo recibe el tarball. npm mete el fichero
    // `LICENSE` aunque `files` no lo nombre —por eso los siete lo tienen al lado
    // del manifiesto en vez de solo en la raíz—, pero eso lo garantiza mientras
    // el fichero exista, que es lo que se mira aquí.
    if (typeof manifest.license !== 'string' || manifest.license === '') {
      problemas.push(
        `${dir}: no declara \`license\`. Elegir licencia es del dueño del repositorio, ` +
          'y una versión publicada sin ella no se corrige: se sucede.',
      );
    } else if (!existsSync(join(root, dir, 'LICENSE'))) {
      problemas.push(
        `${dir}: declara \`license\` y no lleva el fichero \`LICENSE\` al lado. ` +
          'El texto viaja en el tarball, que es la copia que recibe quien instala.',
      );
    }
  }

  // 5. El binario.
  //
  // `npm install -g mcpizer` deja un `mcpizer` en el PATH si y solo si el `bin`
  // apunta a un fichero que existe y arranca con shebang. Sin shebang el fichero
  // se instala igual y el intérprete que lo ejecuta es el del sistema.
  const producto = paquetes.find(({ manifest }) => manifest.name === PRODUCTO);
  if (producto === undefined) {
    problemas.push(`Ninguno de los siete se llama \`${PRODUCTO}\`; nadie sabría qué instalar.`);
  } else {
    const bin = producto.manifest.bin?.[PRODUCTO];
    const ruta = bin === undefined ? undefined : join(root, producto.dir, bin);
    if (ruta === undefined || !existsSync(ruta)) {
      problemas.push(`${producto.dir}: el \`bin\` de \`${PRODUCTO}\` no apunta a un fichero que exista.`);
    } else if (!readFileSync(ruta, 'utf8').startsWith('#!')) {
      problemas.push(
        `${producto.dir}: el \`bin\` no empieza por shebang. Se instalaría igual, ` +
          'y lo ejecutaría el intérprete que el sistema decidiera.',
      );
    }
  }

  return { paquetes, problemas, version: paquetes[0]?.manifest.version };
}

// Solo cuando se invoca como programa: el arnés de verificación lo importa.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const valor = (bandera) => {
    const i = argv.indexOf(bandera);
    return i === -1 ? undefined : argv[i + 1];
  };

  // Se construye antes de mirar: comprobar `dist/` sobre un árbol de hace tres
  // commits diría que sí y publicaría lo de entonces.
  execFileSync('pnpm', ['build'], { cwd: REPO_ROOT, stdio: 'inherit' });

  const { paquetes, problemas, version } = publicables();

  if (problemas.length > 0) {
    process.stderr.write(`No se publica:\n${problemas.map((p) => `  · ${p}\n`).join('')}`);
    process.exit(1);
  }

  const registro = valor('--registry');
  const etiqueta = valor('--tag');
  const destino = registro ?? 'el registro configurado';

  process.stdout.write(
    `mcpizer ${version} — ${paquetes.length} paquetes a ${destino}:\n` +
      paquetes.map(({ manifest }) => `  · ${manifest.name}@${manifest.version}\n`).join(''),
  );

  if (!argv.includes('--publish')) {
    process.stdout.write('\nEn seco. Añade `--publish` para publicarlo de verdad.\n');
    process.exit(0);
  }

  execFileSync(
    'pnpm',
    [
      'publish',
      '-r',
      '--access',
      'public',
      // El árbol tiene que estar limpio para publicar, y esa comprobación la
      // hace pnpm mejor que este guion: lo publicado tiene que corresponder a un
      // commit, o la versión del registro no se puede reproducir.
      ...(registro === undefined ? [] : ['--registry', registro]),
      ...(etiqueta === undefined ? [] : ['--tag', etiqueta]),
    ],
    { cwd: REPO_ROOT, stdio: 'inherit' },
  );
}
