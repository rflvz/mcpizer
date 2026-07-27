/**
 * Un proveedor OIDC de mentira.
 *
 * Es el otro lado del cable, como `../upstream/server.js`: sirve descubrimiento
 * y JWKS de verdad, por HTTP, y firma tokens de verdad. No es un doble de los
 * que `docs/diseno/verificacion.md` §2.4 prohíbe — aquellos sustituirían algo
 * *dentro* del núcleo.
 *
 * Firma a mano con `node:crypto` **a propósito**, sin `jose`. El adaptador
 * verifica con `jose`; si el fixture firmara con la misma biblioteca, un error
 * de uso se cancelaría contra sí mismo y el test pasaría sin demostrar nada.
 *
 * Va en JavaScript porque `verification/fixtures/` queda fuera de la
 * compilación y del linter.
 */
import { createServer } from 'node:http';
import { createPublicKey, createSign, generateKeyPairSync } from 'node:crypto';

const base64url = (input) => Buffer.from(input).toString('base64url');

function keyPair(kid) {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = createPublicKey(privateKey).export({ format: 'jwk' });
  return { kid, privateKey, jwk: { ...jwk, kid, alg: 'RS256', use: 'sig' } };
}

/**
 * Levanta el proveedor.
 *
 * Devuelve dos claves: la que publica en el JWKS y una **impostora** que no
 * publica. Firmar con la segunda produce un token bien formado cuya firma no
 * valida, que es el caso que separa "credencial inválida" de "credencial
 * ausente" y no se puede fabricar de otra forma.
 */
export async function startOidc() {
  const firmante = keyPair('llave-publicada');
  const impostor = keyPair('llave-no-publicada');

  const server = createServer((request, response) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const send = (status, body) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };

    if (url.pathname === '/.well-known/openid-configuration') {
      return send(200, { issuer: base, jwks_uri: `${base}/jwks.json` });
    }
    if (url.pathname === '/jwks.json') {
      return send(200, { keys: [firmante.jwk] });
    }
    return send(404, { error: 'no existe' });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  /**
   * Emite un token. Todo es parametrizable porque cada parámetro es el que
   * distingue uno de los cuatro fallos de `PrincipalResolver`.
   */
  const emite = ({
    subject = 'ana',
    audience = 'mcpizer',
    issuer = base,
    claims = {},
    expiresInSeconds = 300,
    notBeforeSeconds = 0,
    firmadoPor = firmante,
    at = Date.now(),
  } = {}) => {
    const segundos = Math.floor(at / 1000);
    const header = { alg: 'RS256', typ: 'JWT', kid: firmadoPor.kid };
    const payload = {
      iss: issuer,
      sub: subject,
      aud: audience,
      iat: segundos,
      nbf: segundos + notBeforeSeconds,
      exp: segundos + expiresInSeconds,
      ...claims,
    };
    const entrada = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
    const firma = createSign('RSA-SHA256').update(entrada).sign(firmadoPor.privateKey).toString('base64url');
    return `${entrada}.${firma}`;
  };

  return {
    /** La URL de descubrimiento, tal como se declara en el artefacto. */
    discovery: `${base}/.well-known/openid-configuration`,
    issuer: base,
    emite,
    /** Firma con una clave que el JWKS no publica: token bien formado, firma que no valida. */
    emiteConFirmaAjena: (options = {}) => emite({ ...options, firmadoPor: impostor }),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
