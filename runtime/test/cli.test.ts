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

describe('catalog', () => {
  const UPSTREAM = join(REPO, 'verification', 'fixtures', 'upstream', 'server.js');

  function conUpstreamReal(): string {
    const directory = mkdtempSync(join(tmpdir(), 'mcpizer-catalogo-'));
    const policy = join(directory, 'policy.yaml');
    writeFileSync(
      policy,
      `version: 1
capabilities:
  - id: billing.invoice.issue
upstreams:
  - id: facturacion
    transport:
      kind: mcp-stdio
      command: ${process.execPath}
      args: ["${UPSTREAM}"]
    tools:
      - name: create_invoice
        capability: billing.invoice.issue
accounts:
  - id: facturacion-ops
    secret: { ref: "env://BILLING_OPS_KEY" }
principals:
  issuers:
    - id: ci
      kind: static-key
      subject: build-agent
      secret: { ref: "env://MCPIZER_CI_KEY" }
      attributes:
        role: automation
grants:
  - to:
      issuer: ci
      attributes: { role: automation }
    capabilities: [billing.invoice.issue]
    using: facturacion-ops
    limits:
      calls: 5
      per: 1h
`,
    );
    return policy;
  }

  it('genera el catálogo preguntándole al upstream, con su esquema de entrada', async () => {
    const run = await mcpizer('catalog', conUpstreamReal());

    expect(run.code).toBe(0);
    expect(run.stdout).toContain('upstream: facturacion');
    expect(run.stdout).toContain('name: create_invoice');
    // Lo que el upstream declara viaja tal cual: reescribirlo aquí sería
    // inventarse un contrato que nadie ha declarado.
    expect(run.stdout).toContain('customerId');
    // Y también la que ningún mapeo cubre: el catálogo describe lo que hay, no
    // lo que la política concede.
    expect(run.stdout).toContain('name: delete_invoice');
  });

  it('y lo generado sirve para verificar en seco, que es para lo que existe', async () => {
    // El ida y vuelta completo: se genera con red una vez, se versiona, y a
    // partir de ahí `validate` vuelve a funcionar sin ella (invariante 8).
    const policy = conUpstreamReal();
    const generado = await mcpizer('catalog', policy);

    const catalogo = join(mkdtempSync(join(tmpdir(), 'mcpizer-catalogo-')), 'catalog.yaml');
    writeFileSync(catalogo, generado.stdout);

    const validado = await mcpizer('validate', policy, '--catalog', catalogo);
    expect(validado.code).toBe(0);
    // Una sola advertencia, y es la tool que existe y nadie mapea.
    expect(validado.stdout).toContain('catalog_tool_unmapped');
    expect(validado.stdout).toContain('delete_invoice');
  });

  it('un upstream que no responde aborta: un catálogo incompleto es una revocación silenciosa', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'mcpizer-catalogo-'));
    const policy = join(directory, 'policy.yaml');
    writeFileSync(
      policy,
      `version: 1
capabilities:
  - id: billing.invoice.issue
upstreams:
  - id: facturacion
    transport:
      kind: mcp-stdio
      command: este-binario-no-existe-en-ningun-sitio
    tools:
      - name: create_invoice
        capability: billing.invoice.issue
accounts: []
principals:
  issuers: []
grants: []
`,
    );

    const run = await mcpizer('catalog', policy);
    expect(run.code).toBe(3);
    expect(run.stdout).toBe('');
  });
});

describe('version', () => {
  it('dice qué build está corriendo, y sobre qué Node', async () => {
    const run = await mcpizer('version');
    expect(run.code).toBe(0);
    expect(run.stdout).toMatch(/^mcpizer \d+\.\d+\.\d+/);
    expect(run.stdout).toContain(process.version);
  });

  it('y en JSON cuando se le pide', async () => {
    const run = await mcpizer('version', '--json');
    expect(JSON.parse(run.stdout)).toMatchObject({ node: process.version });
  });
});
