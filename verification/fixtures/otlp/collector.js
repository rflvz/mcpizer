/**
 * Un colector OTLP de mentira: `POST /v1/logs` en OTLP/JSON.
 *
 * Es lo que hace comprobable la afirmación del adaptador de OpenTelemetry.
 * Guarda los cuerpos tal cual llegan —sin interpretarlos— para que el escáner
 * de fugas pueda pasar por encima: un colector es un sitio observable más, y el
 * invariante 6 se aplica ahí igual que al registro de stderr.
 */
import { createServer } from 'node:http';

export async function startOtlpCollector({ falla = false } = {}) {
  /** Los cuerpos recibidos, ya parseados. */
  const lotes = [];
  /** Y en bruto, que es lo que el escáner de fugas necesita mirar. */
  const crudo = [];

  const server = createServer((request, response) => {
    let cuerpo = '';
    request.on('data', (trozo) => {
      cuerpo += trozo;
    });
    request.on('end', () => {
      if (request.url !== '/v1/logs' || request.method !== 'POST') {
        response.writeHead(404).end();
        return;
      }
      if (falla) {
        // Un colector que rechaza. El fallo no revierte nada, pero tiene que
        // verse: `docs/diseno/puertos.md` §2.7.
        response.writeHead(503, { 'content-type': 'application/json' });
        response.end('{"error":"colector caído"}');
        return;
      }
      crudo.push(cuerpo);
      try {
        lotes.push(JSON.parse(cuerpo));
      } catch {
        lotes.push({ ilegible: cuerpo });
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{}');
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  /** Los registros individuales, aplanados desde la envoltura de OTLP. */
  const registros = () =>
    lotes.flatMap((lote) =>
      (lote.resourceLogs ?? []).flatMap((recurso) =>
        (recurso.scopeLogs ?? []).flatMap((ambito) => ambito.logRecords ?? []),
      ),
    );

  return {
    url: `http://127.0.0.1:${server.address().port}`,
    lotes,
    crudo,
    registros,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
