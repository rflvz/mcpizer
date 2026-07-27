/**
 * `docs/diseno/verificacion.md` §2.4 — pureza del núcleo, capas 2 y 3.
 *
 * La capa 1 (prohibición estática de E/S) vive en el grafo de imports y se
 * comprueba en `dependency-graph.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { CONTEXTS } from '../rules/packages.js';
import { doublesInContextTests } from '../lib/workspace.js';
import { FIXTURES, lintForPurity, REPO_ROOT } from '../lib/run-checks.js';

describe('los cinco contextos son deterministas', () => {
  it('ninguno consulta reloj, aleatoriedad ni entorno', async () => {
    const patterns = CONTEXTS.flatMap((context) => [`${context}/src`, `${context}/test`]);
    const messages = await lintForPurity(REPO_ROOT, patterns);
    expect(messages.map((message) => message.message)).toEqual([]);
  });
});

const IMPURE = [
  { file: 'access/src/clock.ts', porque: 'usa `Date.now()` y `new Date()`' },
  { file: 'access/src/random.ts', porque: 'usa `Math.random()`' },
  { file: 'access/src/env.ts', porque: 'lee `process.env`' },
  { file: 'access/src/io.ts', porque: 'importa `node:fs`' },
] as const;

describe('la prohibición de no determinismo tiene un caso que la hace fallar', () => {
  it.each(IMPURE)('$file falla porque $porque', async ({ file }) => {
    const messages = await lintForPurity(join(FIXTURES, 'impure-core'), [file]);
    expect(messages.length).toBeGreaterThan(0);
  });
});

describe('los tests del dominio no usan dobles', () => {
  it('ningún test de contexto importa utilidades de simulación', () => {
    expect(doublesInContextTests(REPO_ROOT)).toEqual([]);
  });

  it('falla cuando un test de contexto usa `vi.mock`', () => {
    expect(doublesInContextTests(join(FIXTURES, 'test-with-double'))).not.toEqual([]);
  });
});
