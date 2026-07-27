/**
 * Un Redis de mentira: RESP2 sobre TCP, y solo los comandos que el adaptador usa.
 *
 * Habla el protocolo real, no una API nuestra. Eso es lo que hace que el test
 * ejercite de verdad el cliente RESP de `adapters/src/redis-usage.ts`: si el
 * cliente codificara mal un comando o parseara mal una respuesta, aquí se nota.
 *
 * Implementa `HINCRBY`, `HSETNX`, `HGET`, `HMGET`, `PEXPIRE` y `PING` con la
 * semántica de Redis, incluida la caducidad: la ventana la cierra el propio
 * almacén, que es la razón por la que el adaptador no necesita leer-modificar-
 * escribir y por tanto es correcto entre réplicas.
 */
import { createServer } from 'node:net';

const CRLF = '\r\n';

const simple = (texto) => `+${texto}${CRLF}`;
const entero = (valor) => `:${valor}${CRLF}`;
const error = (texto) => `-ERR ${texto}${CRLF}`;
const bulk = (valor) => (valor === undefined ? `$-1${CRLF}` : `$${Buffer.byteLength(valor)}${CRLF}${valor}${CRLF}`);
const arreglo = (valores) => `*${valores.length}${CRLF}${valores.map(bulk).join('')}`;

/**
 * Trocea el flujo entrante en comandos completos.
 *
 * Devuelve lo que no ha podido consumir todavía: un comando puede llegar
 * partido en varios paquetes, y tratarlo como si no fuera posible es la forma
 * habitual de escribir un servidor RESP que funciona en local y falla bajo carga.
 */
function trocea(bufer) {
  const comandos = [];
  let resto = bufer;

  for (;;) {
    if (!resto.startsWith('*')) break;
    const finCabecera = resto.indexOf(CRLF);
    if (finCabecera === -1) break;

    const cuantos = Number(resto.slice(1, finCabecera));
    let cursor = finCabecera + 2;
    const partes = [];
    let completo = true;

    for (let i = 0; i < cuantos; i += 1) {
      if (resto[cursor] !== '$') { completo = false; break; }
      const finLongitud = resto.indexOf(CRLF, cursor);
      if (finLongitud === -1) { completo = false; break; }
      const longitud = Number(resto.slice(cursor + 1, finLongitud));
      const inicio = finLongitud + 2;
      if (resto.length < inicio + longitud + 2) { completo = false; break; }
      partes.push(resto.slice(inicio, inicio + longitud));
      cursor = inicio + longitud + 2;
    }

    if (!completo) break;
    comandos.push(partes);
    resto = resto.slice(cursor);
  }

  return { comandos, resto };
}

export async function startRedis() {
  /** clave → { campos: Map, caducaEn: número | undefined } */
  const almacen = new Map();
  /** Todos los comandos atendidos, para poder afirmar qué se pidió y en qué orden. */
  const recibidos = [];

  const vigente = (clave) => {
    const entrada = almacen.get(clave);
    if (entrada === undefined) return undefined;
    if (entrada.caducaEn !== undefined && Date.now() >= entrada.caducaEn) {
      almacen.delete(clave);
      return undefined;
    }
    return entrada;
  };

  const asegura = (clave) => {
    const entrada = vigente(clave);
    if (entrada !== undefined) return entrada;
    const nueva = { campos: new Map(), caducaEn: undefined };
    almacen.set(clave, nueva);
    return nueva;
  };

  function atiende(partes) {
    const comando = (partes[0] ?? '').toUpperCase();
    recibidos.push([comando, ...partes.slice(1)]);

    switch (comando) {
      case 'PING':
        return simple('PONG');

      case 'HINCRBY': {
        const [, clave, campo, incremento] = partes;
        const entrada = asegura(clave);
        const actual = Number(entrada.campos.get(campo) ?? '0');
        const siguiente = actual + Number(incremento);
        entrada.campos.set(campo, String(siguiente));
        return entero(siguiente);
      }

      case 'HSETNX': {
        const [, clave, campo, valor] = partes;
        const entrada = asegura(clave);
        if (entrada.campos.has(campo)) return entero(0);
        entrada.campos.set(campo, valor);
        return entero(1);
      }

      case 'HGET': {
        const [, clave, campo] = partes;
        return bulk(vigente(clave)?.campos.get(campo));
      }

      case 'HMGET': {
        const [, clave, ...campos] = partes;
        const entrada = vigente(clave);
        return arreglo(campos.map((campo) => entrada?.campos.get(campo)));
      }

      case 'PEXPIRE': {
        const [, clave, milisegundos] = partes;
        const entrada = vigente(clave);
        if (entrada === undefined) return entero(0);
        entrada.caducaEn = Date.now() + Number(milisegundos);
        return entero(1);
      }

      case 'DEL': {
        const borradas = partes.slice(1).filter((clave) => almacen.delete(clave)).length;
        return entero(borradas);
      }

      default:
        return error(`comando no implementado en este fixture: ${comando}`);
    }
  }

  const conexiones = new Set();
  const server = createServer((socket) => {
    conexiones.add(socket);
    socket.on('close', () => conexiones.delete(socket));
    socket.on('error', () => undefined);

    let pendiente = '';
    socket.on('data', (trozo) => {
      pendiente += trozo.toString('utf8');
      const { comandos, resto } = trocea(pendiente);
      pendiente = resto;
      for (const partes of comandos) socket.write(atiende(partes));
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const puerto = server.address().port;

  return {
    url: `redis://127.0.0.1:${puerto}`,
    recibidos,
    /** Qué hay dentro, para afirmar sobre el contador sin pasar por el cliente. */
    volcado: () =>
      Object.fromEntries([...almacen].map(([clave, entrada]) => [clave, Object.fromEntries(entrada.campos)])),
    /**
     * Cae el almacén, con las conexiones abiertas cortadas de golpe.
     * Es el caso que separa "aún no hay contador" de "no se sabe", y el segundo
     * tiene que rechazar (invariante 3).
     */
    detiene: async () => {
      for (const socket of conexiones) socket.destroy();
      await new Promise((resolve) => server.close(() => resolve()));
    },
    close: async () => {
      for (const socket of conexiones) socket.destroy();
      await new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
