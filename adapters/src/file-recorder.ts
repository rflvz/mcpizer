/**
 * `DecisionRecorder` a fichero de auditoría, con rotación por tamaño.
 *
 * Es la tercera implementación de `docs/diseno/puertos.md` §2.7, y no la
 * satisfacen las otras dos: stderr lo recoge quien recoja la salida del proceso,
 * y un colector remoto retiene lo que su proveedor decida. Un requisito de
 * cumplimiento habitual es distinto de los dos — **retención propia, en un
 * soporte que audita quien opera**, y con una cadena que se pueda archivar.
 *
 * Tres cosas que este adaptador hace distinto de los otros dos:
 *
 * 1. **Escribe de forma síncrona.** `record` devuelve `void`, y una escritura
 *    diferida convierte un `SIGKILL` en decisiones perdidas. Aquí un fallo de
 *    seguridad se paga en latencia antes que en huecos en la auditoría.
 * 2. **Rota por tamaño y conserva un número fijo de ficheros.** Sin límite, un
 *    proceso de larga vida acaba llenando el disco que comparte con lo que
 *    audita. Con límite, se dice cuánto se conserva y eso es una política de
 *    retención, no un accidente.
 * 3. **Un fallo al escribir se dice, y no se calla.** Que la auditoría falle en
 *    silencio es un fallo de seguridad; que aborte la ejecución ya hecha sería
 *    peor, porque la llamada al upstream ya ocurrió.
 */
import { closeSync, existsSync, mkdirSync, openSync, renameSync, statSync, unlinkSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

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

export interface FileRecorderOptions {
  /** Dónde se escribe. El directorio se crea si no existe. */
  readonly path: string;
  /** A partir de cuántos bytes se rota. */
  readonly maxBytes?: number;
  /** Cuántos ficheros rotados se conservan. Es la política de retención. */
  readonly keep?: number;
  /** Dónde se avisa de que la auditoría no llegó. Por defecto, stderr. */
  readonly onError?: (message: string) => void;
}

export interface FileRecorder {
  record(entry: Record_): void;
  /** Fuera del contrato del puerto, como en `otlp-recorder.ts` (decisión 0023). */
  close(): Promise<void>;
}

const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;
const DEFAULT_KEEP = 5;

/**
 * Los campos se escriben **uno a uno**, y no con un volcado del objeto recibido.
 *
 * Misma regla que en los otros dos grabadores y por el mismo motivo: enumerar es
 * lo que garantiza que nada que no esté en esta lista pueda acabar en el fichero.
 */
function linea(entry: Record_): string {
  return `${JSON.stringify({
    at: new Date(entry.at).toISOString(),
    principal: entry.principal,
    issuer: entry.issuer,
    capability: entry.capability,
    tool: entry.tool,
    outcome: entry.outcome,
    code: entry.code,
    path: entry.path,
    // La referencia de cuenta, que es opaca por diseño. Jamás el material.
    account: entry.account,
  })}\n`;
}

export function fileRecorder(options: FileRecorderOptions): FileRecorder {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const keep = options.keep ?? DEFAULT_KEEP;
  const onError = options.onError ?? ((message: string) => process.stderr.write(`${message}\n`));

  let fd: number | undefined;
  let escritos = 0;
  let cerrado = false;

  function abre(): void {
    mkdirSync(dirname(options.path), { recursive: true });
    fd = openSync(options.path, 'a');
    escritos = existsSync(options.path) ? statSync(options.path).size : 0;
  }

  /**
   * `auditoria.jsonl` → `.1`, `.1` → `.2`, … y se tira el que se sale de `keep`.
   *
   * Se recorre de mayor a menor a propósito: al revés, cada renombrado pisaría
   * al anterior y solo sobreviviría uno. Y lo que se borra es el **sobrante**,
   * no el origen: borrar el origen conservaría un fichero menos de los que se
   * prometieron, que es la clase de error que solo se descubre el día que hace
   * falta el más antiguo.
   */
  function rota(): void {
    if (fd !== undefined) {
      closeSync(fd);
      fd = undefined;
    }

    if (keep < 1) {
      // Sin retención: rotar es descartar. Es una elección legítima cuando la
      // auditoría se envía además a otro sitio.
      if (existsSync(options.path)) unlinkSync(options.path);
      abre();
      return;
    }

    const sobrante = `${options.path}.${keep}`;
    if (existsSync(sobrante)) unlinkSync(sobrante);
    for (let indice = keep - 1; indice >= 1; indice -= 1) {
      const origen = `${options.path}.${indice}`;
      if (existsSync(origen)) renameSync(origen, `${options.path}.${indice + 1}`);
    }
    if (existsSync(options.path)) renameSync(options.path, `${options.path}.1`);

    abre();
  }

  return {
    record(entry: Record_): void {
      if (cerrado) return;
      try {
        if (fd === undefined) abre();
        const texto = linea(entry);
        const bytes = Buffer.byteLength(texto);
        // Se rota **antes** de escribir: así una línea nunca queda partida entre
        // dos ficheros, que es lo que rompe a quien luego los lee línea a línea.
        if (escritos + bytes > maxBytes && escritos > 0) rota();
        writeSync(fd as number, texto);
        escritos += bytes;
      } catch (error) {
        onError(
          `mcpizer: no se pudo escribir la auditoría en \`${options.path}\` ` +
            `(${error instanceof Error ? error.message : String(error)}); una decisión sin registrar.`,
        );
      }
    },

    async close(): Promise<void> {
      cerrado = true;
      if (fd !== undefined) {
        closeSync(fd);
        fd = undefined;
      }
    },
  };
}
