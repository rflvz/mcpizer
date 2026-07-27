/**
 * `docs/diseno/verificacion.md` §2.1, §2.2 y §2.4.1 — las tres reglas sobre el
 * mismo grafo de imports, más el caso que hace fallar a cada una.
 *
 * La lista de fixtures es la parte que importa: `docs/sesiones.md` §2 dice que
 * una comprobación que nunca ha fallado no está verificada, porque sin ello una
 * sesión larga cree tener red y no la tiene.
 */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { cruise, FIXTURES, REPO_ROOT } from '../lib/run-checks.js';

describe('el grafo de imports de este repositorio', () => {
  it('no tiene ninguna violación', async () => {
    const violations = await cruise(REPO_ROOT);
    expect(violations).toEqual([]);
  });
});

const CASES = [
  {
    fixture: 'core-reaches-periphery',
    rule: 'core-must-not-reach-periphery',
    porque: 'un contexto importa `adapters/` directamente',
  },
  {
    fixture: 'core-reaches-periphery-transitively',
    rule: 'core-must-not-reach-periphery',
    porque: 'un contexto alcanza `runtime/` a dos saltos',
  },
  {
    fixture: 'context-imports-context',
    rule: 'no-cross-context-imports',
    porque: '`access` importa `principals`',
  },
  {
    fixture: 'core-uses-platform-module',
    rule: 'core-must-not-use-platform-modules',
    porque: '`policy` importa `node:fs`',
  },
  {
    fixture: 'adapters-imports-context',
    rule: 'adapters-must-not-import-contexts',
    porque: '`adapters` importa `accounts`',
  },
] as const;

describe('cada regla tiene un caso que la hace fallar', () => {
  it.each(CASES)('$rule falla cuando $porque', async ({ fixture, rule }) => {
    const violations = await cruise(join(FIXTURES, fixture));
    expect(violations.map((violation) => violation.rule)).toContain(rule);
  });
});
