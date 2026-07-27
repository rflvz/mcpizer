/**
 * `UsageReader` / `UsageWriter` sobre Redis.
 *
 * Memoria basta para un proceso único. En cuanto hay más de una réplica los
 * contadores tienen que ser compartidos o los techos dejan de significar nada
 * (`docs/diseno/puertos.md` §2.4), y esa es la única razón por la que este
 * adaptador existe. De ahí se sigue todo lo demás: **cada escritura tiene que
 * ser atómica entre réplicas**, porque si no, dos procesos que leen, suman y
 * escriben pierden llamadas y el techo se pasa de largo.
 *
 * Por eso no hay leer-modificar-escribir en ningún sitio. La ventana la cierra
 * el propio almacén con su caducidad, y contar es un `HINCRBY`, que es atómico
 * por definición. La alternativa —un script Lua— haría lo mismo con más piezas y
 * exigiría que el fixture de verificación interpretara Lua para demostrar algo.
 *
 * **Un fallo del almacén rechaza.** No devuelve cero, no devuelve `undefined`, no
 * reintenta en silencio: `runtime/src/gateway.ts` convierte el rechazo en uso
 * desconocido y `access` trata desconocido como techo agotado (invariante 3).
 * Devolver cero sería fallo abierto, y tiene su caso en
 * `verification/fixtures/violations/usage-fails-open/`.
 */
import { redisConnection, type RedisConnection } from './redis-client.js';

interface Key {
  readonly principal: string;
  readonly capability: string;
}

interface Count {
  readonly calls: number;
  readonly windowStart: number;
}

export interface RedisUsage {
  read(key: Key): Promise<Count | undefined>;
  record(key: Key, at: number, windowMs: number): Promise<void>;
  /**
   * Cierra la conexión.
   *
   * No está en el puerto: `UsageReader` y `UsageWriter` no declaran ciclo de
   * vida, y añadírselo obligaría a tocar `runtime/src/ports.ts`. Lo recoge el
   * compositor de `periphery.ts` (decisión 0023).
   */
  close(): Promise<void>;
}

const PREFIX = 'mcpizer:usage';

/**
 * La clave del contador.
 *
 * Se codifican las dos partes: un principal o una capacidad con `:` dentro
 * haría que dos pares distintos compartieran contador, y compartir contador es
 * conceder llamadas de otro.
 */
function slot(key: Key): string {
  return `${PREFIX}:${encodeURIComponent(key.principal)}:${encodeURIComponent(key.capability)}`;
}

function numberOf(reply: string | undefined): number | undefined {
  if (reply === undefined) return undefined;
  const value = Number(reply);
  return Number.isFinite(value) ? value : undefined;
}

export function redisUsage(url: string, options: { readonly timeoutMs?: number } = {}): RedisUsage {
  const connection: RedisConnection = redisConnection(url, options);

  return {
    /**
     * Leer no muta: ni un `HINCRBY`, ni un `PEXPIRE`, ni un `TTL` que refresque
     * nada. La lectura ocurre antes de decidir y la escritura después.
     */
    async read(key: Key): Promise<Count | undefined> {
      const reply = await connection.send('HMGET', slot(key), 'calls', 'windowStart');
      const campos = Array.isArray(reply) ? reply : [];
      const calls = numberOf(campos[0]);
      const windowStart = numberOf(campos[1]);

      // Que no haya contador todavía es `undefined`, que la cáscara lee como
      // cero. Es distinto de que el almacén falle —eso ya ha rechazado más
      // arriba— y esa distinción es la que sostiene el fallo cerrado sin
      // volverlo insufrible (decisión 0014).
      if (calls === undefined && windowStart === undefined) return undefined;

      // Media entrada es posible si la clave caducó entre dos comandos de una
      // escritura. Se lee como una ventana que empieza ahora, no como ausencia:
      // ausencia sería regalar la llamada en curso.
      return { calls: calls ?? 0, windowStart: windowStart ?? 0 };
    },

    async record(key: Key, at: number, windowMs: number): Promise<void> {
      const clave = slot(key);

      // El orden importa y es el único sitio de este fichero donde importa.
      // `HINCRBY` primero: crea la clave y cuenta en un solo paso atómico, así
      // que dos réplicas simultáneas suman dos, nunca una.
      await connection.send('HINCRBY', clave, 'calls', '1');
      // `HSETNX` después: solo el primero de la ventana fija su inicio.
      await connection.send('HSETNX', clave, 'windowStart', String(at));

      const windowStart = numberOf(
        ((await connection.send('HGET', clave, 'windowStart')) as string | undefined) ?? undefined,
      );

      // La caducidad se calcula desde el inicio de la ventana, no desde ahora.
      // Si se calculara desde ahora, cada llamada la alargaría y la ventana
      // fija se convertiría en deslizante sin que nadie lo hubiera decidido.
      //
      // Y si la ventana ya pasó —reloj torcido, o una clave que sobrevivió a lo
      // suyo—, el resultado es 1 ms: la clave muere de inmediato y la siguiente
      // llamada empieza una ventana limpia. Se corrige solo.
      const restante = windowStart === undefined ? windowMs : windowStart + windowMs - at;
      await connection.send('PEXPIRE', clave, String(Math.max(1, Math.trunc(restante))));
    },

    close(): Promise<void> {
      return connection.close();
    },
  };
}
