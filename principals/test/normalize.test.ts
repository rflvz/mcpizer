import { describe, expect, it } from 'vitest';
import { normalize, type IssuerProfile } from '../src/index.js';

const CORP: IssuerProfile = { id: 'corp', declaredAttributes: ['team', 'role'] };

describe('la normalización', () => {
  it('produce una forma única y cualificada por el emisor', () => {
    const resolution = normalize(CORP, { subject: 'ana', attributes: { team: 'ventas' } });
    expect(resolution).toMatchObject({
      ok: true,
      principal: { id: 'corp:ana', issuer: 'corp', subject: 'ana', attributes: { team: 'ventas' } },
    });
  });

  it('descarta lo que el emisor no declara: la política no puede discriminar sobre ello', () => {
    const resolution = normalize(CORP, {
      subject: 'ana',
      attributes: { team: 'ventas', email: 'ana@ejemplo', sub: 'x' },
    });
    expect(resolution).toMatchObject({ ok: true, discarded: ['email', 'sub'] });
    if (resolution.ok) expect(Object.keys(resolution.principal.attributes)).toEqual(['team']);
  });
});

describe('la ausencia de identidad es fallo, no un principal vacío', () => {
  it('un emisor no declarado no produce principal', () => {
    expect(normalize(undefined, { subject: 'ana', attributes: {} })).toMatchObject({
      ok: false,
      problem: 'issuer_unknown',
    });
  });

  it('un sujeto vacío tampoco', () => {
    expect(normalize(CORP, { subject: '   ', attributes: {} })).toMatchObject({
      ok: false,
      problem: 'credential_missing',
    });
  });
});
