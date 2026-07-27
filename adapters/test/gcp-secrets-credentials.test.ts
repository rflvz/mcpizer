/**
 * `CredentialResolver` sobre el gestor de secretos del proveedor cloud.
 *
 * Lo que hay que comprobar, además de que sepa leer un secreto, es el ciclo de
 * vida que lo diferencia de una variable de entorno y de una bóveda: la
 * identidad con la que se autentica **caduca**, se guarda mientras vale, y se
 * vuelve a pedir cuando deja de valer — sin que nada de eso se filtre al puerto.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { gcpSecretsCredentials } from '../src/index.js';
import { startGcp, type GcpFixture } from '../../verification/lib/fixtures.js';

const SECRETO = 'credencial-de-la-cuenta-de-facturacion';
const REF = 'gcp-secrets://projects/mcpizer/secrets/facturacion';

let gcp: GcpFixture | undefined;

afterEach(async () => {
  await gcp?.close();
  gcp = undefined;
});

async function conSecretos(secrets: Record<string, string>, expiresIn = 3600): Promise<GcpFixture> {
  gcp = await startGcp({ secrets, expiresIn });
  return gcp;
}

function resolutor(fixture: GcpFixture, now: () => number = () => 0): ReturnType<typeof gcpSecretsCredentials> {
  return gcpSecretsCredentials({
    metadataUrl: fixture.metadataUrl,
    apiBase: fixture.apiBase,
    now,
    refreshMarginMs: 0,
  });
}

describe('lee el secreto', () => {
  it('con la identidad que le presta la plataforma, y sin versión pide la última', async () => {
    const fixture = await conSecretos({ 'projects/mcpizer/secrets/facturacion/versions/latest': SECRETO });

    expect(await resolutor(fixture).resolve(REF)).toEqual({ value: SECRETO });
    expect(fixture.lecturas).toEqual(['projects/mcpizer/secrets/facturacion/versions/latest']);
  });

  it('y respeta la versión cuando la referencia la fija', async () => {
    // Fijar la versión es lo que permite desplegar una rotación de credencial sin
    // que dependa de cuándo arrancó cada proceso.
    const fixture = await conSecretos({ 'projects/mcpizer/secrets/facturacion/versions/7': SECRETO });
    const ref = 'gcp-secrets://projects/mcpizer/secrets/facturacion/versions/7';

    expect(await resolutor(fixture).resolve(ref)).toEqual({ value: SECRETO });
  });
});

describe('la identidad prestada tiene ciclo de vida, y vive aquí dentro', () => {
  it('se pide una vez y se reutiliza mientras vale', async () => {
    const fixture = await conSecretos({
      'projects/mcpizer/secrets/a/versions/latest': 'uno',
      'projects/mcpizer/secrets/b/versions/latest': 'dos',
    });
    const resolve = resolutor(fixture);

    await resolve.resolve('gcp-secrets://projects/mcpizer/secrets/a');
    await resolve.resolve('gcp-secrets://projects/mcpizer/secrets/b');

    // Dos secretos, dos lecturas — y **una** identidad.
    expect(fixture.lecturas).toHaveLength(2);
    expect(fixture.identidades).toHaveLength(1);
  });

  it('y se vuelve a pedir cuando caduca', async () => {
    const fixture = await conSecretos({ 'projects/mcpizer/secrets/facturacion/versions/latest': SECRETO }, 10);
    let ahora = 0;
    const resolve = resolutor(fixture, () => ahora);

    await resolve.resolve(REF);
    expect(fixture.identidades).toHaveLength(1);

    // Pasan once segundos: la identidad de diez ya no vale.
    ahora = 11_000;
    await resolve.resolve(REF);
    expect(fixture.identidades).toHaveLength(2);
  });

  it('una identidad revocada no se repite para siempre: se olvida y se pide otra', async () => {
    const fixture = await conSecretos({ 'projects/mcpizer/secrets/facturacion/versions/latest': SECRETO });
    const resolve = resolutor(fixture);

    await resolve.resolve(REF);
    // El gestor rota la identidad por su cuenta: la guardada deja de valer.
    fixture.rota();

    await expect(resolve.resolve(REF)).rejects.toThrow(/niega el acceso/);
    // Y el siguiente intento vuelve a pedirla, en vez de heredar la caducada.
    expect(await resolve.resolve(REF)).toEqual({ value: SECRETO });
  });
});

describe('ninguna forma de fallo acaba en ejecutar sin credencial', () => {
  it('un gestor inalcanzable aborta', async () => {
    const fixture = await conSecretos({ 'projects/mcpizer/secrets/facturacion/versions/latest': SECRETO });
    await fixture.detiene();

    const resolve = gcpSecretsCredentials({
      metadataUrl: fixture.metadataUrl,
      apiBase: fixture.apiBase,
      timeoutMs: 500,
    });
    await expect(resolve.resolve(REF)).rejects.toThrow(/no responde/);
  });

  it('un secreto que no existe aborta, y no devuelve cadena vacía', async () => {
    const fixture = await conSecretos({});
    await expect(resolutor(fixture).resolve(REF)).rejects.toThrow(/no existe/);
  });

  it('una identidad que el gestor no acepta aborta', async () => {
    const fixture = await conSecretos({ 'projects/mcpizer/secrets/facturacion/versions/latest': SECRETO });
    fixture.revoca();
    await expect(resolutor(fixture).resolve(REF)).rejects.toThrow(/niega el acceso/);
  });

  it('y una referencia mal formada no se intenta adivinar', async () => {
    const fixture = await conSecretos({});
    for (const mala of ['gcp-secrets://facturacion', 'gcp-secrets://projects/mcpizer', 'gcp-secrets://']) {
      await expect(resolutor(fixture).resolve(mala)).rejects.toThrow(/no tiene la forma/);
    }
  });
});

describe('no resuelve lo que no es suyo', () => {
  it('una referencia de otro esquema es un error, no un intento', async () => {
    const fixture = await conSecretos({});
    await expect(resolutor(fixture).resolve('env://ALGO')).rejects.toThrow(/no es `gcp-secrets:\/\/`/);
  });
});

describe('ningún mensaje de error lleva material', () => {
  it('se nombra la referencia, que es un asa, nunca lo que hay al otro lado', async () => {
    const fixture = await conSecretos({ 'projects/mcpizer/secrets/facturacion/versions/latest': SECRETO });
    fixture.revoca();

    const error = await resolutor(fixture)
      .resolve(REF)
      .catch((cause: unknown) => (cause instanceof Error ? `${cause.message} ${String(cause.cause ?? '')}` : ''));

    expect(error).toContain(REF);
    expect(error).not.toContain(SECRETO);
    // Ni la identidad con que se pidió, que es tan canjeable como el secreto.
    for (const identidad of fixture.identidades) expect(error).not.toContain(identidad);
  });
});
