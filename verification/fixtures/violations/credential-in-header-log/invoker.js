#!/usr/bin/env node
/**
 * VIOLACIÓN: invariante 6 — el material de credencial acaba en un registro, esta
 * vez por la puerta que abre S3.
 *
 * El hermano de `../credential-in-log/invoker.js`, y no es una copia ociosa: el
 * descuido cambia de forma con el transporte. Con stdio la credencial se inyecta
 * en el entorno de un proceso hijo y hay que ir a buscarla para filtrarla; con
 * HTTP es una **cabecera**, y trazar cabeceras es literalmente lo primero que se
 * hace al depurar un cliente HTTP. Un escáner que solo hubiera visto el primer
 * caso podría estar buscando en el sitio equivocado y nadie se enteraría.
 *
 * Monta la pasarela real con los adaptadores reales y **cambia solo el
 * invocador**, para que lo que se demuestre sea que el escáner encuentra la
 * fuga, no que el andamiaje la fabrica.
 */
import { declaredCatalogFile, envCredentials, memoryUsage, policyFile, staticKeyPrincipals, stderrRecorder } from '@mcpizer/adapters';
import { gateway, loadPolicy } from 'mcpizer';

const [, , policyPath, catalogPath, issuerId, toolName] = process.argv;

const loaded = await loadPolicy(policyFile(policyPath), declaredCatalogFile(catalogPath));

const issuers = loaded.policy.issuers
  .filter((issuer) => issuer.kind === 'static-key' && issuer.subject && issuer.secretRef)
  .map((issuer) => ({
    id: issuer.id,
    subject: issuer.subject,
    secretRef: issuer.secretRef,
    attributes: issuer.attributes,
  }));

const usage = memoryUsage();

const door = gateway(loaded, {
  principals: staticKeyPrincipals(issuers),
  usageReader: usage,
  usageWriter: usage,
  credentials: envCredentials(),
  recorder: stderrRecorder(),
  now: () => Date.now(),
  invoker: {
    async invoke(call) {
      // Las líneas que lo rompen todo. Parecen diagnóstico de transporte —"qué
      // le mandé exactamente al upstream"— y publican el material por el mismo
      // canal que la auditoría.
      const headers = { Authorization: `Bearer ${call.credential.value}` };
      process.stderr.write(`[traza] POST ${call.upstreamId} cabeceras=${JSON.stringify(headers)}\n`);
      return { content: [{ type: 'text', text: 'ok' }], isError: false };
    },
    async close() {},
  },
});

const outcome = await door.call(
  { issuer: issuerId, presented: process.env['MCPIZER_API_KEY'] ?? '' },
  toolName,
  {},
);

// Si la invocación no llegó a ejecutarse, el caso de fallo no ha demostrado
// nada: sin efecto no hay traza, y el escáner encontraría el vacío.
if (outcome.kind !== 'invoked') {
  process.stderr.write(`[fixture] la invocación no se ejecutó: ${outcome.kind}\n`);
  process.exit(1);
}
