/**
 * La tercera mitad del criterio de terminación de S2 (`docs/sesiones.md` §5).
 *
 * > Un test confirma que ningún material de credencial aparece en registros ni
 * > en motivos.
 *
 * Es el invariante 6 en su forma observable. El modelo ya impide que el material
 * cruce hacia el núcleo —`AccountView` solo lleva el asa, y `DecisionRecord` no
 * tiene ningún campo donde algo canjeable quepa—, pero eso protege la frontera,
 * no la salida. Lo que aquí se comprueba es lo que un operador ve de verdad:
 * lo que se escribe al registro, y lo que se le devuelve al cliente.
 *
 * Y lleva su caso de fallo, porque una comprobación que nunca ha fallado no está
 * verificada (`docs/sesiones.md` §2). El caso usa la **misma** pasarela y los
 * mismos adaptadores, cambiando solo el invocador: si demostrara la fuga con un
 * andamiaje propio, no demostraría nada sobre este escáner.
 */
import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { REPO_ROOT } from '../lib/run-checks.js';

const execFileAsync = promisify(execFile);

const CLI = join(REPO_ROOT, 'runtime', 'dist', 'cli', 'main.js');
const FUGA = join(REPO_ROOT, 'verification', 'fixtures', 'violations', 'credential-in-log', 'invoker.js');
const UPSTREAM = join(REPO_ROOT, 'verification', 'fixtures', 'upstream', 'server.js');

/**
 * Los centinelas.
 *
 * Son valores irrepetibles a propósito: buscar una cadena que pudiera aparecer
 * por casualidad convertiría el escáner en una fuente de falsos positivos, y
 * buscar una demasiado corta, en una de falsos negativos.
 */
const CLAVE_DE_EMISOR = 'centinela-clave-de-emisor-7f3a91c4';
const CREDENCIAL_DE_CUENTA = 'centinela-credencial-de-cuenta-2b8e05d6';

/**
 * El escáner. Es lo único que la comprobación y su caso de fallo comparten, y
 * por eso es lo único que tiene que estar bien.
 */
function fugas(texto: string): string[] {
  return [CLAVE_DE_EMISOR, CREDENCIAL_DE_CUENTA].filter((centinela) => texto.includes(centinela));
}

function artefacto(): { policy: string; catalog: string } {
  const dir = mkdtempSync(join(tmpdir(), 'mcpizer-fuga-'));
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
      calls: 10
      per: 1h
`,
  );

  writeFileSync(
    catalog,
    `version: 1
tools:
  - upstream: facturacion
    name: create_invoice
    inputSchema:
      type: object
      properties:
        customerId: { type: string }
`,
  );

  return { policy, catalog };
}

const ENTORNO: Record<string, string> = {
  MCPIZER_CI_KEY: CLAVE_DE_EMISOR,
  MCPIZER_API_KEY: CLAVE_DE_EMISOR,
  BILLING_OPS_KEY: CREDENCIAL_DE_CUENTA,
};

/**
 * Recorre la pasarela entera —permiso, denegación y nombre inexistente— y
 * devuelve todo lo observable: lo que se escribió al registro y lo que el
 * cliente recibió.
 */
async function todoLoObservable(): Promise<string> {
  const { policy, catalog } = artefacto();
  const client = new Client({ name: 'escaner', version: '0.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [CLI, 'serve', policy, '--catalog', catalog, '--issuer', 'ci'],
    env: { PATH: process.env['PATH'] ?? '', ...ENTORNO },
    // Capturado, no descartado: el registro de decisiones va por aquí, y es la
    // mitad de lo que hay que revisar.
    stderr: 'pipe',
  });

  let registro = '';
  await client.connect(transport);
  transport.stderr?.on('data', (chunk: Buffer) => {
    registro += chunk.toString('utf8');
  });

  const respuestas: unknown[] = [];
  respuestas.push(await client.listTools());
  respuestas.push(await client.callTool({ name: 'facturacion__create_invoice', arguments: { customerId: 'acme' } }));
  respuestas.push(await client.callTool({ name: 'facturacion__no_existe', arguments: {} }));

  // Y el caso que más tienta a filtrar: el fallo, donde alguien pondría el valor
  // "para depurar".
  const rota = new Client({ name: 'escaner', version: '0.0.0' });
  const transporteRoto = new StdioClientTransport({
    command: process.execPath,
    args: [CLI, 'serve', policy, '--catalog', catalog, '--issuer', 'ci'],
    env: { PATH: process.env['PATH'] ?? '', ...ENTORNO, BILLING_OPS_KEY: '' },
    stderr: 'pipe',
  });
  await rota.connect(transporteRoto);
  transporteRoto.stderr?.on('data', (chunk: Buffer) => {
    registro += chunk.toString('utf8');
  });
  respuestas.push(await rota.callTool({ name: 'facturacion__create_invoice', arguments: { customerId: 'acme' } }));

  await new Promise((resolve) => setTimeout(resolve, 200));
  await client.close();
  await rota.close();

  return `${registro}\n${JSON.stringify(respuestas)}`;
}

describe('ningún material de credencial sale de la pasarela', () => {
  it('ni al registro de decisiones, ni en las respuestas, ni en los motivos', async () => {
    const observable = await todoLoObservable();

    // Que el recorrido haya ocurrido de verdad: un escáner sobre una cadena
    // vacía no encuentra nada y pasaría igual.
    expect(observable).toContain('build-agent');
    expect(observable).toContain('facturacion-ops');
    expect(observable).toContain('granted');

    expect(fugas(observable)).toEqual([]);
  });

  it('la referencia al secreto sí puede aparecer: es un asa, no algo canjeable', async () => {
    const observable = await todoLoObservable();
    // La distinción que sostiene todo el diseño. `env://BILLING_OPS_KEY` no
    // abre nada; su contenido sí.
    expect(observable).not.toContain(CREDENCIAL_DE_CUENTA);
  });
});

describe('el escáner de fugas tiene un caso que lo hace fallar', () => {
  it('un invocador que traza la credencial queda al descubierto', async () => {
    const { policy, catalog } = artefacto();
    const { stderr } = await execFileAsync(
      process.execPath,
      [FUGA, policy, catalog, 'ci', 'facturacion__create_invoice'],
      { cwd: REPO_ROOT, env: { ...process.env, ...ENTORNO } },
    );

    // El mismo escáner, sobre una pasarela con un solo adaptador descuidado.
    expect(fugas(stderr)).toEqual([CREDENCIAL_DE_CUENTA]);
  });
});
