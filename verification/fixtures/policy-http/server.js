/**
 * Un origen de política por HTTP, de mentira.
 *
 * Sirve para ejercitar el modo de fallo que ni fichero ni git tienen: que el
 * origen conteste **otra cosa**. Un portal cautivo, un balanceador que devuelve
 * su página de error o un proxy que interpone HTML producen un 200 con un cuerpo
 * que no es la política, y eso tiene que verse.
 */
import { createServer } from 'node:http';

export async function startPolicyHttp({ body = '', status = 200, contentType = 'application/yaml' } = {}) {
  /** Lo que se ha pedido, para poder afirmar que se pidió sin caché. */
  const peticiones = [];

  let cuerpo = body;
  let codigo = status;

  const server = createServer((request, response) => {
    peticiones.push({ path: request.url, cacheControl: request.headers['cache-control'] });
    response.writeHead(codigo, { 'content-type': contentType });
    response.end(cuerpo);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  return {
    url: `http://127.0.0.1:${server.address().port}/mcpizer.yaml`,
    peticiones,
    /** Cambia lo que se sirve, sin tocar ninguna cabecera de versión. */
    sirve(nuevo, nuevoCodigo = 200) {
      cuerpo = nuevo;
      codigo = nuevoCodigo;
    },
    detiene: () => new Promise((resolve) => server.close(resolve)),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
