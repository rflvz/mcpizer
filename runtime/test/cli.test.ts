/**
 * La CLI ejecutada como la ejecuta quien la usa: un proceso, argumentos y un
 * código de salida.
 *
 * Requiere `pnpm build` previo, que es lo que hace `pnpm verify` antes de
 * llegar aquí.
 */
import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const REPO = fileURLToPath(new URL('../..', import.meta.url));
const CLI = join(REPO, 'runtime', 'dist', 'cli', 'main.js');
const POLICY = join(REPO, 'examples', 'policy.yaml');
const CATALOG = join(REPO, 'examples', 'catalog.yaml');

async function mcpizer(...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [CLI, ...args], { cwd: REPO });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}

describe('validate', () => {
  it('sobre el ejemplo sale con 0 y solo señala la tool sin mapeo', async () => {
    const run = await mcpizer('validate', POLICY, '--catalog', CATALOG);
    expect(run.code).toBe(0);
    expect(run.stdout).toContain('catalog_tool_unmapped');
    expect(run.stdout).toContain('examples/policy.yaml:');
  });

  it('sale con 1 y señala el sitio cuando hay una referencia colgante', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'mcpizer-'));
    const broken = join(directory, 'rota.yaml');
    writeFileSync(
      broken,
      `version: 1
capabilities: [{ id: cap.one }]
accounts: [{ id: buena, secret: { ref: "env://X" } }]
principals: { issuers: [{ id: ci, kind: static-key }] }
grants:
  - to: { issuer: ci }
    capabilities: [cap.one]
    using: no-existe
`,
    );
    const run = await mcpizer('validate', broken);
    expect(run.code).toBe(1);
    expect(run.stdout).toContain('unknown_account_in_grant');
    expect(run.stdout).toMatch(/rota\.yaml:\d+:\d+/);
  });

  it('emite JSON cuando se le pide', async () => {
    const run = await mcpizer('validate', POLICY, '--catalog', CATALOG, '--json');
    const report = JSON.parse(run.stdout) as { diagnostics: { code: string }[] };
    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['catalog_tool_unmapped']);
  });
});

describe('explain', () => {
  it('permite y nombra la cuenta', async () => {
    const run = await mcpizer(
      'explain', POLICY, '--catalog', CATALOG,
      '--issuer', 'corp', '--subject', 'ana', '--attr', 'team=ventas',
      '--capability', 'crm.contact.read', '--at', '2026-01-01T03:00:00Z',
    );
    expect(run.code).toBe(0);
    expect(run.stdout).toContain('PERMITIDO');
    expect(run.stdout).toContain('crm-solo-lectura');
  });

  it('deniega y señala el sitio a tocar', async () => {
    const run = await mcpizer(
      'explain', POLICY, '--catalog', CATALOG,
      '--issuer', 'corp', '--subject', 'ana', '--attr', 'team=ventas',
      '--capability', 'billing.invoice.issue',
    );
    expect(run.stdout).toContain('DENEGADO');
    expect(run.stdout).toMatch(/examples\/policy\.yaml:\d+:\d+/);
  });

  it('avisa de los atributos que descarta por no estar declarados', async () => {
    const run = await mcpizer(
      'explain', POLICY, '--catalog', CATALOG,
      '--issuer', 'corp', '--subject', 'ana', '--attr', 'team=ventas', '--attr', 'email=ana@ejemplo',
      '--capability', 'crm.contact.read',
    );
    expect(run.stdout).toContain('descartados');
    expect(run.stdout).toContain('email');
  });

  it('falta un argumento obligatorio y sale con 2', async () => {
    const run = await mcpizer('explain', POLICY, '--issuer', 'corp');
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('--subject');
  });
});

describe('who-can', () => {
  it('contesta la pregunta de auditoría', async () => {
    const run = await mcpizer('who-can', POLICY, '--catalog', CATALOG, '--capability', 'billing.invoice.issue');
    expect(run.code).toBe(0);
    expect(run.stdout).toContain('facturacion-ops');
    expect(run.stdout).toContain('create_invoice');
  });
});

describe('diff', () => {
  it('no ve cambios entre una versión y ella misma', async () => {
    const run = await mcpizer('diff', POLICY, POLICY, '--catalog', CATALOG);
    expect(run.code).toBe(0);
    expect(run.stdout).toContain('Ninguna decisión cambia');
  });
});

describe('la superficie de la propia herramienta', () => {
  it('emite el JSON Schema del artefacto', async () => {
    const run = await mcpizer('schema');
    const schema = JSON.parse(run.stdout) as { $id: string };
    expect(schema.$id).toContain('mcpizer');
  });

  it('sin comando explica cómo se usa, y sale con 2', async () => {
    const run = await mcpizer();
    expect(run.code).toBe(2);
    expect(run.stdout).toContain('verificación en seco');
  });

  it('un origen inalcanzable sale con 3, no con una traza', async () => {
    const run = await mcpizer('validate', join(REPO, 'no', 'existe.yaml'));
    expect(run.code).toBe(3);
    expect(run.stderr).toContain('No se pudo leer el artefacto');
  });
});
