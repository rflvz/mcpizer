/**
 * `DecisionRecorder` sobre OpenTelemetry, por OTLP/HTTP en JSON.
 *
 * Aparece en cuanto hay observabilidad centralizada (`docs/diseno/puertos.md`
 * §2.7), y es el adaptador que más tensa su contrato, porque `record` devuelve
 * `void` y es **síncrono**: no hay dónde esperar a que el lote salga, ni dónde
 * vaciarlo antes de que el proceso muera. Escribir a stderr no tiene ese
 * problema; enviar por red, sí.
 *
 * La respuesta no es añadirle `close()` al puerto —eso sería tocar
 * `runtime/src/ports.ts`, y el criterio de S3 dice que no—. El ciclo de vida lo
 * recoge el compositor de `periphery.ts` (decisión 0023): este adaptador expone
 * `flush()` y `close()` **fuera** del contrato, y quien compone los llama.
 *
 * Se habla OTLP directamente en vez de montar el SDK de OpenTelemetry. Lo que un
 * colector entiende es el protocolo, no la biblioteca, y media docena de
 * paquetes para producir un JSON que la especificación fija es superficie que
 * este repositorio no controla (decisión 0026).
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

export interface OtlpOptions {
  /** La base del colector: se envía a `{endpoint}/v1/logs`. */
  readonly endpoint: string;
  readonly serviceName?: string;
  /** Cuántas decisiones se acumulan antes de salir. */
  readonly batchSize?: number;
  /** Y cuánto se espera como mucho, para que una pasarela tranquila no retenga la última. */
  readonly flushIntervalMs?: number;
  readonly timeoutMs?: number;
  /**
   * Dónde se avisa de que la auditoría no llegó. Por defecto, stderr.
   *
   * Que la auditoría falle **en silencio** es un fallo de seguridad
   * (`docs/diseno/puertos.md` §2.7), así que este camino existe siempre y no se
   * puede apagar: lo más que se puede hacer es redirigirlo.
   */
  readonly onError?: (message: string) => void;
}

export interface OtlpRecorder {
  record(entry: Record_): void;
  /** Fuerza la salida del lote pendiente. Fuera del puerto, a propósito. */
  flush(): Promise<void>;
  close(): Promise<void>;
}

/** El tope del búfer. Un colector caído no puede convertirse en una fuga de memoria. */
const MAX_BUFFER = 2_048;

const SEVERITY = {
  allow: { number: 9, text: 'INFO' },
  deny: { number: 13, text: 'WARN' },
} as const;

interface Attribute {
  readonly key: string;
  readonly value: { readonly stringValue: string };
}

/**
 * Los campos se escriben **uno a uno**, y no con un volcado del objeto recibido.
 *
 * Es la misma regla que en `stderr-recorder.ts` y por el mismo motivo: enumerar
 * es lo que garantiza que nada que no esté en esta lista pueda acabar en el
 * colector. `DecisionRecord` no tiene hoy ningún campo donde quepa material de
 * credencial, y esta función asegura que tampoco lo tendría mañana.
 */
function attributes(entry: Record_): Attribute[] {
  const pares: readonly (readonly [string, string | undefined])[] = [
    ['mcpizer.principal', entry.principal],
    ['mcpizer.issuer', entry.issuer],
    ['mcpizer.capability', entry.capability],
    ['mcpizer.tool', entry.tool],
    ['mcpizer.outcome', entry.outcome],
    ['mcpizer.code', entry.code],
    ['mcpizer.path', entry.path],
    // La referencia de cuenta, que es opaca por diseño. Jamás el material.
    ['mcpizer.account', entry.account],
  ];

  return pares.flatMap(([key, value]) => (value === undefined ? [] : [{ key, value: { stringValue: value } }]));
}

export function otlpRecorder(options: OtlpOptions): OtlpRecorder {
  const endpoint = `${options.endpoint.replace(/\/+$/, '')}/v1/logs`;
  const serviceName = options.serviceName ?? 'mcpizer';
  const batchSize = options.batchSize ?? 64;
  const flushIntervalMs = options.flushIntervalMs ?? 2_000;
  const timeoutMs = options.timeoutMs ?? 5_000;
  const onError = options.onError ?? ((message: string) => process.stderr.write(`${message}\n`));

  let buffer: Record_[] = [];
  let timer: NodeJS.Timeout | undefined;
  /** El envío en curso, para que `close()` pueda esperarlo en vez de cortarlo. */
  let enVuelo: Promise<void> = Promise.resolve();
  let cerrado = false;

  function envuelve(lote: readonly Record_[]): string {
    return JSON.stringify({
      resourceLogs: [
        {
          resource: { attributes: [{ key: 'service.name', value: { stringValue: serviceName } }] },
          scopeLogs: [
            {
              scope: { name: 'mcpizer' },
              logRecords: lote.map((entry) => ({
                timeUnixNano: `${BigInt(entry.at) * 1_000_000n}`,
                severityNumber: SEVERITY[entry.outcome].number,
                severityText: SEVERITY[entry.outcome].text,
                body: { stringValue: `${entry.outcome} ${entry.code}` },
                attributes: attributes(entry),
              })),
            },
          ],
        },
      ],
    });
  }

  async function envia(lote: readonly Record_[]): Promise<void> {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: envuelve(lote),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        onError(`mcpizer: el colector OTLP contestó ${response.status}; ${lote.length} decisiones sin registrar.`);
      }
    } catch (error) {
      // Un fallo al registrar no revierte una ejecución ya hecha —eso sería
      // peor—, pero tampoco se calla. Y no se reintenta: una cola que crece
      // mientras el colector está caído acaba tirando el proceso que auditaba.
      onError(
        `mcpizer: el colector OTLP no responde (${error instanceof Error ? error.message : String(error)}); ` +
          `${lote.length} decisiones sin registrar.`,
      );
    }
  }

  function vacia(): void {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (buffer.length === 0) return;
    const lote = buffer;
    buffer = [];
    enVuelo = enVuelo.then(() => envia(lote));
  }

  return {
    record(entry: Record_): void {
      if (cerrado) return;

      if (buffer.length >= MAX_BUFFER) {
        buffer.shift();
        onError('mcpizer: el búfer de auditoría está lleno; se ha descartado la decisión más antigua.');
      }
      // Se registran **permisos y denegaciones**. Registrar solo denegaciones
      // dejaría sin rastro justo el caso que más importa auditar: quién usó qué
      // cuenta.
      buffer.push(entry);

      if (buffer.length >= batchSize) {
        vacia();
        return;
      }
      if (timer === undefined) {
        timer = setTimeout(vacia, flushIntervalMs);
        // El temporizador no mantiene vivo el proceso: la pasarela termina
        // cuando el cliente se va, no cuando toca vaciar el búfer.
        timer.unref();
      }
    },

    async flush(): Promise<void> {
      vacia();
      await enVuelo;
    },

    async close(): Promise<void> {
      vacia();
      cerrado = true;
      await enVuelo;
    },
  };
}
