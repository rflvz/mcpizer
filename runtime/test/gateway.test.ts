/**
 * El criterio mecánico de terminación de S2 (`docs/sesiones.md` §5).
 *
 * > Un cliente MCP real se conecta y ve solo lo concedido; invocar una tool no
 * > listada deniega con motivo.
 *
 * "Real" es la palabra vinculante: el cliente es el del SDK oficial, hablando el
 * protocolo por stdio contra `mcpizer serve` lanzado como proceso aparte. Un
 * test que llamara a `gateway()` en memoria comprobaría la orquestación y no la
 * pasarela, y lo que S2 promete es la pasarela.
 *
 * Exige haber construido antes: se ejecuta `runtime/dist/cli/main.js`. `pnpm
 * verify` construye primero (decisión 0009).
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const CLI = `${REPO}runtime/dist/cli/main.js`;
const UPSTREAM = `${REPO}verification/fixtures/upstream/server.js`;
const CLAVE = 'clave-de-pruebas-no-secreta';

const abiertos: Client[] = [];

afterEach(async () => {
  await Promise.all(abiertos.splice(0).map((client) => client.close().catch(() => undefined)));
});

/**
 * Un cliente MCP conectado a la pasarela. El transporte arranca el proceso, que
 * es exactamente lo que hace un cliente MCP de verdad con un servidor stdio.
 */
async function conectar(args: readonly string[], env: Record<string, string>): Promise<Client> {
  const client = new Client({ name: 'cliente-de-pruebas', version: '0.0.0' });
  abiertos.push(client);
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [CLI, ...args],
      env: { PATH: process.env['PATH'] ?? '', ...env },
      stderr: 'ignore',
    }),
  );
  return client;
}

function conElEjemplo(env: Record<string, string> = { MCPIZER_API_KEY: CLAVE }): Promise<Client> {
  return conectar(
    [
      'serve',
      `${REPO}examples/policy.yaml`,
      '--catalog',
      `${REPO}examples/catalog.yaml`,
      '--issuer',
      'ci',
    ],
    { MCPIZER_CI_KEY: CLAVE, ...env },
  );
}

describe('un cliente MCP real contra el ejemplo del documento de diseño', () => {
  it('ve solo lo concedido, y lo demás no sale marcado como prohibido: no sale', async () => {
    const client = await conElEjemplo();
    const { tools } = await client.listTools();

    // `ci` tiene una sola concesión: `billing.invoice.issue`.
    expect(tools.map((tool) => tool.name)).toEqual(['facturacion__create_invoice']);
  });

  it('no anuncia las tools de otra concesión, ni las que ningún mapeo cubre', async () => {
    const client = await conElEjemplo();
    const nombres = (await client.listTools()).tools.map((tool) => tool.name);

    // De `corp`, no de `ci`.
    expect(nombres).not.toContain('crm-principal__get_contact');
    expect(nombres).not.toContain('crm-principal__upsert_contact');
    // Existe en el catálogo y ningún mapeo la cubre: no declararla ya es denegarla.
    expect(nombres).not.toContain('crm-principal__delete_contact');
  });

  it('conserva el esquema de entrada que el catálogo declara', async () => {
    const client = await conElEjemplo();
    const [tool] = (await client.listTools()).tools;
    expect(tool?.inputSchema).toMatchObject({ required: ['customerId', 'lines'] });
  });

  it('invocar una tool no listada deniega con motivo y con el sitio a tocar', async () => {
    const client = await conElEjemplo();
    const result = await client.callTool({ name: 'crm-principal__get_contact', arguments: { id: '1' } });

    expect(result.isError).toBe(true);
    const texto = JSON.stringify(result.content);
    expect(texto).toContain('no_grant_matches');
    // El bucle de corrección del invariante 4: no solo que no, sino dónde tocar.
    expect(texto).toMatch(/policy\.yaml:\d+:\d+/);
    expect(texto).toContain('/grants');
  });

  it('un nombre que no existe deniega sin inventar un motivo del vocabulario cerrado', async () => {
    const client = await conElEjemplo();
    const result = await client.callTool({ name: 'no__existe', arguments: {} });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('no es ninguna tool declarada');
  });

  it('sin la clave correcta no se anuncia nada: la ausencia de identidad es fallo', async () => {
    const client = await conElEjemplo({ MCPIZER_API_KEY: 'una-clave-que-no-es' });
    expect((await client.listTools()).tools).toEqual([]);
  });
});

/**
 * El ejemplo alcanza hasta el listado y la denegación, porque sus upstreams no
 * existen. Para recorrer el camino entero hace falta un upstream de verdad al
 * otro lado, y eso es lo que monta este artefacto.
 */
function artefactoConUpstreamReal(): { policy: string; catalog: string } {
  const dir = mkdtempSync(join(tmpdir(), 'mcpizer-'));
  const policy = join(dir, 'policy.yaml');
  const catalog = join(dir, 'catalog.yaml');

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
      calls: 2
      per: 1h
`,
  );

  writeFileSync(
    catalog,
    `version: 1
tools:
  - upstream: facturacion
    name: create_invoice
    description: Emite una factura contra un cliente
    inputSchema:
      type: object
      properties:
        customerId: { type: string }
      required: [customerId]
`,
  );

  return { policy, catalog };
}

function conUpstreamReal(env: Record<string, string> = {}): Promise<Client> {
  const { policy, catalog } = artefactoConUpstreamReal();
  return conectar(['serve', policy, '--catalog', catalog, '--issuer', 'ci'], {
    MCPIZER_CI_KEY: CLAVE,
    MCPIZER_API_KEY: CLAVE,
    BILLING_OPS_KEY: 'credencial-de-la-cuenta-de-facturacion',
    ...env,
  });
}

describe('el camino completo: reúne, decide y ejecuta', () => {
  it('una tool concedida llega al upstream y vuelve con su resultado', async () => {
    const client = await conUpstreamReal();
    const result = await client.callTool({
      name: 'facturacion__create_invoice',
      arguments: { customerId: 'acme' },
    });

    expect(result.isError).toBeFalsy();
    const contenido = result.content as { type: string; text: string }[];
    const eco = JSON.parse(contenido[0]?.text ?? '{}') as {
      tool: string;
      arguments: Record<string, unknown>;
      credentialRecibida: boolean;
    };
    expect(eco.tool).toBe('create_invoice');
    expect(eco.arguments).toEqual({ customerId: 'acme' });
    // La credencial de la cuenta llegó al upstream, que es su único destino.
    expect(eco.credentialRecibida).toBe(true);
  });

  it('el techo se agota de verdad: los contadores se escriben tras ejecutar', async () => {
    const client = await conUpstreamReal();
    const invocar = () => client.callTool({ name: 'facturacion__create_invoice', arguments: { customerId: 'acme' } });

    expect((await invocar()).isError).toBeFalsy();
    expect((await invocar()).isError).toBeFalsy();

    // `calls: 2, per: 1h`. La tercera no cabe.
    const tercera = await invocar();
    expect(tercera.isError).toBe(true);
    expect(JSON.stringify(tercera.content)).toContain('limit_exhausted');
  });

  it('una cuenta cuya credencial no resuelve aborta, y no ejecuta sin credencial', async () => {
    const client = await conUpstreamReal({ BILLING_OPS_KEY: '' });
    const result = await client.callTool({
      name: 'facturacion__create_invoice',
      arguments: { customerId: 'acme' },
    });

    expect(result.isError).toBe(true);
    const texto = JSON.stringify(result.content);
    expect(texto).toContain('no se pudo resolver');
    // Y se distingue de una denegación de política, que es lo que exige §2.6.
    expect(texto).not.toContain('no_grant_matches');
  });
});
