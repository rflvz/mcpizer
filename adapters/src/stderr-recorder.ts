/**
 * `DecisionRecorder` como JSON estructurado, una línea por decisión.
 *
 * Va a **stderr**, no a stdout, y no es un detalle: con transporte stdio, stdout
 * es el canal del protocolo MCP. Un JSON de auditoría por ahí corrompe la sesión
 * del cliente. "JSON estructurado a stdout" de `docs/diseno/puertos.md` §2.7 se
 * lee aquí como "a la salida de diagnóstico del proceso".
 *
 * OpenTelemetry ya está, en `otlp-recorder.ts`. El fichero de auditoría con
 * rotación sigue previsto y sin escribir.
 */

interface Record_ {
  readonly at: number;
  readonly principal: string;
  readonly issuer: string;
  readonly capability: string | undefined;
  readonly tool: string | undefined;
  readonly outcome: 'allow' | 'deny';
  readonly code: string;
  readonly path: string;
  readonly account: string | undefined;
}

/**
 * Registra **permisos y denegaciones**. Registrar solo denegaciones dejaría sin
 * rastro justo el caso que más importa auditar: quién usó qué cuenta.
 *
 * Los campos se escriben uno a uno, y no con un volcado del objeto recibido:
 * enumerar es lo que garantiza que nada que no esté en esta lista pueda acabar
 * en el registro.
 */
export function stderrRecorder(write: (line: string) => void = (line) => process.stderr.write(line)): {
  record(entry: Record_): void;
} {
  return {
    record(entry: Record_): void {
      write(
        `${JSON.stringify({
          at: new Date(entry.at).toISOString(),
          principal: entry.principal,
          issuer: entry.issuer,
          capability: entry.capability,
          tool: entry.tool,
          outcome: entry.outcome,
          code: entry.code,
          path: entry.path,
          account: entry.account,
        })}\n`,
      );
    },
  };
}
