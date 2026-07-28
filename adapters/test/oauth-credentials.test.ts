/**
 * `CredentialResolver` sobre un almacén de tokens OAuth, con refresco.
 *
 * Lo que hay que comprobar es lo que ninguna de las otras tres implementaciones
 * tiene: la credencial **no existe hasta que se pide**, caduca, y se renueva
 * sola. Y que nada de eso se filtre al puerto ni al artefacto — el secreto del
 * cliente sigue siendo una referencia, no un valor.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { oauthCredentials } from '../src/index.js';
import { startOauth, type OauthFixture } from '../../verification/lib/fixtures.js';

const SECRETO_DEL_CLIENTE = 'secreto-del-cliente-de-facturacion';

let oauth: OauthFixture | undefined;

afterEach(async () => {
  await oauth?.close();
  oauth = undefined;
});

/** El despachador que resuelve la referencia anidada. En producción, el del compositor. */
function guardados(valores: Record<string, string>) {
  const pedidas: string[] = [];
  return {
    pedidas,
    async resolveClientSecret(secretRef: string): Promise<{ value: string }> {
      pedidas.push(secretRef);
      const value = valores[secretRef];
      if (value === undefined) throw new Error(`La referencia \`${secretRef}\` no existe.`);
      return { value };
    },
  };
}

function referencia(fixture: OauthFixture, extra = ''): string {
  return `oauth+${fixture.tokenUrl}?client=agente&secret=env://CLAVE${extra}`;
}

describe('acuña el token contra el emisor', () => {
  it('con el secreto del cliente, que sale de otra referencia y no del artefacto', async () => {
    oauth = await startOauth({ clients: { agente: SECRETO_DEL_CLIENTE } });
    const almacen = guardados({ 'env://CLAVE': SECRETO_DEL_CLIENTE });

    const material = await oauthCredentials(almacen).resolve(referencia(oauth));

    expect(material).toEqual({ value: 'token-acuñado-1' });
    // El artefacto nombró `env://CLAVE`; el valor lo puso el despachador. Así el
    // secreto del cliente puede vivir en la bóveda como cualquier otro.
    expect(almacen.pedidas).toEqual(['env://CLAVE']);
  });

  it('y le pasa el alcance cuando la referencia lo declara', async () => {
    oauth = await startOauth({ clients: { agente: SECRETO_DEL_CLIENTE } });
    const almacen = guardados({ 'env://CLAVE': SECRETO_DEL_CLIENTE });

    await oauthCredentials(almacen).resolve(referencia(oauth, '&scope=facturacion.emitir'));

    expect(oauth.acuñaciones).toEqual([{ client: 'agente', scope: 'facturacion.emitir' }]);
  });
});

describe('el token tiene ciclo de vida, y vive aquí dentro', () => {
  it('se acuña una vez y se reutiliza mientras vale', async () => {
    oauth = await startOauth({ clients: { agente: SECRETO_DEL_CLIENTE } });
    const resolve = oauthCredentials({ ...guardados({ 'env://CLAVE': SECRETO_DEL_CLIENTE }), now: () => 0 });
    const ref = referencia(oauth);

    expect(await resolve.resolve(ref)).toEqual({ value: 'token-acuñado-1' });
    expect(await resolve.resolve(ref)).toEqual({ value: 'token-acuñado-1' });
    expect(oauth.acuñaciones).toHaveLength(1);
  });

  it('y se renueva antes de caducar, no después', async () => {
    // Renovar *después* de caducar significa mandar al upstream un token muerto
    // y descubrirlo por un 401 que el cliente ya ha visto.
    oauth = await startOauth({ clients: { agente: SECRETO_DEL_CLIENTE }, expiresIn: 100 });
    let ahora = 0;
    const resolve = oauthCredentials({
      ...guardados({ 'env://CLAVE': SECRETO_DEL_CLIENTE }),
      now: () => ahora,
      refreshMarginMs: 30_000,
    });
    const ref = referencia(oauth);

    await resolve.resolve(ref);
    // A los 80 s quedan 20 de vida, menos que el margen de 30: se renueva.
    ahora = 80_000;
    expect(await resolve.resolve(ref)).toEqual({ value: 'token-acuñado-2' });
  });

  it('un token sin caducidad declarada no se guarda: se usa y se olvida', async () => {
    // Suponerle una vida larga es la forma de acabar mandando un token muerto.
    oauth = await startOauth({ clients: { agente: SECRETO_DEL_CLIENTE }, expiresIn: 0 });
    const resolve = oauthCredentials({ ...guardados({ 'env://CLAVE': SECRETO_DEL_CLIENTE }), now: () => 0 });
    const ref = referencia(oauth);

    await resolve.resolve(ref);
    await resolve.resolve(ref);
    expect(oauth.acuñaciones).toHaveLength(2);
  });

  it('dos cuentas distintas no comparten token', async () => {
    oauth = await startOauth({ clients: { agente: SECRETO_DEL_CLIENTE, otro: 'otro-secreto' } });
    const resolve = oauthCredentials({
      ...guardados({ 'env://CLAVE': SECRETO_DEL_CLIENTE, 'env://OTRA': 'otro-secreto' }),
      now: () => 0,
    });

    const uno = await resolve.resolve(referencia(oauth));
    const dos = await resolve.resolve(`oauth+${oauth.tokenUrl}?client=otro&secret=env://OTRA`);

    expect(uno).not.toEqual(dos);
    expect(oauth.acuñaciones.map((a) => a.client)).toEqual(['agente', 'otro']);
  });
});

describe('ninguna forma de fallo acaba en ejecutar sin credencial', () => {
  it('un emisor inalcanzable aborta', async () => {
    oauth = await startOauth({ clients: { agente: SECRETO_DEL_CLIENTE } });
    const ref = referencia(oauth);
    await oauth.detiene();

    const resolve = oauthCredentials({
      ...guardados({ 'env://CLAVE': SECRETO_DEL_CLIENTE }),
      timeoutMs: 500,
    });
    await expect(resolve.resolve(ref)).rejects.toThrow(/no responde/);
  });

  it('un cliente que el emisor rechaza aborta', async () => {
    oauth = await startOauth({ clients: { agente: SECRETO_DEL_CLIENTE } });
    const resolve = oauthCredentials(guardados({ 'env://CLAVE': 'el-secreto-equivocado' }));
    await expect(resolve.resolve(referencia(oauth))).rejects.toThrow(/rechaza el cliente/);
  });

  it('y un secreto de cliente que no se puede resolver aborta antes de salir a la red', async () => {
    oauth = await startOauth({ clients: { agente: SECRETO_DEL_CLIENTE } });
    const resolve = oauthCredentials(guardados({}));

    await expect(resolve.resolve(referencia(oauth))).rejects.toThrow(/no existe/);
    expect(oauth.acuñaciones).toHaveLength(0);
  });
});

describe('la forma de la referencia se comprueba, no se adivina', () => {
  const resolve = oauthCredentials(guardados({}));

  it('sin `client` o sin `secret` no hay nada que acuñar', async () => {
    await expect(resolve.resolve('oauth+https://id.internal/token?client=agente')).rejects.toThrow(
      /no declara/,
    );
    await expect(resolve.resolve('oauth+https://id.internal/token?secret=env://X')).rejects.toThrow(
      /no declara/,
    );
  });

  it('una referencia que se anida a sí misma no da una recursión, da un mensaje', async () => {
    await expect(
      resolve.resolve('oauth+https://id.internal/token?client=a&secret=oauth+https://id.internal/token'),
    ).rejects.toThrow(/anida otra/);
  });

  it('y el secreto del cliente no sale por un canal que cualquiera pueda leer', async () => {
    await expect(
      resolve.resolve('oauth+http://id.internal/token?client=a&secret=env://X'),
    ).rejects.toThrow(/cualquiera puede leer/);
  });

  it('una referencia de otro esquema es un error, no un intento', async () => {
    await expect(resolve.resolve('vault://kv/algo')).rejects.toThrow(/no es `oauth\+`/);
  });
});

describe('ningún mensaje de error lleva material', () => {
  it('se nombra la referencia, nunca el secreto del cliente ni el token', async () => {
    oauth = await startOauth({ clients: { agente: SECRETO_DEL_CLIENTE } });
    const resolve = oauthCredentials(guardados({ 'env://CLAVE': 'el-secreto-equivocado' }));

    const error = await resolve
      .resolve(referencia(oauth))
      .catch((cause: unknown) => (cause instanceof Error ? `${cause.message} ${String(cause.cause ?? '')}` : ''));

    expect(error).toContain('agente');
    expect(error).not.toContain('el-secreto-equivocado');
    expect(error).not.toContain(SECRETO_DEL_CLIENTE);
  });
});
