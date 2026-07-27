#!/usr/bin/env node
/**
 * El caso que hace fallar "SIGTERM sale con 0".
 *
 * Un proceso que escucha y no atiende la señal. Node lo mata con el
 * comportamiento por defecto: el proceso muere *por* SIGTERM, sin código propio,
 * y todo lo que estuviera a medias —las sesiones upstream, el último lote de
 * auditoría (decisión 0023)— se pierde sin dejar rastro.
 *
 * Es exactamente la regresión que se cuela sin que nada se ponga rojo: el
 * contenedor arranca, atiende, y solo se nota el día que alguien busca en la
 * auditoría un evento que nunca se escribió.
 */
import { createServer } from 'node:http';

const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end('{"status":"ok"}');
});

server.listen(0, '127.0.0.1', () => {
  process.stderr.write(`escucha en http://127.0.0.1:${server.address().port}/mcp\n`);
});
