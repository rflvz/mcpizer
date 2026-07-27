/**
 * El invariante 6 en su forma observable, sobre **las dos periferias**.
 *
 * S2 lo comprobó sobre la suya (`docs/sesiones.md` §5):
 *
 * > Un test confirma que ningún material de credencial aparece en registros ni
 * > en motivos.
 *
 * S3 trae seis adaptadores nuevos, y son justo los que más material ven: un
 * token OIDC, un token de bóveda, una cabecera `Authorization` y un colector
 * remoto al que se le envían decisiones. Así que el escáner se parametriza por
 * periferia en vez de duplicarse: **el mismo escáner, sobre los mismos
 * adaptadores que se usan de verdad**.
 *
 * El modelo ya impide que el material cruce hacia el núcleo —`AccountView` solo
 * lleva el asa, y `DecisionRecord` no tiene ningún campo donde algo canjeable
 * quepa—, pero eso protege la frontera, no la salida. Lo que aquí se comprueba
 * es lo que un operador ve de verdad: lo que se escribe al registro, lo que se
 * le devuelve al cliente y, ahora, lo que sale por la red hacia la auditoría.
 *
 * Y lleva sus casos de fallo, porque una comprobación que nunca ha fallado no
 * está verificada (`docs/sesiones.md` §2). Los dos usan la pasarela real con los
 * adaptadores reales, cambiando solo el invocador: si demostraran la fuga con un
 * andamiaje propio, no demostrarían nada sobre este escáner.
 */
import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../lib/run-checks.js';
import { CENTINELAS, periferiaA, periferiaB, type Periferia, type Recorrido } from '../lib/peripheries.js';

const execFileAsync = promisify(execFile);

const CLI = join(REPO_ROOT, 'runtime', 'dist', 'cli', 'main.js');
const FUGA_STDIO = join(REPO_ROOT, 'verification', 'fixtures', 'violations', 'credential-in-log', 'invoker.js');
const FUGA_CABECERA = join(
  REPO_ROOT,
  'verification',
  'fixtures',
  'violations',
  'credential-in-header-log',
  'invoker.js',
);
const UPSTREAM = join(REPO_ROOT, 'verification', 'fixtures', 'upstream', 'server.js');

/**
 * El escáner. Es lo único que la comprobación y sus casos de fallo comparten, y
 * por eso es lo único que tiene que estar bien.
 */
function fugas(texto: string, extra: readonly string[] = []): string[] {
  return [...Object.values(CENTINELAS), ...extra].filter((centinela) => texto.includes(centinela));
}

describe.each([
  ['A · la periferia de S2', periferiaA],
  ['B · la periferia de S3', periferiaB],
])('ningún material de credencial sale de la pasarela — %s', (_nombre, monta) => {
  let periferia: Periferia;
  let recorrido: Recorrido;

  beforeAll(async () => {
    periferia = await monta();
    recorrido = await periferia.recorre();
  }, 120_000);

  afterAll(async () => {
    await periferia.close();
  });

  it('el recorrido ocurrió de verdad', () => {
    // Un escáner sobre una cadena vacía no encuentra nada y pasaría igual.
    expect(recorrido.observable).toContain('build-agent');
    expect(recorrido.observable).toContain('facturacion-ops');
    expect(recorrido.observable).toContain('granted');
  });

  it('ni al registro de decisiones, ni en las respuestas, ni en los motivos', () => {
    expect(fugas(recorrido.observable)).toEqual([]);
  });

  it('tampoco la credencial que el propio cliente presentó', () => {
    // `TransportCredentials.presented`: "no se guarda, no se registra y no
    // vuelve a salir". Con OIDC es un token firmado, y un token en un registro
    // es una sesión regalada a quien lea el registro.
    expect(fugas(recorrido.observable, [recorrido.presentado])).toEqual([]);
  });

  it('la referencia al secreto sí puede aparecer: es un asa, no algo canjeable', () => {
    // La distinción que sostiene todo el diseño. `env://BILLING_OPS_KEY` y
    // `vault://kv/mcpizer/facturacion` no abren nada; su contenido sí.
    expect(recorrido.observable).toMatch(/facturacion-ops/);
    expect(recorrido.observable).not.toContain(CENTINELAS.credencialDeCuenta);
    expect(recorrido.observable).not.toContain(CENTINELAS.credencialEnBoveda);
  });

  it('el camino de fallo tampoco filtra: es donde más tienta poner el valor "para depurar"', () => {
    // Las denegaciones y el techo agotado están en el recorrido, y sus motivos
    // viajan de vuelta al cliente enteros.
    expect(recorrido.denegada.isError).toBe(true);
    expect(recorrido.agotada.isError).toBe(true);
    expect(fugas(`${recorrido.denegada.texto}\n${recorrido.agotada.texto}`, [recorrido.presentado])).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

function artefactoDeFuga(): { policy: string; catalog: string } {
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
  MCPIZER_CI_KEY: CENTINELAS.claveDeEmisor,
  MCPIZER_API_KEY: CENTINELAS.claveDeEmisor,
  BILLING_OPS_KEY: CENTINELAS.credencialDeCuenta,
};

describe('el escáner de fugas tiene casos que lo hacen fallar', () => {
  it('un invocador que traza la credencial queda al descubierto', async () => {
    const { policy, catalog } = artefactoDeFuga();
    const { stderr } = await execFileAsync(
      process.execPath,
      [FUGA_STDIO, policy, catalog, 'ci', 'facturacion__create_invoice'],
      { cwd: REPO_ROOT, env: { ...process.env, ...ENTORNO } },
    );

    // El mismo escáner, sobre una pasarela con un solo adaptador descuidado.
    expect(fugas(stderr)).toEqual([CENTINELAS.credencialDeCuenta]);
  });

  it('un invocador HTTP que traza la cabecera `Authorization`, también', async () => {
    const { policy, catalog } = artefactoDeFuga();
    const { stderr } = await execFileAsync(
      process.execPath,
      [FUGA_CABECERA, policy, catalog, 'ci', 'facturacion__create_invoice'],
      { cwd: REPO_ROOT, env: { ...process.env, ...ENTORNO } },
    );

    // El descuido de S3: la credencial ya no está en el entorno de un proceso
    // hijo, está en una cabecera — y trazar cabeceras es lo primero que se hace
    // al depurar un cliente HTTP.
    expect(fugas(stderr)).toEqual([CENTINELAS.credencialDeCuenta]);
  });
});

describe('el CLI existe donde el escáner lo busca', () => {
  it('la pasarela está construida', async () => {
    // Sin esto, un fallo de construcción se leería como "no hay fugas".
    const { stdout } = await execFileAsync(process.execPath, [CLI, 'help'], { cwd: REPO_ROOT });
    expect(stdout).toContain('mcpizer serve');
  });
});
