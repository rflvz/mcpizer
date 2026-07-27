/**
 * El criterio mecánico de terminación de S1 (`docs/sesiones.md` §5).
 *
 * > `explain`, sobre el ejemplo de `diseno/artefacto.md` §2, devuelve un motivo
 * > cuyo `path` resuelve a una posición real del documento.
 *
 * Un `path` que no resuelve satisface el tipo y no sirve para nada: el bucle de
 * corrección del invariante 4 depende de que el sitio señalado exista.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { declaredCatalogFile, policyFile } from '@mcpizer/adapters';
import { explain, loadPolicy, type LoadedPolicy } from '../src/index.js';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const POLICY = `${REPO}examples/policy.yaml`;
const CATALOG = `${REPO}examples/catalog.yaml`;
const AT = Date.parse('2026-01-01T03:00:00Z');

async function loaded(): Promise<LoadedPolicy> {
  return loadPolicy(policyFile(POLICY), declaredCatalogFile(CATALOG));
}

describe('el ejemplo del documento de diseño', () => {
  it('es literalmente el que vive en el repositorio', () => {
    const doc = readFileSync(`${REPO}docs/diseno/artefacto.md`, 'utf8');
    const block = /^```yaml\n([\s\S]*?)^```/m.exec(doc);
    expect(block).not.toBeNull();
    expect(readFileSync(POLICY, 'utf8')).toBe(block?.[1]);
  });

  it('compila, y lo único que señala es la tool que nadie mapea', () => {
    return loaded().then((policy) => {
      expect(policy.policy).toBeDefined();
      expect(policy.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['catalog_tool_unmapped']);
    });
  });
});

describe('`explain` sobre el ejemplo', () => {
  it('permite a ventas leer contactos, y señala la concesión que lo justifica', async () => {
    const policy = await loaded();
    const explanation = explain(policy, {
      issuer: 'corp',
      subject: 'ana',
      attributes: { team: 'ventas' },
      capability: 'crm.contact.read',
      at: AT,
      usage: { kind: 'counted', calls: 0, windowStart: AT },
    });

    expect(explanation.decision).toMatchObject({
      outcome: 'allow',
      reason: { code: 'granted' },
      account: { id: 'crm-solo-lectura' },
      limits: { calls: 500, per: '1h' },
    });
    expect(explanation.tools.map((tool) => tool.name)).toEqual(['get_contact', 'search_contacts']);
  });

  it('deniega facturar a ventas, y el motivo señala una posición real del documento', async () => {
    const policy = await loaded();
    const explanation = explain(policy, {
      issuer: 'corp',
      subject: 'ana',
      attributes: { team: 'ventas' },
      capability: 'billing.invoice.issue',
      at: AT,
      usage: { kind: 'counted', calls: 0, windowStart: AT },
    });

    expect(explanation.decision?.outcome).toBe('deny');
    expect(explanation.decision?.reason.code).toBe('no_grant_matches');
    expect(explanation.tools).toEqual([]);
  });

  it.each([
    { capability: 'crm.contact.read', attributes: { team: 'ventas' }, esperado: 'allow' },
    { capability: 'crm.contact.write', attributes: { team: 'ventas' }, esperado: 'deny' },
    { capability: 'crm.contact.write', attributes: { team: 'ventas', role: 'manager' }, esperado: 'allow' },
    { capability: 'billing.invoice.issue', attributes: { team: 'ventas' }, esperado: 'deny' },
  ])('el `path` de $capability resuelve a una posición real ($esperado)', async ({ capability, attributes }) => {
    const policy = await loaded();
    const text = readFileSync(POLICY, 'utf8');
    const lines = text.split('\n');

    const explanation = explain(policy, {
      issuer: 'corp',
      subject: 'ana',
      attributes,
      capability,
      at: AT,
      usage: { kind: 'counted', calls: 0, windowStart: AT },
    });

    // La propiedad, en sus dos lecturas: el puntero navega el documento, y este
    // sabe llevarlo hasta una línea y una columna que existen de verdad.
    expect(explanation.decision?.reason.path).not.toBe('');
    expect(explanation.position).toBeDefined();
    const position = explanation.position;
    if (position === undefined) return;
    expect(position.line).toBeGreaterThan(0);
    expect(position.line).toBeLessThanOrEqual(lines.length);
    expect(position.offset).toBeLessThan(text.length);
    expect(lines[position.line - 1]?.trim()).not.toBe('');
  });

  it('un techo agotado deniega, y señala la concesión cuyo techo se agotó', async () => {
    const policy = await loaded();
    const explanation = explain(policy, {
      issuer: 'corp',
      subject: 'ana',
      attributes: { team: 'ventas' },
      capability: 'crm.contact.read',
      at: AT,
      usage: { kind: 'counted', calls: 500, windowStart: AT },
    });
    expect(explanation.decision?.reason.code).toBe('limit_exhausted');
    expect(explanation.decision?.reason.path).toBe('/grants/0');
    expect(explanation.position?.line).toBeGreaterThan(0);
  });

  it('el instante es un parámetro: la misma pregunta en la ventana siguiente vuelve a permitir', async () => {
    const policy = await loaded();
    const explanation = explain(policy, {
      issuer: 'corp',
      subject: 'ana',
      attributes: { team: 'ventas' },
      capability: 'crm.contact.read',
      at: AT + 3_600_001,
      usage: { kind: 'counted', calls: 500, windowStart: AT },
    });
    expect(explanation.decision?.outcome).toBe('allow');
  });

  it('el agente de CI factura con la cuenta de facturación, sin ser la empresa', async () => {
    const policy = await loaded();
    const explanation = explain(policy, {
      issuer: 'ci',
      subject: 'build-agent',
      attributes: {},
      capability: 'billing.invoice.issue',
      at: AT,
      usage: { kind: 'counted', calls: 0, windowStart: AT },
    });
    expect(explanation.decision).toMatchObject({ outcome: 'allow', account: { id: 'facturacion-ops' } });
    if (explanation.resolution.ok) expect(explanation.resolution.principal.id).toBe('ci:build-agent');
  });
});
