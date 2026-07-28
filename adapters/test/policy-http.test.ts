/**
 * `PolicySource` sobre HTTP.
 *
 * Lo que de verdad hay que comprobar no es que sepa hacer un GET, sino los dos
 * modos de fallo que ni fichero ni git tienen: que el origen conteste **otra
 * cosa** con un 200, y que el canal por el que llega el artefacto sea uno que
 * nadie en el camino pueda reescribir.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { parseHttpOrigin, policyHttp } from '../src/index.js';
import { startPolicyHttp, type PolicyHttpFixture } from '../../verification/lib/fixtures.js';

const POLITICA = `version: 1
capabilities:
  - id: crm.contact.read
`;

let fixture: PolicyHttpFixture | undefined;

afterEach(async () => {
  await fixture?.close();
  fixture = undefined;
});

describe('el especificador dice qué adaptador atiende', () => {
  it('reconoce `https://` y `http://` contra la interfaz de bucle', () => {
    expect(parseHttpOrigin('https://config.internal/mcpizer.yaml')).toEqual({
      url: 'https://config.internal/mcpizer.yaml',
    });
    expect(parseHttpOrigin('http://127.0.0.1:8080/mcpizer.yaml')).toBeDefined();
    expect(parseHttpOrigin('http://localhost/mcpizer.yaml')).toBeDefined();
  });

  it('no reconoce una ruta ni un origen git: los atiende otro', () => {
    expect(parseHttpOrigin('examples/policy.yaml')).toBeUndefined();
    expect(parseHttpOrigin('git+https://git.internal/p.git#refs/heads/main:m.yaml')).toBeUndefined();
  });

  it('rechaza `http://` a cualquier otro sitio, y dice por qué', () => {
    // El artefacto decide quién puede hacer qué. Traerlo por un canal que
    // cualquiera en el camino puede reescribir es entregar la autorización.
    expect(() => parseHttpOrigin('http://config.internal/mcpizer.yaml')).toThrow(/reescribir/);
  });
});

describe('trae el artefacto', () => {
  it('con su texto y una versión que es la huella del contenido', async () => {
    fixture = await startPolicyHttp({ body: POLITICA });
    const cargado = await policyHttp({ url: fixture.url }).load();

    expect(cargado.text).toBe(POLITICA);
    expect(cargado.origin).toBe(fixture.url);
    expect(cargado.version).toMatch(/^[0-9a-f]{12}$/);
  });

  it('y la versión cambia cuando cambia el cuerpo, aunque el origen no diga nada', async () => {
    // Es la razón de que la versión sea la huella y no lo que declare el
    // servidor: un `ETag` que no cambia mientras el cuerpo sí lo hace
    // convertiría un cambio de autorización en algo invisible.
    fixture = await startPolicyHttp({ body: POLITICA });
    const source = policyHttp({ url: fixture.url });
    const antes = await source.load();

    fixture.sirve(`${POLITICA}  - id: crm.contact.write\n`);
    const despues = await source.load();

    expect(despues.version).not.toBe(antes.version);
  });

  it('pidiéndolo sin caché: una política vieja servida por un proxy es una decisión vieja', async () => {
    fixture = await startPolicyHttp({ body: POLITICA });
    await policyHttp({ url: fixture.url }).load();
    expect(fixture.peticiones[0]?.cacheControl).toBe('no-cache');
  });
});

describe('un origen que no sirve el artefacto produce arranque fallido', () => {
  it('un 404 no es una política vacía', async () => {
    // Una política vacía sería sintácticamente válida y lo denegaría todo, que
    // es seguro e indistinguible de un fallo de infraestructura.
    fixture = await startPolicyHttp({ body: 'no such thing', status: 404 });
    await expect(policyHttp({ url: fixture.url }).load()).rejects.toThrow(/404/);
  });

  it('un cuerpo vacío tampoco', async () => {
    fixture = await startPolicyHttp({ body: '   ' });
    await expect(policyHttp({ url: fixture.url }).load()).rejects.toThrow(/vacío/);
  });

  it('y un origen inalcanzable, tampoco', async () => {
    fixture = await startPolicyHttp({ body: POLITICA });
    const url = fixture.url;
    await fixture.detiene();
    await expect(policyHttp({ url, timeoutMs: 500 }).load()).rejects.toThrow(/no responde/);
  });
});
