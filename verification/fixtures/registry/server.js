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

/** El marcador que se sustituye por el puerto real, que no se sabe hasta escuchar. */
const PUERTO = '__PUERTO__';

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
 * `paquetes` es una lista de `{ manifiesto, tarball }`. El manifiesto es lo que
 * acaba en el documento del paquete, que es de donde npm resuelve las
 * dependencias — el tarball solo decide qué ficheros aterrizan.
 */
export async function startRegistry(paquetes) {
  /** ruta → bytes */
  const tarballs = new Map();
  /** nombre → documento del paquete */
  const documentos = new Map();
  /** Lo que se ha pedido, para poder afirmar que no se pidió nada de fuera del espejo. */
  const peticiones = [];

  for (const { manifiesto, tarball } of paquetes) {
    const ruta = `/-/${manifiesto.name.replace('/', '+')}-${manifiesto.version}.tgz`;
    tarballs.set(ruta, tarball);

    const documento = documentos.get(manifiesto.name) ?? {
      name: manifiesto.name,
      'dist-tags': {},
      versions: {},
    };
    documento.versions[manifiesto.version] = {
      ...manifiesto,
      dist: {
        tarball: `http://127.0.0.1:${PUERTO}${ruta}`,
        shasum: createHash('sha1').update(tarball).digest('hex'),
        integrity: `sha512-${createHash('sha512').update(tarball).digest('base64')}`,
      },
    };
    documento['dist-tags'].latest = manifiesto.version;
    documentos.set(manifiesto.name, documento);
  }

  const server = createServer((request, response) => {
    const ruta = new URL(request.url, 'http://registro').pathname;
    peticiones.push(ruta);

    const tarball = tarballs.get(ruta);
    if (tarball !== undefined) {
      response.writeHead(200, { 'content-type': 'application/octet-stream' });
      response.end(tarball);
      return;
    }

    // `@ambito/nombre` viaja como `@ambito%2fnombre`.
    const documento = documentos.get(decodeURIComponent(ruta).slice(1));
    if (documento === undefined) {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end('{"error":"Not found"}');
      return;
    }

    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(documento).replaceAll(PUERTO, String(puerto)));
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

/** El espejo completo: el cierre del almacén, empaquetado. */
export function espeja(root, excluir) {
  return [...cierre(root, excluir).values()].map(({ manifiesto, dir }) => ({
    manifiesto,
    tarball: empaqueta(dir),
  }));
}
