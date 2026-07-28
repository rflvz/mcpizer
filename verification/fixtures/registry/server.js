/**
 * Un registro de npm de mentira, hablando el protocolo real.
 *
 * Contesta lo que un cliente de npm pide para instalar: el documento de un
 * paquete —`GET /<nombre>`, con el ámbito codificado, `dist-tags` y el mapa de
 * versiones— y los tarballs que ese documento anuncia, con su `integrity`.
 *
 * Existe porque el criterio de esta sesión no se puede comprobar de otra manera:
 * *lo que se publica se instala y arranca*. Un doble diría que nuestro guion
 * llama a nuestra función; lo que hay que saber es si el `npm` de verdad —el que
 * teclea quien instala— entiende lo que se le va a subir. Y tiene que poder
 * saberse **sin red**, que es la regla que gobierna toda la verificación de este
 * repositorio (`docs/diseno/entrega.md` §4).
 *
 * Lo que sirve son dos cosas de procedencia distinta, y la distinción importa:
 *
 * - **Los siete paquetes propios**, tal y como los produce `pnpm pack`, que es
 *   el mismo camino que recorre `pnpm publish`. Son lo que está bajo prueba.
 * - **El cierre de dependencias**, empaquetado desde el almacén que fijó el
 *   fichero de bloqueo. No está bajo prueba: es el otro extremo del cable.
 */
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { empaqueta } from './tarball.js';

/**
 * Lee el almacén de pnpm y devuelve `nombre@version → directorio`.
 *
 * Se excluye lo propio: de los siete paquetes no vale lo que hay en el almacén
 * —lleva `workspace:*` sin sustituir, que es precisamente lo que `pnpm pack`
 * arregla— sino lo que se publicaría.
 */
export function cierre(root, excluir = () => false) {
  const almacen = join(root, 'node_modules', '.pnpm');
  const encontrados = new Map();

  for (const entrada of readdirSync(almacen)) {
    const raiz = join(almacen, entrada, 'node_modules');
    let nombres;
    try {
      nombres = readdirSync(raiz);
    } catch {
      continue; // `lock.yaml` y demás enseres del almacén.
    }

    // Un ámbito es un directorio con paquetes dentro, no un paquete.
    const paquetes = nombres.flatMap((nombre) =>
      nombre.startsWith('@')
        ? readdirSync(join(raiz, nombre)).map((sub) => `${nombre}/${sub}`)
        : [nombre],
    );

    for (const nombre of paquetes) {
      if (excluir(nombre)) continue;
      const dir = join(raiz, nombre);
      let manifiesto;
      try {
        manifiesto = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      } catch {
        continue;
      }
      if (typeof manifiesto.name !== 'string' || typeof manifiesto.version !== 'string') continue;

      const clave = `${manifiesto.name}@${manifiesto.version}`;
      if (!encontrados.has(clave)) encontrados.set(clave, { manifiesto, dir });
    }
  }

  return encontrados;
}

/**
 * Levanta el registro.
 *
 * `paquetes` es una lista de `{ manifiesto, produce }`. El manifiesto es lo que
 * acaba en el documento del paquete, que es de donde npm resuelve las
 * dependencias — el tarball solo decide qué ficheros aterrizan.
 *
 * `produce` no se llama hasta que alguien pide ese paquete. El espejo tiene el
 * almacén entero, con las dependencias de desarrollo dentro; npm solo pide las
 * que están en el grafo que resuelve, y empaquetar el compilador y el ejecutor
 * de tests para que nadie los descargue sería trabajo puro.
 */
export async function startRegistry(paquetes) {
  /** nombre → las versiones que hay de él, sin empaquetar todavía. */
  const porNombre = new Map();
  /** ruta → cómo producir esos bytes. */
  const rutas = new Map();
  /** Lo que se ha pedido, para poder afirmar que no se pidió nada de fuera del espejo. */
  const peticiones = [];

  for (const paquete of paquetes) {
    const { manifiesto } = paquete;
    const ruta = `/-/${manifiesto.name.replace('/', '+')}-${manifiesto.version}.tgz`;

    // Memoizado: el documento del paquete necesita los bytes para anunciar su
    // `integrity`, y npm los pide después. Empaquetar dos veces daría dos
    // tarballs idénticos y el doble de trabajo.
    let bytes;
    const produce = () => (bytes ??= paquete.produce());

    rutas.set(ruta, produce);
    porNombre.set(manifiesto.name, [
      ...(porNombre.get(manifiesto.name) ?? []),
      { manifiesto, ruta, produce },
    ]);
  }

  /** nombre → documento ya servido, para no rehacerlo en cada petición. */
  const documentos = new Map();

  function documento(nombre) {
    const versiones = porNombre.get(nombre);
    if (versiones === undefined) return undefined;

    let doc = documentos.get(nombre);
    if (doc !== undefined) return doc;

    doc = { name: nombre, 'dist-tags': {}, versions: {} };
    for (const { manifiesto, ruta, produce } of versiones) {
      const tarball = produce();
      doc.versions[manifiesto.version] = {
        ...manifiesto,
        dist: {
          tarball: `http://127.0.0.1:${puerto}${ruta}`,
          shasum: createHash('sha1').update(tarball).digest('hex'),
          integrity: `sha512-${createHash('sha512').update(tarball).digest('base64')}`,
        },
      };
      doc['dist-tags'].latest = manifiesto.version;
    }

    documentos.set(nombre, doc);
    return doc;
  }

  const server = createServer((request, response) => {
    const ruta = new URL(request.url, 'http://registro').pathname;
    peticiones.push(ruta);

    const produce = rutas.get(ruta);
    if (produce !== undefined) {
      response.writeHead(200, { 'content-type': 'application/octet-stream' });
      response.end(produce());
      return;
    }

    // `@ambito/nombre` viaja como `@ambito%2fnombre`.
    const doc = documento(decodeURIComponent(ruta).slice(1));
    if (doc === undefined) {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end('{"error":"Not found"}');
      return;
    }

    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(doc));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const puerto = server.address().port;

  return {
    url: `http://127.0.0.1:${puerto}`,
    peticiones,
    detiene: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}

/** El espejo: todo lo que hay en el almacén, listo para empaquetarse si lo piden. */
export function espeja(root, excluir) {
  return [...cierre(root, excluir).values()].map(({ manifiesto, dir }) => ({
    manifiesto,
    produce: () => empaqueta(dir),
  }));
}
