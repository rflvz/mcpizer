/**
 * Un emisor de tokens OAuth de mentira: `client_credentials`, y nada más.
 *
 * Habla el intercambio real —`POST` con `application/x-www-form-urlencoded`,
 * `grant_type=client_credentials`, y una respuesta `{access_token, expires_in}`—
 * porque lo que hay que comprobar es que el adaptador lo entiende.
 *
 * Cuenta las acuñaciones, que es la única forma de afirmar que el adaptador
 * guarda el token en vez de pedir uno por invocación, y que lo renueva cuando
 * caduca en vez de mandar uno muerto al upstream.
 */
import { createServer } from 'node:http';

export async function startOauth({ clients = {}, expiresIn = 3600 } = {}) {
  /** Cada acuñación, con lo que se presentó. Nunca se devuelve el secreto en una respuesta. */
  const acuñaciones = [];
  let contador = 0;

  const server = createServer((request, response) => {
    const send = (status, body) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };

    if (request.method !== 'POST') return send(405, { error: 'invalid_request' });

    let cuerpo = '';
    request.on('data', (trozo) => {
      cuerpo += trozo;
    });
    request.on('end', () => {
      const campos = new URLSearchParams(cuerpo);

      if (campos.get('grant_type') !== 'client_credentials') {
        return send(400, { error: 'unsupported_grant_type' });
      }

      const client = campos.get('client_id');
      const esperado = clients[client];
      if (esperado === undefined || campos.get('client_secret') !== esperado) {
        // El emisor no distingue "no existe" de "secreto incorrecto", igual que
        // los de verdad: decirlo sería un oráculo de enumeración de clientes.
        return send(401, { error: 'invalid_client' });
      }

      contador += 1;
      const scope = campos.get('scope') ?? undefined;
      acuñaciones.push({ client, scope });

      return send(200, {
        access_token: `token-acuñado-${contador}`,
        token_type: 'Bearer',
        expires_in: expiresIn,
      });
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  return {
    tokenUrl: `http://127.0.0.1:${server.address().port}/oauth2/token`,
    acuñaciones,
    detiene: () => new Promise((resolve) => server.close(resolve)),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
