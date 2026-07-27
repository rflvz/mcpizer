/**
 * `PrincipalResolver` sobre OIDC, contra un proveedor que sirve descubrimiento y
 * JWKS por HTTP y firma tokens de verdad.
 *
 * Lo que hay que demostrar es lo que el contrato garantiza: **nunca devuelve un
 * principal cuya credencial no haya validado**, y los cuatro fallos se
 * distinguen, porque acaban en motivos distintos y se arreglan de formas
 * distintas.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startOidc, type OidcFixture } from '../../verification/lib/fixtures.js';
import { oidcPrincipals, type OidcIssuer } from '../src/oidc-principal.js';

let proveedor: OidcFixture;

function emisor(overrides: Partial<OidcIssuer> = {}): OidcIssuer {
  return {
    id: 'corp',
    discovery: proveedor.discovery,
    audience: 'mcpizer',
    attributes: { team: 'claim:groups', role: 'claim:role' },
    ...overrides,
  };
}

beforeEach(async () => {
  proveedor = await startOidc();
});

afterEach(async () => {
  await proveedor.close();
});

describe('convierte un token en un principal', () => {
  it('el sujeto sale de `sub` y los atributos de los claims declarados', async () => {
    const resolver = oidcPrincipals([emisor()]);
    const token = proveedor.emite({ subject: 'ana', claims: { groups: 'ventas', role: 'manager' } });

    expect(await resolver.resolve({ issuer: 'corp', presented: token })).toEqual({
      ok: true,
      issuer: 'corp',
      subject: 'ana',
      attributes: { team: 'ventas', role: 'manager' },
    });
  });

  it('lo que el artefacto no declara se descarta, aunque venga en el token', async () => {
    const resolver = oidcPrincipals([emisor({ attributes: { team: 'claim:groups' } })]);
    const token = proveedor.emite({ claims: { groups: 'ventas', role: 'admin', departamento: 'todo' } });
    const resuelto = await resolver.resolve({ issuer: 'corp', presented: token });

    // La política no puede discriminar sobre algo que no esté declarado.
    expect(resuelto).toEqual({ ok: true, issuer: 'corp', subject: 'ana', attributes: { team: 'ventas' } });
  });

  it('un claim de un solo elemento se reduce sin ambigüedad', async () => {
    const resolver = oidcPrincipals([emisor()]);
    const token = proveedor.emite({ claims: { groups: ['ventas'], role: 'manager' } });
    const resuelto = await resolver.resolve({ issuer: 'corp', presented: token });

    expect(resuelto).toMatchObject({ ok: true, attributes: { team: 'ventas', role: 'manager' } });
  });

  it('un claim multivaluado no produce atributo, y eso deniega por construcción', async () => {
    const resolver = oidcPrincipals([emisor()]);
    const token = proveedor.emite({ claims: { groups: ['ventas', 'compras'], role: 'manager' } });
    const resuelto = await resolver.resolve({ issuer: 'corp', presented: token });

    // El selector es una conjunción de igualdades (decisión 0011): un atributo
    // ausente no casa con ninguna concesión que lo nombre. El token sigue siendo
    // válido — sería incoherente rechazarlo por traer claims que nadie usa.
    expect(resuelto).toEqual({ ok: true, issuer: 'corp', subject: 'ana', attributes: { role: 'manager' } });
  });
});

describe('los cuatro fallos se distinguen', () => {
  it('sin token: `credential_missing`', async () => {
    const resolver = oidcPrincipals([emisor()]);

    expect(await resolver.resolve(undefined)).toEqual({ ok: false, problem: 'credential_missing' });
    expect(await resolver.resolve({ issuer: 'corp', presented: '' })).toEqual({
      ok: false,
      problem: 'credential_missing',
    });
  });

  it('emisor no declarado: `issuer_unknown`', async () => {
    const resolver = oidcPrincipals([emisor()]);
    const token = proveedor.emite();

    expect(await resolver.resolve({ issuer: 'otro', presented: token })).toEqual({
      ok: false,
      problem: 'issuer_unknown',
    });
  });

  it('token caducado: `credential_expired`', async () => {
    const resolver = oidcPrincipals([emisor()]);
    const token = proveedor.emite({ expiresInSeconds: -60 });

    expect(await resolver.resolve({ issuer: 'corp', presented: token })).toEqual({
      ok: false,
      problem: 'credential_expired',
    });
  });

  it('firma que no valida: `credential_invalid`', async () => {
    const resolver = oidcPrincipals([emisor()]);
    // Bien formado, con un `kid` que el JWKS no publica.
    const token = proveedor.emiteConFirmaAjena();

    expect(await resolver.resolve({ issuer: 'corp', presented: token })).toEqual({
      ok: false,
      problem: 'credential_invalid',
    });
  });

  it('audiencia ajena: `credential_invalid`', async () => {
    const resolver = oidcPrincipals([emisor()]);
    const token = proveedor.emite({ audience: 'otro-servicio' });

    expect(await resolver.resolve({ issuer: 'corp', presented: token })).toEqual({
      ok: false,
      problem: 'credential_invalid',
    });
  });

  it('emisor ajeno: `credential_invalid`', async () => {
    const resolver = oidcPrincipals([emisor()]);
    const token = proveedor.emite({ issuer: 'https://otro-idp.internal' });

    expect(await resolver.resolve({ issuer: 'corp', presented: token })).toEqual({
      ok: false,
      problem: 'credential_invalid',
    });
  });

  it('todavía no válido (`nbf` futuro): `credential_invalid`', async () => {
    const resolver = oidcPrincipals([emisor()]);
    const token = proveedor.emite({ notBeforeSeconds: 3_600 });

    expect(await resolver.resolve({ issuer: 'corp', presented: token })).toEqual({
      ok: false,
      problem: 'credential_invalid',
    });
  });

  it('un token sin sujeto no identifica a nadie', async () => {
    const resolver = oidcPrincipals([emisor()]);
    const token = proveedor.emite({ subject: '' });

    expect(await resolver.resolve({ issuer: 'corp', presented: token })).toEqual({
      ok: false,
      problem: 'credential_invalid',
    });
  });
});

describe('fallo cerrado en el borde exterior', () => {
  it('el proveedor caído deniega; no hay principal anónimo', async () => {
    const resolver = oidcPrincipals([emisor()], { timeoutMs: 500 });
    const token = proveedor.emite();
    await proveedor.close();

    // No es que el token sea malo: es que no hay contra qué validarlo. Deniega
    // igual, que es lo mismo que hace la clave estática cuando su referencia no
    // se puede leer.
    expect(await resolver.resolve({ issuer: 'corp', presented: token })).toEqual({
      ok: false,
      problem: 'credential_invalid',
    });
  });

  it('sin audiencia declarada no se exige, pero el emisor se sigue comprobando', async () => {
    const resolver = oidcPrincipals([emisor({ audience: undefined })]);

    const cualquiera = proveedor.emite({ audience: 'lo-que-sea' });
    expect(await resolver.resolve({ issuer: 'corp', presented: cualquiera })).toMatchObject({ ok: true });

    const ajeno = proveedor.emite({ issuer: 'https://otro-idp.internal' });
    expect(await resolver.resolve({ issuer: 'corp', presented: ajeno })).toEqual({
      ok: false,
      problem: 'credential_invalid',
    });
  });
});
