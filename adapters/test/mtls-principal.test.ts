/**
 * `PrincipalResolver` sobre identidad de certificado de cliente.
 *
 * Lo que hay que comprobar es lo mismo que en los otros dos resolutores, porque
 * es el contrato: **nunca se devuelve un principal cuya credencial no se haya
 * verificado**, y lo que no está declarado en el artefacto no puede
 * discriminarse. Lo que cambia es de dónde sale la identidad.
 */
import { describe, expect, it } from 'vitest';
import { mtlsPrincipals } from '../src/index.js';

const EMISOR = {
  id: 'corp',
  attributes: { team: 'dn:O', role: 'dn:OU', ignorado: 'claim:groups' },
};

const resolver = mtlsPrincipals([EMISOR]);

/** Lo que Envoy pone en `x-forwarded-client-cert`. */
function xfcc(subject: string): string {
  return `By=spiffe://cluster/ns/default/sa/gateway;Hash=abc123;Subject="${subject}";URI=spiffe://cluster/ns/ventas/sa/ana`;
}

describe('la identidad sale del nombre distinguido', () => {
  it('el nombre común es el sujeto, y los componentes declarados son atributos', async () => {
    const resuelto = await resolver.resolve({
      issuer: 'corp',
      presented: xfcc('CN=ana,O=ventas,OU=manager,C=ES'),
    });

    expect(resuelto).toEqual({
      ok: true,
      issuer: 'corp',
      subject: 'ana',
      // `C=ES` está en el certificado y no en el artefacto, así que no existe
      // para la política. Y `claim:groups` no es un componente: se descarta.
      attributes: { team: 'ventas', role: 'manager' },
    });
  });

  it('también cuando el terminador reenvía el nombre distinguido a secas', async () => {
    const resuelto = await resolver.resolve({ issuer: 'corp', presented: 'CN=ana,O=ventas,OU=manager' });
    expect(resuelto).toMatchObject({ ok: true, subject: 'ana', attributes: { team: 'ventas' } });
  });

  it('y admite comas escapadas dentro de un valor, que son legales', async () => {
    const resuelto = await resolver.resolve({
      issuer: 'corp',
      presented: xfcc('CN=Ceitu\\, Rafa,O=ventas'),
    });
    expect(resuelto).toMatchObject({ ok: true, subject: 'Ceitu, Rafa' });
  });
});

describe('un componente repetido no produce atributo', () => {
  it('porque los atributos son de un solo valor y elegir uno decidiría por sorteo', async () => {
    // Es la misma regla que con un claim multivaluado (decisión 0024), y `OU`
    // repetido es lo normal en un certificado real.
    const resuelto = await resolver.resolve({
      issuer: 'corp',
      presented: xfcc('CN=ana,O=ventas,OU=manager,OU=becario'),
    });

    expect(resuelto).toMatchObject({ ok: true, subject: 'ana' });
    if (resuelto.ok) {
      expect(resuelto.attributes).toEqual({ team: 'ventas' });
      // Y como el selector es una conjunción de igualdades, un atributo ausente
      // no casa con ninguna concesión: fallo cerrado por construcción.
      expect(resuelto.attributes['role']).toBeUndefined();
    }
  });
});

describe('nunca devuelve un principal que no haya podido identificar', () => {
  it('sin cabecera, falta credencial: no es que el certificado sea malo', async () => {
    expect(await resolver.resolve({ issuer: 'corp', presented: '' })).toEqual({
      ok: false,
      problem: 'credential_missing',
    });
    expect(await resolver.resolve(undefined)).toEqual({ ok: false, problem: 'credential_missing' });
  });

  it('un emisor que este adaptador no atiende no autentica a nadie', async () => {
    expect(await resolver.resolve({ issuer: 'otro', presented: xfcc('CN=ana') })).toEqual({
      ok: false,
      problem: 'issuer_unknown',
    });
  });

  it('algo que no es un nombre distinguido no lo es "casi"', async () => {
    for (const presentado of ['un-token-cualquiera', 'Bearer eyJhbGciOi', '{"cn":"ana"}']) {
      expect(await resolver.resolve({ issuer: 'corp', presented: presentado })).toEqual({
        ok: false,
        problem: 'credential_invalid',
      });
    }
  });

  it('y un certificado sin nombre común, o con dos, no identifica a nadie', async () => {
    expect(await resolver.resolve({ issuer: 'corp', presented: xfcc('O=ventas,OU=manager') })).toEqual({
      ok: false,
      problem: 'credential_invalid',
    });
    // Dos `CN` es la forma sutil: hay identidad, y no se sabe cuál.
    expect(await resolver.resolve({ issuer: 'corp', presented: xfcc('CN=ana,CN=admin,O=ventas') })).toEqual({
      ok: false,
      problem: 'credential_invalid',
    });
  });
});
