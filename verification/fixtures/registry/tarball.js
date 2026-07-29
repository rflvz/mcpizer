/**
 * Un tarball de npm, escrito a mano: tar ustar comprimido con gzip.
 *
 * Existe para que el espejo del registro de fixture pueda servir el cierre de
 * dependencias que el fichero de bloqueo fijó, que en disco está desempaquetado.
 *
 * Se escribe en vez de invocar `npm pack` una vez por paquete porque son casi
 * cien y `npm pack` cuesta un proceso cada uno; y en vez de invocar `tar`
 * porque el formato de sus banderas de renombrado no es el mismo en GNU y en
 * BSD, y una comprobación que solo pasa en Linux no es una comprobación.
 *
 * **Esto no vale para los siete paquetes propios.** Los suyos los produce
 * `pnpm pack`, que es el mismo camino que recorre `pnpm publish`: si el tarball
 * de lo que se publica lo escribiera este fichero, la comprobación mediría esta
 * idea de qué entra en un paquete y no la de quien lo va a subir — que es justo
 * donde vive el descuido de `files` mal declarado. Aquí solo viaja el **otro
 * extremo del cable**: dependencias de terceros que ya están en disco tal cual
 * las publicó su autor.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

const BLOQUE = 512;

/**
 * Parte una ruta larga en los campos `prefix` y `name` de ustar.
 *
 * ustar guarda 100 bytes de nombre y 155 de prefijo, y el corte tiene que caer
 * en una barra. Un paquete con rutas más largas que eso existe, así que el caso
 * se resuelve o se dice — nunca se trunca en silencio, que produciría un tarball
 * que se instala y al que le falta un fichero.
 */
function parte(nombre) {
  if (Buffer.byteLength(nombre) <= 100) return { corto: nombre, prefijo: '' };

  for (let i = nombre.indexOf('/'); i !== -1; i = nombre.indexOf('/', i + 1)) {
    const prefijo = nombre.slice(0, i);
    const corto = nombre.slice(i + 1);
    if (Buffer.byteLength(prefijo) <= 155 && Buffer.byteLength(corto) <= 100) {
      return { corto, prefijo };
    }
  }
  throw new Error(`Ruta que no cabe en ustar: ${nombre}`);
}

function cabecera(nombre, tam, modo) {
  const { corto, prefijo } = parte(nombre);
  const h = Buffer.alloc(BLOQUE);

  h.write(corto, 0, 100, 'utf8');
  h.write((modo & 0o7777).toString(8).padStart(7, '0'), 100, 8, 'utf8');
  h.write('0000000', 108, 8, 'utf8'); // uid
  h.write('0000000', 116, 8, 'utf8'); // gid
  h.write(tam.toString(8).padStart(11, '0'), 124, 12, 'utf8');
  // Fecha fija: el mismo árbol tiene que producir el mismo tarball, o el
  // `integrity` que se anuncia cambiaría entre dos ejecuciones de la misma
  // comprobación.
  h.write('00000000000', 136, 12, 'utf8');
  h.write('0', 156, 1, 'utf8'); // fichero regular
  h.write('ustar\u000000', 257, 8, 'utf8');
  if (prefijo !== '') h.write(prefijo, 345, 155, 'utf8');

  // La suma de control se calcula con su propio campo lleno de espacios.
  h.fill(' ', 148, 156);
  let suma = 0;
  for (const byte of h) suma += byte;
  h.write(`${suma.toString(8).padStart(6, '0')}\u0000 `, 148, 8, 'utf8');

  return h;
}

/**
 * Empaqueta un directorio como lo haría npm: todo bajo un `package/`.
 *
 * Se saltan los enlaces simbólicos y los `node_modules` de dentro: en el almacén
 * de pnpm, las dependencias de un paquete son enlaces a hermanos suyos, y
 * seguirlos metería el cierre entero dentro de cada tarball.
 */
export function empaqueta(dir) {
  const partes = [];

  const recorre = (actual) => {
    const entradas = readdirSync(actual, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : 1,
    );
    for (const entrada of entradas) {
      if (entrada.name === 'node_modules' || entrada.isSymbolicLink()) continue;
      const completa = join(actual, entrada.name);
      if (entrada.isDirectory()) {
        recorre(completa);
        continue;
      }
      if (!entrada.isFile()) continue;

      const datos = readFileSync(completa);
      const nombre = `package/${relative(dir, completa).split('\\').join('/')}`;
      partes.push(cabecera(nombre, datos.length, statSync(completa).mode), datos);

      const sobrante = datos.length % BLOQUE;
      if (sobrante !== 0) partes.push(Buffer.alloc(BLOQUE - sobrante));
    }
  };

  recorre(dir);
  partes.push(Buffer.alloc(BLOQUE * 2)); // fin de archivo

  return gzipSync(Buffer.concat(partes), { level: 1 });
}

/**
 * Saca un fichero de un tarball ya hecho.
 *
 * Se usa para leer el `package.json` que **`pnpm pack` ha escrito**, con
 * `workspace:*` ya sustituido por la versión. Reconstruirlo a partir del
 * manifiesto del árbol de trabajo sería reimplementar esa sustitución, que es
 * justo la parte del publicado que hay que comprobar y no dar por buena.
 */
export function extrae(tgz, nombre) {
  const tar = gunzipSync(tgz);

  for (let cursor = 0; cursor + BLOQUE <= tar.length; ) {
    const cabeza = tar.subarray(cursor, cursor + BLOQUE);
    const hasta = (inicio, largo) => {
      const campo = cabeza.subarray(inicio, inicio + largo);
      const fin = campo.indexOf(0);
      return campo.subarray(0, fin === -1 ? campo.length : fin).toString('utf8');
    };

    const corto = hasta(0, 100);
    if (corto === '') break; // el bloque de ceros que cierra el archivo

    const prefijo = hasta(345, 155);
    const ruta = prefijo === '' ? corto : `${prefijo}/${corto}`;
    const tam = Number.parseInt(hasta(124, 12).trim(), 8) || 0;
    const cuerpo = cursor + BLOQUE;

    if (ruta === nombre) return tar.subarray(cuerpo, cuerpo + tam);

    cursor = cuerpo + Math.ceil(tam / BLOQUE) * BLOQUE;
  }

  throw new Error(`El tarball no lleva \`${nombre}\`.`);
}
