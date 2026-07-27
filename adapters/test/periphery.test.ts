/**
 * El compositor: qué implementación atiende a cada emisor, upstream y cuenta.
 *
 * Cada adaptador se prueba por su cuenta, contra un servidor que habla su
 * protocolo. Lo que se prueba aquí es lo otro: que el **despachador** los
 * alcance. Es el sitio donde una implementación nueva se queda sin cablear sin
 * que nada se ponga rojo — el adaptador existe, sus tests pasan, y en ejecución
 * no lo elige nadie.
 *
 * Y es la forma ejecutable de "intercambiables por configuración": lo que decide
 * cuál atiende es la forma del especificador, el `kind` del emisor y el esquema
 * de la referencia, no una bandera ni una rama del código de arranque
 * (decisión 0022).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { periphery, policySourceFor, type PeripheryIssuer } from '../src/index.js';
import {
  startGcp,
  startOauth,
  startPolicyHttp,
  type GcpFixture,
  type OauthFixture,
  type PolicyHttpFixture,
} from '../../verification/lib/fixtures.js';

const cerrables: { close(): Promise<void> }[] = [];

afterEach(async () => {
  await Promise.all(cerrables.splice(0).map((cerrable) => cerrable.close()));
});

function emisor(overrides: Partial<PeripheryIssuer> & { id: string; kind: string }): PeripheryIssuer {
  return {
    subject: undefined,
    secretRef: undefined,
    attributes: {},
    discovery: undefined,
    audience: undefined,
    ...overrides,
  };
}

describe('`PolicySource` se elige por la forma del especificador', () => {
  it('git, HTTP y fichero, sin que ningún comando tenga que enterarse', () => {
    // No se compara el objeto: se comprueba que cada forma produce un origen
    // distinto, que es lo que el despachador tiene que hacer.
    const git = policySourceFor('git+https://git.internal/p.git#refs/heads/main:mcpizer.yaml');
    const http = policySourceFor('https://config.internal/mcpizer.yaml');
    const fichero = policySourceFor('examples/policy.yaml');

    expect(new Set([git, http, fichero]).size).toBe(3);
  });

  it('y un origen HTTP trae el artefacto de verdad', async () => {
    const fixture: PolicyHttpFixture = await startPolicyHttp({ body: 'version: 1\ncapabilities: []\n' });
    cerrables.push(fixture);

    const cargado = await policySourceFor(fixture.url).load();
    expect(cargado.text).toContain('version: 1');
  });
});

describe('`PrincipalResolver` se elige por `issuers[].kind`', () => {
  const issuers = [
    emisor({ id: 'ci', kind: 'static-key', subject: 'build-agent', secretRef: 'env://CLAVE_DE_CI' }),
    emisor({ id: 'corp', kind: 'oidc', discovery: 'https://id.internal/.well-known/openid-configuration' }),
    emisor({ id: 'malla', kind: 'mtls', attributes: { team: 'dn:O' } }),
  ];

  it('los tres emisores sirven para autenticar, y se dice al arrancar', () => {
    const outside = periphery({ issuers, upstreams: [] });
    cerrables.push(outside);
    expect([...outside.usableIssuers].sort()).toEqual(['ci', 'corp', 'malla']);
  });

  it('un emisor `mtls` lo atiende el resolutor de certificado, no otro', async () => {
    const outside = periphery({ issuers, upstreams: [] });
    cerrables.push(outside);

    const resuelto = await outside.principals.resolve({
      issuer: 'malla',
      presented: 'CN=ana,O=ventas',
    });

    // Si lo atendiera el de clave estática, esto sería `credential_invalid`.
    expect(resuelto).toEqual({ ok: true, issuer: 'malla', subject: 'ana', attributes: { team: 'ventas' } });
  });

  it('y un emisor que no declara con qué autenticar no autentica a nadie', () => {
    const outside = periphery({ issuers: [emisor({ id: 'huerfano', kind: 'static-key' })], upstreams: [] });
    cerrables.push(outside);
    expect(outside.usableIssuers).toEqual([]);
  });
});

describe('`CredentialResolver` se elige por el esquema de la referencia', () => {
  it('`gcp-secrets://` lo atiende el gestor cloud', async () => {
    const gcp: GcpFixture = await startGcp({
      secrets: { 'projects/mcpizer/secrets/facturacion/versions/latest': 'del-gestor-cloud' },
    });
    cerrables.push(gcp);

    const outside = periphery({
      issuers: [],
      upstreams: [],
      cloud: { metadataUrl: gcp.metadataUrl, apiBase: gcp.apiBase },
    });
    cerrables.push(outside);

    expect(await outside.credentials.resolve('gcp-secrets://projects/mcpizer/secrets/facturacion')).toEqual({
      value: 'del-gestor-cloud',
    });
  });

  it('`oauth+` acuña un token, y su secreto de cliente sale de otro esquema', async () => {
    // Es la propiedad que sostiene que el artefacto no lleve nada canjeable: la
    // referencia nombra otra referencia, y esa la resuelve el mismo despachador.
    const oauth: OauthFixture = await startOauth({ clients: { agente: 'secreto-del-cliente' } });
    cerrables.push(oauth);

    process.env['SECRETO_DE_CLIENTE_DE_PRUEBA'] = 'secreto-del-cliente';
    const outside = periphery({ issuers: [], upstreams: [] });
    cerrables.push(outside);

    const material = await outside.credentials.resolve(
      `oauth+${oauth.tokenUrl}?client=agente&secret=env://SECRETO_DE_CLIENTE_DE_PRUEBA`,
    );

    expect(material.value).toMatch(/^token-acuñado-/);
    expect(oauth.acuñaciones).toHaveLength(1);
    delete process.env['SECRETO_DE_CLIENTE_DE_PRUEBA'];
  });

  it('un esquema que ningún adaptador resuelve es un error, no un valor vacío', async () => {
    const outside = periphery({ issuers: [], upstreams: [] });
    cerrables.push(outside);
    await expect(outside.credentials.resolve('s3://algo')).rejects.toThrow(/ningún adaptador resuelve/);
  });

  it('y `vault://` sin bóveda configurada dice qué falta en vez de degradar', async () => {
    const outside = periphery({ issuers: [], upstreams: [] });
    cerrables.push(outside);
    await expect(outside.credentials.resolve('vault://kv/algo')).rejects.toThrow(/VAULT_ADDR/);
  });
});

describe('`DecisionRecorder` se elige al arrancar', () => {
  it('los tres destinos se alcanzan, y el compositor cierra el que lo necesita', async () => {
    // El de fichero abre un descriptor; los otros dos no abren nada. Que el
    // compositor recoja el ciclo de vida sin que el puerto lo declare es lo que
    // fijó la decisión 0023, y aquí se comprueba con la tercera implementación.
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const path = join(mkdtempSync(join(tmpdir(), 'mcpizer-periferia-')), 'auditoria.jsonl');

    const outside = periphery({ issuers: [], upstreams: [], recorder: { kind: 'file', path } });
    outside.recorder.record({
      at: Date.parse('2026-01-01T03:00:00Z'),
      principal: 'ci:build-agent',
      issuer: 'ci',
      capability: 'billing.invoice.issue',
      tool: 'facturacion__create_invoice',
      outcome: 'allow',
      code: 'granted',
      path: '/grants/0',
      account: 'facturacion-ops',
    });
    await outside.close();

    const { readFileSync } = await import('node:fs');
    expect(readFileSync(path, 'utf8')).toContain('"code":"granted"');
  });
});
