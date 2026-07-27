/**
 * `docs/diseno/verificacion.md` §2.3 — frontera explicitada.
 *
 * La sección 3 de la arquitectura exige que la declaración de frontera "no sea
 * un comentario ni una convención de nombres". Aquí se comprueba en los dos
 * niveles: el manifiesto declara una entrada única, y el import profundo es un
 * error de resolución de módulos en tiempo de ejecución.
 */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { undeclaredSurfaces, workspacePackages } from '../lib/workspace.js';
import { FIXTURES, importWithNode, REPO_ROOT } from '../lib/run-checks.js';
import { PACKAGES } from '../rules/packages.js';

describe('cada paquete declara una superficie pública única', () => {
  it('los siete paquetes están presentes', () => {
    const dirs = workspacePackages(REPO_ROOT).map((pkg) => pkg.dir);
    expect(dirs.sort()).toEqual([...PACKAGES].sort());
  });

  it('ninguno se salta la declaración', () => {
    expect(undeclaredSurfaces(REPO_ROOT)).toEqual([]);
  });

  it('falla cuando un paquete no declara `exports`', () => {
    expect(undeclaredSurfaces(join(FIXTURES, 'missing-exports-field'))).not.toEqual([]);
  });

  it('falla cuando un paquete parte su superficie en varias entradas', () => {
    expect(undeclaredSurfaces(join(FIXTURES, 'split-surface'))).not.toEqual([]);
  });
});

describe('el import profundo no resuelve', () => {
  it('la entrada declarada sí carga', async () => {
    await expect(importWithNode('@mcpizer/access')).resolves.toEqual({ ok: true, code: 'OK' });
  });

  it('alcanzar el interior es un error de resolución, no un aviso', async () => {
    const deep = await importWithNode('@mcpizer/access/dist/index.js');
    expect(deep).toEqual({ ok: false, code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
  });
});
