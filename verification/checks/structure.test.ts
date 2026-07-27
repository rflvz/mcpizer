/**
 * `docs/diseno/verificacion.md` §2.2 (prohibición de paquete común) y §3.5
 * (legibilidad estructural).
 *
 * Las dos son listas de nombres prohibidos, admitidamente toscas. Atacan la
 * forma exacta en que estas reglas se erosionan: nadie añade un import
 * prohibido ni renombra una carpeta a `services/`; alguien crea un paquete
 * común "solo para los ids" y seis meses después es el modelo compartido.
 */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { forbiddenPackages, forbiddenTopLevelNames } from '../lib/workspace.js';
import { FIXTURES, REPO_ROOT } from '../lib/run-checks.js';

describe('no existe ningún paquete común', () => {
  it('ni `shared`, ni `common`, ni `core`, ni `kernel`, ni `types`', () => {
    expect(forbiddenPackages(REPO_ROOT)).toEqual([]);
  });

  it('falla cuando alguien añade un paquete `shared`', () => {
    expect(forbiddenPackages(join(FIXTURES, 'forbidden-package-name'))).not.toEqual([]);
  });
});

describe('la estructura de primer nivel se lee como el dominio', () => {
  it('no hay nombres técnicos en el primer nivel', () => {
    expect(forbiddenTopLevelNames(REPO_ROOT)).toEqual([]);
  });

  it('falla cuando aparece un `utils/`', () => {
    expect(forbiddenTopLevelNames(join(FIXTURES, 'forbidden-top-level-name'))).not.toEqual([]);
  });
});
