/**
 * Un gestor de secretos de nube de mentira, con su servidor de metadatos.
 *
 * Habla las dos APIs reales, porque lo que hay que comprobar es que el adaptador
 * las entiende y no que llama a una función nuestra:
 *
 * - **Metadatos**: `GET …/token` con `Metadata-Flavor: Google`, y una respuesta
 *   `{access_token, expires_in}`. La identidad **caduca**, y aquí se puede
 *   controlar cuánto dura para poder ejercitar el refresco.
 * - **Secret Manager**: `GET /v1/{name}:access` con `Authorization: Bearer`, y la
 *   envoltura `payload.data` en base64.
 *
 * Cuenta cuántas veces se le pide identidad, que es la única forma de afirmar
 * que el adaptador la guarda en vez de pedirla en cada resolución.
 */
import { createServer } from 'node:http';

export async function startGcp({ secrets = {}, expiresIn = 3600 } = {}) {
  /** Cuántas veces se ha pedido identidad, y cuántos secretos se han leído. */
  const identidades = [];
  const lecturas = [];

  let token = 'identidad-prestada-1';
  let acepta = true;

  const server = createServer((request, response) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const send = (status, body) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };

    if (url.pathname === '/computeMetadata/v1/instance/service-accounts/default/token') {
      // Sin la cabecera, el servidor de metadatos real no contesta. Es la
      // protección contra que se lo pida un navegador desde dentro de la VM.
      if (request.headers['metadata-flavor'] !== 'Google') return send(403, { error: 'missing flavor' });
      identidades.push(token);
      return send(200, { access_token: token, expires_in: expiresIn, token_type: 'Bearer' });
    }

    const acceso = /^\/v1\/(.+):access$/.exec(url.pathname);
    if (acceso === null) return send(404, { error: { message: 'not found' } });

    if (!acepta || request.headers.authorization !== `Bearer ${token}`) {
      return send(401, { error: { message: 'unauthenticated' } });
    }

    lecturas.push(acceso[1]);
    const secreto = secrets[acceso[1]];
    if (secreto === undefined) return send(404, { error: { message: 'secret not found' } });

    return send(200, {
      name: acceso[1],
      payload: { data: Buffer.from(secreto, 'utf8').toString('base64') },
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  return {
    metadataUrl: `${base}/computeMetadata/v1/instance/service-accounts/default/token`,
    apiBase: `${base}/v1`,
    identidades,
    lecturas,
    /** Rota la identidad: la que el adaptador tuviera guardada deja de valer. */
    rota(nueva = 'identidad-prestada-2') {
      token = nueva;
    },
    /** Deja de aceptar cualquier identidad: el caso de "me han revocado". */
    revoca() {
      acepta = false;
    },
    admite() {
      acepta = true;
    },
    detiene: () => new Promise((resolve) => server.close(resolve)),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
