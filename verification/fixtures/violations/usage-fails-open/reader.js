#!/usr/bin/env node
/**
 * VIOLACIÓN: invariante 3 — uso desconocido tratado como cero.
 *
 * `docs/diseno/puertos.md` §2.4 lo dice sin margen: "si el almacén no responde,
 * el uso es desconocido. **Uso desconocido se trata como límite agotado**, no
 * como cero". Con contadores en memoria eso no se puede ni ensayar —la memoria
 * no se cae—, así que hasta S3 la regla no tenía cómo fallar de verdad. Con
 * Redis sí, y este es el descuido exacto: un `catch` que devuelve cero.
 *
 * Es el descuido más plausible de todo el repositorio, porque parece
 * *robustez*: "si el almacén falla, que la pasarela siga funcionando". Y lo que
 * hace es regalar llamadas sin techo justo cuando la infraestructura está mal.
 *
 * Se ejecuta en dos modos contra **la misma pasarela**, cambiando solo el
 * lector:
 *
 *   cerrado — el adaptador de Redis de verdad, con el almacén caído.
 *   abierto — el mismo, envuelto en el `catch` que devuelve cero.
 *
 * Sin el segundo, la comprobación del primero podría estar mirando otra cosa y
 * pasaría igual (`docs/sesiones.md` §2).
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { declaredCatalogFile, envCredentials, policyFile, redisUsage, staticKeyPrincipals, stderrRecorder } from '@mcpizer/adapters';
import { gateway, loadPolicy } from 'mcpizer';

const REPO = fileURLToPath(new URL('../../../..', import.meta.url));
const UPSTREAM = join(REPO, 'verification', 'fixtures', 'upstream', 'server.js');

const [, , modo] = process.argv;

const dir = mkdtempSync(join(tmpdir(), 'mcpizer-uso-'));
const policyPath = join(dir, 'policy.yaml');
const catalogPath = join(dir, 'catalog.yaml');

writeFileSync(
  policyPath,
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
  catalogPath,
  `version: 1
tools:
  - upstream: facturacion
    name: create_invoice
    inputSchema: { type: object }
`,
);

const loaded = await loadPolicy(policyFile(policyPath), declaredCatalogFile(catalogPath));

const issuers = loaded.policy.issuers
  .filter((issuer) => issuer.kind === 'static-key' && issuer.subject && issuer.secretRef)
  .map((issuer) => ({
    id: issuer.id,
    subject: issuer.subject,
    secretRef: issuer.secretRef,
    attributes: issuer.attributes,
  }));

// Un puerto que nadie escucha: el almacén está caído desde el primer comando.
const caido = redisUsage('redis://127.0.0.1:1', { timeoutMs: 500 });

const cerrado = {
  read: (key) => caido.read(key),
  record: (key, at, windowMs) => caido.record(key, at, windowMs),
};

const abierto = {
  // La línea que lo rompe todo. Parece robustez y es fallo abierto: el techo
  // deja de existir exactamente cuando la infraestructura falla.
  read: async (key) => {
    try {
      return await caido.read(key);
    } catch {
      return { calls: 0, windowStart: Date.now() };
    }
  },
  record: async (key, at, windowMs) => {
    try {
      await caido.record(key, at, windowMs);
    } catch {
      /* y la llamada no se cuenta en ninguna parte */
    }
  },
};

const usage = modo === 'abierto' ? abierto : cerrado;

const door = gateway(loaded, {
  principals: staticKeyPrincipals(issuers),
  usageReader: usage,
  usageWriter: usage,
  credentials: envCredentials(),
  recorder: stderrRecorder(() => {}),
  now: () => Date.now(),
  invoker: {
    async invoke() {
      return { content: [{ type: 'text', text: 'ejecutado' }], isError: false };
    },
    async close() {},
  },
});

const outcome = await door.call(
  { issuer: 'ci', presented: process.env['MCPIZER_API_KEY'] ?? '' },
  'facturacion__create_invoice',
  {},
);

await caido.close();

process.stdout.write(
  `${JSON.stringify({ kind: outcome.kind, code: outcome.kind === 'denied' ? outcome.reason.code : undefined })}\n`,
);
