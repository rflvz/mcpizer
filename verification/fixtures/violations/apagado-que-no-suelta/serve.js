#!/usr/bin/env node
/**
 * El caso que hace fallar "y termina dentro del plazo".
 *
 * Este sí atiende SIGTERM y sí deja de aceptar. Lo que no hace es soltar lo que
 * tenía abierto, así que el bucle de eventos nunca se vacía y el proceso se
 * queda ahí hasta que el orquestador se cansa y manda SIGKILL — que es
 * precisamente lo que el cierre ordenado existía para evitar.
 *
 * Es el descuido que parece corrección: hay manejador, hay `close()`, y el
 * apagado sigue siendo sucio. Sin este caso, la comprobación de al lado pasaría
 * igual mirando solo si el manejador existe.
 */
import { createServer } from 'node:http';

const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end('{"status":"ok"}');
});

// El asa que nadie cierra. Da igual cuál sea: un temporizador, un socket a
// Redis, un proceso hijo. El efecto observable es el mismo.
const pendiente = setInterval(() => undefined, 1_000);

process.once('SIGTERM', () => {
  server.close();
  // `clearInterval(pendiente)` es justo la línea que falta.
  void pendiente;
});

server.listen(0, '127.0.0.1', () => {
  process.stderr.write(`escucha en http://127.0.0.1:${server.address().port}/mcp\n`);
});
