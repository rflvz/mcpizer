#!/usr/bin/env node
/**
 * VIOLACIÓN: invariante 6 — el material de credencial acaba en un registro.
 *
 * `docs/diseno/puertos.md` §2.6 avisa de que `ToolInvoker` "es el único punto
 * del sistema que ve a la vez credenciales y argumentos, y por eso es el único
 * que necesita cuidado explícito con lo que registra". Este es exactamente el
 * descuido del que avisa, escrito a propósito.
 *
 * Existe porque `docs/sesiones.md` §2 dice que una comprobación que nunca ha
 * fallado no está verificada. Sin este caso, el escáner de fugas podría estar
 * buscando mal y nadie se enteraría: pasaría igual.
 *
 * Monta la pasarela real con los adaptadores reales y **cambia solo el
 * invocador**, para que lo que se demuestre sea que el escáner encuentra la
 * fuga, no que el andamiaje la fabrica.
 */
import { envCredentials, memoryUsage, staticKeyPrincipals, stderrRecorder } from '@mcpizer/adapters';
import { declaredCatalogFile, policyFile } from '@mcpizer/adapters';
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
    // La línea que lo rompe todo. Parece diagnóstico útil y publica el material
    // por el mismo canal que la auditoría.
    async invoke(call) {
      process.stderr.write(`[traza] invocando ${call.tool} con credencial ${call.credential.value}\n`);
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
