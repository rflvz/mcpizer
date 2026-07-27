/**
 * La composición: traducir entre los cinco vocabularios y orquestar el flujo.
 *
 * Aquí vive la frontera del invariante 6, y por eso se comprueba aquí: la
 * referencia al secreto se queda en `accounts` y no aparece en nada de lo que
 * recibe `access`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { declaredCatalogFile, policyFile } from '@mcpizer/adapters';
import { compile } from '@mcpizer/policy';
import { effectiveDiff, loadPolicy, seenBy, whoCan, wire, type LoadedPolicy } from '../src/index.js';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const POLICY = `${REPO}examples/policy.yaml`;
const CATALOG = `${REPO}examples/catalog.yaml`;
const AT = Date.parse('2026-01-01T03:00:00Z');

function loaded(): Promise<LoadedPolicy> {
  return loadPolicy(policyFile(POLICY), declaredCatalogFile(CATALOG));
}

describe('la frontera del invariante 6', () => {
  it('ninguna referencia a secreto cruza hacia el modelo que evalúa `access`', () => {
    const result = compile(readFileSync(POLICY, 'utf8'));
    expect(result.policy).toBeDefined();
    if (result.policy === undefined) return;

    const wiring = wire(result.policy);
    const crossed = JSON.stringify(wiring.ruleset);
    for (const account of result.policy.accounts) {
      expect(account.secretRef).not.toBe('');
      expect(crossed).not.toContain(account.secretRef);
    }
    // El asa sí cruza: es lo único que `access` necesita para decidir.
    expect(crossed).toContain('crm-solo-lectura');
  });

  it('una cuenta que no resuelve llega a `access` como inutilizable, no como ausente', () => {
    const result = compile(
      `version: 1
capabilities: [{ id: cap.one }]
accounts: []
principals: { issuers: [{ id: ci, kind: static-key }] }
grants: []
`,
    );
    expect(result.policy).toBeDefined();
    if (result.policy === undefined) return;
    const wiring = wire({ ...result.policy, grants: [{ ...FAKE_GRANT }] });
    expect(wiring.ruleset.grants[0]?.account).toEqual({ id: 'fantasma', disabled: true });
  });
});

const FAKE_GRANT = {
  issuer: 'ci',
  attributes: {},
  capabilities: ['cap.one'],
  account: 'fantasma',
  limits: undefined,
  path: '/grants/0',
};

describe('la consulta inversa sobre el ejemplo', () => {
  it('responde quién puede emitir facturas, y con qué cuenta', async () => {
    const report = whoCan(await loaded(), 'billing.invoice.issue');
    expect(report?.reachability.through).toHaveLength(1);
    expect(report?.reachability.through[0]).toMatchObject({
      issuer: 'ci',
      account: { id: 'facturacion-ops' },
      limits: { calls: 20, per: '24h' },
      path: '/grants/2',
    });
    expect(report?.positions['/grants/2']?.line).toBeGreaterThan(0);
    expect(report?.tools.map((tool) => tool.name)).toEqual(['create_invoice']);
  });

  it('distingue una capacidad que nadie alcanza de una que no existe', async () => {
    const policy = await loaded();
    expect(whoCan(policy, 'no.declarada')?.reachability.declared).toBe(false);
  });
});

describe('lo que ve cada principal', () => {
  it('ventas ve las dos tools de lectura y ninguna más', async () => {
    const policy = await loaded();
    const tools = seenBy(policy, { id: 'corp:ana', issuer: 'corp', attributes: { team: 'ventas' } }, AT);
    expect(tools.map((tool) => tool.name)).toEqual(['get_contact', 'search_contacts']);
  });

  it('un manager de ventas ve además la de escritura, y nunca `delete_contact`', async () => {
    const policy = await loaded();
    const tools = seenBy(
      policy,
      { id: 'corp:eva', issuer: 'corp', attributes: { team: 'ventas', role: 'manager' } },
      AT,
    );
    expect(tools.map((tool) => tool.name)).toEqual(['get_contact', 'search_contacts', 'upsert_contact']);
  });

  it('un principal sin concesiones no ve nada', async () => {
    const policy = await loaded();
    expect(seenBy(policy, { id: 'corp:nadie', issuer: 'corp', attributes: {} }, AT)).toEqual([]);
  });
});

describe('la diferencia efectiva', () => {
  async function loadedFrom(text: string): Promise<LoadedPolicy> {
    return loadPolicy({ load: async () => ({ text, version: 'x', origin: 'memoria' }) });
  }

  it('no ve cambios entre una versión y ella misma', async () => {
    const text = readFileSync(POLICY, 'utf8');
    const policy = await loadedFrom(text);
    expect(effectiveDiff(policy, policy, AT)).toEqual([]);
  });

  it('detecta que estrechar un selector le corta el acceso a un equipo entero', async () => {
    const text = readFileSync(POLICY, 'utf8');
    const before = await loadedFrom(text);
    const after = await loadedFrom(
      text.replace('attributes: { team: ventas }\n    capabilities: [crm.contact.read]', 'attributes: { team: ventas, role: manager }\n    capabilities: [crm.contact.read]'),
    );
    const changes = effectiveDiff(before, after, AT);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      issuer: 'corp',
      attributes: { team: 'ventas' },
      capability: 'crm.contact.read',
      before: { outcome: 'allow', account: 'crm-solo-lectura' },
      after: { outcome: 'deny', code: 'no_grant_matches' },
    });
  });

  it('detecta que deshabilitar una cuenta corta lo que dependía de ella', async () => {
    const text = readFileSync(POLICY, 'utf8');
    const before = await loadedFrom(text);
    const after = await loadedFrom(
      text.replace('  - id: facturacion-ops\n', '  - id: facturacion-ops\n    disabled: true\n'),
    );
    const changes = effectiveDiff(before, after, AT);
    expect(changes.map((change) => change.capability)).toEqual(['billing.invoice.issue']);
    expect(changes[0]?.after?.code).toBe('account_disabled');
  });

  it('un cambio que no altera ninguna decisión no aparece', async () => {
    const text = readFileSync(POLICY, 'utf8');
    const before = await loadedFrom(text);
    const after = await loadedFrom(text.replace('description: Consultar fichas de contacto', 'description: Otra cosa'));
    expect(effectiveDiff(before, after, AT)).toEqual([]);
  });
});
