/**
 * Un HashiCorp Vault de mentira: KV v2, lo mínimo que el adaptador usa.
 *
 * Habla el API real —`GET /v1/{mount}/data/{path}`, cabecera `X-Vault-Token`,
 * la envoltura `data.data`— porque lo que hay que comprobar es que el adaptador
 * la entiende, no que llama a una función nuestra.
 *
 * Distingue los tres fallos que `docs/diseno/puertos.md` §2.5 exige distinguir:
 * token inválido (403), referencia desconocida (404) y bóveda inalcanzable
 * (`detiene()`), y ninguno puede degradar a ejecutar sin credencial.
 */
import { createServer } from 'node:http';

export async function startVault({ token = 'token-de-vault', secrets = {} } = {}) {
  /** Lo que se le ha pedido, para poder afirmar que se pidió **una sola vez** y solo lo autorizado. */
  const peticiones = [];

  const server = createServer((request, response) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const send = (status, body) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };

    peticiones.push(url.pathname);

    if (request.headers['x-vault-token'] !== token) {
      return send(403, { errors: ['permission denied'] });
    }

    // `/v1/{mount}/data/{path}` — la forma de KV v2, donde `data` se interpone
    // entre el punto de montaje y la ruta.
    const partes = url.pathname.split('/').filter((parte) => parte !== '');
    if (partes[0] !== 'v1' || partes[2] !== 'data') return send(404, { errors: [] });

    const clave = `${partes[1]}/${partes.slice(3).join('/')}`;
    const secreto = secrets[clave];
    if (secreto === undefined) return send(404, { errors: [] });

    return send(200, { data: { data: secreto, metadata: { version: 1 } } });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  return {
    url: `http://127.0.0.1:${server.address().port}`,
    token,
    peticiones,
    /** Cae la bóveda, sin cerrar el proceso: el caso de "inalcanzable". */
    detiene: () => new Promise((resolve) => server.close(resolve)),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
