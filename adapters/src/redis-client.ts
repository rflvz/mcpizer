/**
 * Un cliente RESP mínimo: lo que `redis-usage.ts` necesita y nada más.
 *
 * No es "no usar una biblioteca por gusto". El adaptador emite seis comandos
 * —`HINCRBY`, `HSETNX`, `HGET`, `HMGET`, `PEXPIRE` y `PING`— y lo que de verdad
 * tiene que ser correcto no es el catálogo de comandos sino **el modo de
 * fallo**: si el almacén no contesta, la promesa tiene que rechazar, porque uso
 * desconocido se trata como techo agotado (invariante 3). Un cliente completo
 * trae reconexión, reintentos y colas silenciosas, que son exactamente las
 * políticas que convertirían ese rechazo en un cero.
 *
 * RESP2, que es lo que cualquier Redis entiende sin negociar nada.
 */
import { createConnection, type Socket } from 'node:net';

const CRLF = '\r\n';

export type Reply = string | number | undefined | (string | undefined)[];

interface Pending {
  readonly resolve: (reply: Reply) => void;
  readonly reject: (error: Error) => void;
}

/** Un fallo del almacén. Se distingue por tipo para que nadie lo confunda con "no hay contador". */
export class RedisUnavailable extends Error {}

export interface RedisConnection {
  send(...args: string[]): Promise<Reply>;
  close(): Promise<void>;
}

/**
 * Intenta consumir una respuesta completa del búfer.
 *
 * Devuelve `undefined` si todavía no ha llegado entera: una respuesta puede
 * venir partida en varios paquetes, y darlo por imposible es la forma habitual
 * de escribir un cliente que funciona en local y falla bajo carga.
 */
function decode(buffer: string, from: number): { reply: Reply; next: number } | undefined {
  const fin = buffer.indexOf(CRLF, from);
  if (fin === -1) return undefined;

  const tipo = buffer[from];
  const cabecera = buffer.slice(from + 1, fin);
  const tras = fin + 2;

  if (tipo === '+') return { reply: cabecera, next: tras };
  if (tipo === ':') return { reply: Number(cabecera), next: tras };
  if (tipo === '-') throw new Error(cabecera);

  if (tipo === '$') {
    const longitud = Number(cabecera);
    if (longitud === -1) return { reply: undefined, next: tras };
    if (buffer.length < tras + longitud + 2) return undefined;
    return { reply: buffer.slice(tras, tras + longitud), next: tras + longitud + 2 };
  }

  if (tipo === '*') {
    const cuantos = Number(cabecera);
    if (cuantos === -1) return { reply: undefined, next: tras };
    const elementos: (string | undefined)[] = [];
    let cursor = tras;
    for (let i = 0; i < cuantos; i += 1) {
      const elemento = decode(buffer, cursor);
      if (elemento === undefined) return undefined;
      // El adaptador solo pide arreglos de cadenas (`HMGET`); anidar más sería
      // superficie que nadie usa.
      elementos.push(elemento.reply === undefined ? undefined : String(elemento.reply));
      cursor = elemento.next;
    }
    return { reply: elementos, next: cursor };
  }

  throw new Error(`Respuesta RESP de tipo desconocido: \`${String(tipo)}\`.`);
}

function encode(args: readonly string[]): string {
  return `*${args.length}${CRLF}${args
    .map((arg) => `$${Buffer.byteLength(arg)}${CRLF}${arg}${CRLF}`)
    .join('')}`;
}

/**
 * Una conexión perezosa: no se abre hasta el primer comando, y si se cae,
 * **todo lo pendiente rechaza**. No hay cola que sobreviva a la desconexión,
 * porque una llamada que se queda esperando a una reconexión es una llamada que
 * no ha fallado todavía, y el techo no se puede evaluar con eso.
 */
export function redisConnection(url: string, options: { readonly timeoutMs?: number } = {}): RedisConnection {
  const destino = new URL(url);
  const timeoutMs = options.timeoutMs ?? 5_000;

  let socket: Socket | undefined;
  let abriendo: Promise<Socket> | undefined;
  let cerrado = false;
  const pendientes: Pending[] = [];

  function rompe(motivo: string, cause?: unknown): void {
    socket = undefined;
    abriendo = undefined;
    const enCurso = pendientes.splice(0, pendientes.length);
    for (const pendiente of enCurso) {
      pendiente.reject(new RedisUnavailable(motivo, cause === undefined ? undefined : { cause }));
    }
  }

  function abre(): Promise<Socket> {
    if (abriendo !== undefined) return abriendo;

    abriendo = new Promise<Socket>((resolve, reject) => {
      const nuevo = createConnection({
        host: destino.hostname,
        port: Number(destino.port === '' ? '6379' : destino.port),
      });
      nuevo.setNoDelay(true);

      let recibido = '';
      nuevo.on('data', (trozo: Buffer) => {
        recibido += trozo.toString('utf8');
        let cursor = 0;
        for (;;) {
          let decodificado: { reply: Reply; next: number } | undefined;
          try {
            decodificado = decode(recibido, cursor);
          } catch (error) {
            // Un `-ERR` del servidor: es respuesta, no caída. Rechaza solo la
            // llamada que la provocó.
            const siguiente = recibido.indexOf(CRLF, cursor) + 2;
            pendientes.shift()?.reject(error instanceof Error ? error : new Error(String(error)));
            cursor = siguiente;
            continue;
          }
          if (decodificado === undefined) break;
          pendientes.shift()?.resolve(decodificado.reply);
          cursor = decodificado.next;
        }
        recibido = recibido.slice(cursor);
      });

      nuevo.on('error', (error) => {
        rompe('El almacén de uso no responde.', error);
        reject(new RedisUnavailable('El almacén de uso no responde.', { cause: error }));
      });

      nuevo.on('close', () => {
        if (!cerrado) rompe('El almacén de uso cerró la conexión.');
      });

      nuevo.on('connect', () => {
        socket = nuevo;
        resolve(nuevo);
      });
    });

    return abriendo;
  }

  return {
    async send(...args: string[]): Promise<Reply> {
      if (cerrado) throw new RedisUnavailable('El almacén de uso ya está cerrado.');

      let conexion: Socket;
      try {
        conexion = socket ?? (await abre());
      } catch (cause) {
        // Una conexión que no llegó a abrirse no se cachea: el siguiente intento
        // vuelve a probar en vez de heredar el fallo para siempre.
        abriendo = undefined;
        throw cause instanceof RedisUnavailable
          ? cause
          : new RedisUnavailable('El almacén de uso no responde.', { cause });
      }

      return new Promise<Reply>((resolve, reject) => {
        const temporizador = setTimeout(() => {
          reject(new RedisUnavailable('El almacén de uso ha tardado demasiado.'));
        }, timeoutMs);

        pendientes.push({
          resolve: (reply) => {
            clearTimeout(temporizador);
            resolve(reply);
          },
          reject: (error) => {
            clearTimeout(temporizador);
            reject(error);
          },
        });

        conexion.write(encode(args));
      });
    },

    async close(): Promise<void> {
      cerrado = true;
      const abierto = socket;
      socket = undefined;
      abriendo = undefined;
      rompe('El almacén de uso se ha cerrado.');
      if (abierto !== undefined) {
        await new Promise<void>((resolve) => {
          abierto.end(() => {
            resolve();
          });
        });
      }
    },
  };
}
