/**
 * `DecisionRecorder` a fichero de auditoría, con rotación por tamaño.
 *
 * Lo que hay que comprobar es lo que lo distingue de los otros dos grabadores:
 * que la retención sea una política y no un accidente —rota, y conserva un
 * número fijo—, que ninguna línea quede partida entre dos ficheros, y que un
 * fallo al escribir se diga en vez de callarse.
 */
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileRecorder } from '../src/index.js';

const CREDENCIAL = 'centinela-que-no-debe-aparecer-en-la-auditoria';

function decision(overrides: Record<string, unknown> = {}) {
  return {
    at: Date.parse('2026-01-01T03:00:00Z'),
    principal: 'ci:build-agent',
    issuer: 'ci',
    capability: 'billing.invoice.issue',
    tool: 'facturacion__create_invoice',
    outcome: 'allow' as const,
    code: 'granted',
    path: '/grants/0',
    account: 'facturacion-ops',
    ...overrides,
  };
}

function enUnDirectorio(): string {
  return join(mkdtempSync(join(tmpdir(), 'mcpizer-auditoria-')), 'auditoria.jsonl');
}

describe('escribe la decisión, una línea por decisión', () => {
  it('permisos y denegaciones, y el sitio a tocar', async () => {
    const path = enUnDirectorio();
    const recorder = fileRecorder({ path });

    recorder.record(decision());
    recorder.record(decision({ outcome: 'deny', code: 'no_grant_matches', account: undefined }));
    await recorder.close();

    const lineas = readFileSync(path, 'utf8').trim().split('\n').map((linea) => JSON.parse(linea) as Record<string, unknown>);

    // Registrar solo denegaciones dejaría sin rastro justo el caso que más
    // importa auditar: quién usó qué cuenta.
    expect(lineas.map((linea) => linea['outcome'])).toEqual(['allow', 'deny']);
    expect(lineas[0]).toMatchObject({ account: 'facturacion-ops', path: '/grants/0' });
    expect(lineas[0]?.['at']).toBe('2026-01-01T03:00:00.000Z');
  });

  it('y crea el directorio si no existe: un despliegue no tiene por qué prepararlo', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'mcpizer-auditoria-')), 'sub', 'dir', 'auditoria.jsonl');
    const recorder = fileRecorder({ path });
    recorder.record(decision());
    await recorder.close();

    expect(readFileSync(path, 'utf8')).toContain('granted');
  });

  it('nunca escribe material de credencial: los campos se enumeran, no se vuelcan', async () => {
    const path = enUnDirectorio();
    const recorder = fileRecorder({ path });

    // Un campo de más en la entrada no puede acabar en el fichero.
    recorder.record({ ...decision(), credencial: CREDENCIAL } as never);
    await recorder.close();

    expect(readFileSync(path, 'utf8')).not.toContain(CREDENCIAL);
  });
});

describe('la retención es una política, no un accidente', () => {
  it('rota por tamaño y conserva el número de ficheros que se le dice', async () => {
    const path = enUnDirectorio();
    const recorder = fileRecorder({ path, maxBytes: 400, keep: 2 });

    for (let indice = 0; indice < 40; indice += 1) recorder.record(decision({ code: `motivo-${indice}` }));
    await recorder.close();

    const ficheros = readdirSync(join(path, '..')).sort();
    // El vigente más los rotados, y ni uno más: sin límite, un proceso de larga
    // vida acaba llenando el disco que comparte con lo que audita.
    expect(ficheros).toEqual(['auditoria.jsonl', 'auditoria.jsonl.1', 'auditoria.jsonl.2']);
  });

  it('y ninguna línea queda partida entre dos ficheros', async () => {
    // Se rota **antes** de escribir, no después de pasarse: una línea partida
    // rompe a quien luego lee el fichero línea a línea, que es todo el mundo.
    const path = enUnDirectorio();
    const recorder = fileRecorder({ path, maxBytes: 300, keep: 3 });

    for (let indice = 0; indice < 30; indice += 1) recorder.record(decision({ code: `motivo-${indice}` }));
    await recorder.close();

    for (const fichero of readdirSync(join(path, '..'))) {
      const contenido = readFileSync(join(path, '..', fichero), 'utf8');
      expect(contenido.endsWith('\n')).toBe(true);
      for (const linea of contenido.trim().split('\n')) {
        expect(() => JSON.parse(linea)).not.toThrow();
      }
    }
  });

  it('lo escrito antes de rotar sigue ahí, en el fichero rotado', async () => {
    const path = enUnDirectorio();
    const recorder = fileRecorder({ path, maxBytes: 400, keep: 5 });

    recorder.record(decision({ code: 'la-primera' }));
    recorder.record(decision({ code: 'la-segunda' }));
    recorder.record(decision({ code: 'la-tercera' }));
    await recorder.close();

    const todo = readdirSync(join(path, '..'))
      .map((fichero) => readFileSync(join(path, '..', fichero), 'utf8'))
      .join('');
    // Rotar mueve, no trunca: dentro de la ventana de retención está todo.
    expect(todo).toContain('la-primera');
    expect(todo).toContain('la-tercera');
  });

  it('y lo que se sale de la ventana de retención se tira, que es lo que se prometió', async () => {
    const path = enUnDirectorio();
    const recorder = fileRecorder({ path, maxBytes: 300, keep: 1 });

    recorder.record(decision({ code: 'la-mas-antigua' }));
    for (let indice = 0; indice < 5; indice += 1) recorder.record(decision({ code: `motivo-${indice}` }));
    await recorder.close();

    const todo = readdirSync(join(path, '..'))
      .map((fichero) => readFileSync(join(path, '..', fichero), 'utf8'))
      .join('');
    expect(todo).not.toContain('la-mas-antigua');
    expect(todo).toContain('motivo-4');
  });
});

describe('un fallo al escribir se dice, y no aborta lo ya ejecutado', () => {
  it('se avisa por el camino de error, con el fichero que falló', async () => {
    // Que la auditoría falle en silencio es un fallo de seguridad; que revierta
    // una llamada al upstream que ya ocurrió sería peor.
    const directorio = mkdtempSync(join(tmpdir(), 'mcpizer-auditoria-'));
    const path = join(directorio, 'ocupado', 'auditoria.jsonl');
    // Donde debería ir el directorio hay un fichero: `mkdir` no puede.
    writeFileSync(join(directorio, 'ocupado'), 'no soy un directorio');

    const avisos: string[] = [];
    const recorder = fileRecorder({ path, onError: (mensaje) => avisos.push(mensaje) });

    expect(() => recorder.record(decision())).not.toThrow();
    await recorder.close();

    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain(path);
    expect(avisos[0]).toContain('sin registrar');
  });
});
