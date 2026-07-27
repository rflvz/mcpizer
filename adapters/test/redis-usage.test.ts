/**
 * `UsageReader` / `UsageWriter` sobre Redis, contra un servidor RESP de verdad
 * (`verification/fixtures/redis/server.js`).
 *
 * Se comprueban las dos cosas que separan este adaptador del de memoria:
 *
 * 1. **El almacén que no responde rechaza**, y no devuelve cero. Uso desconocido
 *    se trata como techo agotado (invariante 3); devolver cero sería fallo
 *    abierto y regalaría llamadas justo cuando la infraestructura falla.
 * 2. **Nada de leer-modificar-escribir.** Es la razón de existir del adaptador:
 *    con dos réplicas, contar tiene que ser atómico o el techo no significa nada.
 *    Se afirma sobre los comandos que llegaron al almacén, no sobre el resultado.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { startRedis, type RedisFixture } from '../../verification/lib/fixtures.js';
import { redisUsage, type RedisUsage } from '../src/redis-usage.js';

const CLAVE = { principal: 'corp:ana', capability: 'crm.contact.read' };
const HORA = 3_600_000;
const AHORA = Date.parse('2026-01-01T00:00:00Z');

let almacen: RedisFixture | undefined;
let usage: RedisUsage | undefined;

afterEach(async () => {
  await usage?.close();
  await almacen?.close();
  usage = undefined;
  almacen = undefined;
});

async function conAlmacen(): Promise<{ almacen: RedisFixture; usage: RedisUsage }> {
  almacen = await startRedis();
  usage = redisUsage(almacen.url, { timeoutMs: 2_000 });
  return { almacen, usage };
}

describe('cuenta el uso', () => {
  it('sin contador todavía es `undefined`, que la cáscara lee como cero', async () => {
    const { usage } = await conAlmacen();
    expect(await usage.read(CLAVE)).toBeUndefined();
  });

  it('la primera llamada abre la ventana', async () => {
    const { usage } = await conAlmacen();
    await usage.record(CLAVE, AHORA, HORA);

    expect(await usage.read(CLAVE)).toEqual({ calls: 1, windowStart: AHORA });
  });

  it('las siguientes suman sin mover el inicio de la ventana', async () => {
    const { usage } = await conAlmacen();
    await usage.record(CLAVE, AHORA, HORA);
    await usage.record(CLAVE, AHORA + 1_000, HORA);
    await usage.record(CLAVE, AHORA + 2_000, HORA);

    expect(await usage.read(CLAVE)).toEqual({ calls: 3, windowStart: AHORA });
  });

  it('dos pares distintos no comparten contador', async () => {
    const { usage } = await conAlmacen();
    await usage.record(CLAVE, AHORA, HORA);
    await usage.record({ principal: 'corp:ana', capability: 'crm.contact.write' }, AHORA, HORA);

    expect(await usage.read(CLAVE)).toEqual({ calls: 1, windowStart: AHORA });
  });

  it('un `:` dentro del principal no colapsa dos claves en una', async () => {
    const { usage } = await conAlmacen();
    // Sin codificar, `a:b` + `c` y `a` + `b:c` producirían la misma clave, y
    // compartir contador es conceder llamadas de otro.
    await usage.record({ principal: 'a:b', capability: 'c' }, AHORA, HORA);

    expect(await usage.read({ principal: 'a', capability: 'b:c' })).toBeUndefined();
  });
});

describe('leer no muta', () => {
  it('no emite ni un comando de escritura', async () => {
    const { almacen, usage } = await conAlmacen();
    await usage.record(CLAVE, AHORA, HORA);
    const hastaAqui = almacen.recibidos.length;

    await usage.read(CLAVE);
    await usage.read(CLAVE);

    const deLectura = almacen.recibidos.slice(hastaAqui);
    expect(deLectura.map((comando) => comando[0])).toEqual(['HMGET', 'HMGET']);
  });
});

describe('contar es atómico, no leer-modificar-escribir', () => {
  it('el incremento lo hace el almacén, no el adaptador', async () => {
    const { almacen, usage } = await conAlmacen();
    await usage.record(CLAVE, AHORA, HORA);

    const comandos = almacen.recibidos.map((comando) => comando[0]);
    // `HINCRBY` primero: crea la clave y cuenta en un solo paso. Si aquí
    // apareciera un `HGET` **antes** del incremento, dos réplicas simultáneas
    // perderían llamadas y el techo se pasaría de largo.
    expect(comandos[0]).toBe('HINCRBY');
    expect(comandos).not.toContain('GET');
    expect(comandos).not.toContain('SET');
  });

  it('la caducidad se calcula desde el inicio de la ventana, no desde ahora', async () => {
    const { almacen, usage } = await conAlmacen();
    await usage.record(CLAVE, AHORA, HORA);
    await usage.record(CLAVE, AHORA + 600_000, HORA);

    const caducidades = almacen.recibidos
      .filter((comando) => comando[0] === 'PEXPIRE')
      .map((comando) => Number(comando[2]));

    // Si se calculara desde ahora, la segunda volvería a pedir una hora entera y
    // la ventana fija se habría convertido en deslizante sin que nadie lo
    // decidiera.
    expect(caducidades).toEqual([HORA, HORA - 600_000]);
  });
});

describe('el almacén que no responde rechaza', () => {
  it('leer rechaza, no devuelve cero', async () => {
    const { almacen, usage } = await conAlmacen();
    await usage.record(CLAVE, AHORA, HORA);
    await almacen.detiene();

    // La distinción entera: `undefined` es "aún no hay contador" y es cero;
    // rechazar es "no se sabe" y `access` lo trata como techo agotado.
    await expect(usage.read(CLAVE)).rejects.toThrow();
  });

  it('escribir también rechaza: una llamada sin contar es una llamada regalada', async () => {
    const { almacen, usage } = await conAlmacen();
    await almacen.detiene();

    await expect(usage.record(CLAVE, AHORA, HORA)).rejects.toThrow();
  });
});
