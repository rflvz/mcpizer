/**
 * `PolicySource` sobre git, contra un repositorio de verdad.
 *
 * "De verdad" es la palabra vinculante: se crea un repositorio local con el
 * binario `git` y se lee de él. Un doble del proceso `git` comprobaría que
 * sabemos escribir argumentos, y lo que hay que comprobar es que `fetch` sin
 * copia de trabajo trae lo que se espera y que un sha sirve de etiqueta de
 * versión.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseGitOrigin, policyGit } from '../src/policy-git.js';

const run = promisify(execFile);

const PRIMERA = 'version: 1\ncapabilities: []\n';
const SEGUNDA = 'version: 1\ncapabilities:\n  - id: crm.contact.read\n';

let repositorio: string;
let espejo: string;
let shaPrimera: string;
let shaSegunda: string;

beforeAll(async () => {
  repositorio = await mkdtemp(join(tmpdir(), 'mcpizer-repo-'));
  espejo = await mkdtemp(join(tmpdir(), 'mcpizer-espejo-'));

  const git = async (...args: string[]): Promise<string> =>
    (
      await run('git', ['-C', repositorio, ...args], {
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'arnes',
          GIT_AUTHOR_EMAIL: 'arnes@mcpizer.test',
          GIT_COMMITTER_NAME: 'arnes',
          GIT_COMMITTER_EMAIL: 'arnes@mcpizer.test',
        },
      })
    ).stdout;

  await git('init', '--quiet', '--initial-branch', 'main');
  await writeFile(join(repositorio, 'politica.yaml'), PRIMERA);
  await git('add', 'politica.yaml');
  await git('commit', '--quiet', '-m', 'la primera');
  shaPrimera = (await git('rev-parse', 'HEAD')).trim();

  await writeFile(join(repositorio, 'politica.yaml'), SEGUNDA);
  await git('commit', '--quiet', '-am', 'la segunda');
  shaSegunda = (await git('rev-parse', 'HEAD')).trim();
});

describe('lee el artefacto a la referencia declarada', () => {
  it('trae el contenido sin copia de trabajo', async () => {
    const source = policyGit({
      repository: repositorio,
      ref: 'refs/heads/main',
      path: 'politica.yaml',
      mirror: espejo,
    });
    const artefacto = await source.load();

    expect(artefacto.text).toBe(SEGUNDA);
    expect(artefacto.origin).toBe(`${repositorio}#refs/heads/main:politica.yaml`);
  });

  it('la etiqueta de versión es el sha del commit, no un resumen del texto', async () => {
    const source = policyGit({
      repository: repositorio,
      ref: 'refs/heads/main',
      path: 'politica.yaml',
      mirror: espejo,
    });
    expect((await source.load()).version).toBe(shaSegunda);
  });

  it('una referencia fija sigue dando lo de esa referencia aunque la rama avance', async () => {
    const source = policyGit({
      repository: repositorio,
      ref: shaPrimera,
      path: 'politica.yaml',
      mirror: await mkdtemp(join(tmpdir(), 'mcpizer-espejo-')),
    });
    const artefacto = await source.load();

    expect(artefacto.text).toBe(PRIMERA);
    expect(artefacto.version).toBe(shaPrimera);
  });
});

describe('nunca produce una política vacía', () => {
  it('un repositorio inalcanzable falla el arranque', async () => {
    const source = policyGit({
      repository: join(tmpdir(), 'no-existe-este-repositorio'),
      ref: 'refs/heads/main',
      path: 'politica.yaml',
      mirror: await mkdtemp(join(tmpdir(), 'mcpizer-espejo-')),
    });
    await expect(source.load()).rejects.toThrow(/No se pudo traer/);
  });

  it('un fichero que no está en ese commit falla el arranque', async () => {
    const source = policyGit({
      repository: repositorio,
      ref: 'refs/heads/main',
      path: 'no-esta.yaml',
      mirror: espejo,
    });
    await expect(source.load()).rejects.toThrow(/no contiene/);
  });
});

describe('la forma `git+<url>#<ref>:<ruta>`', () => {
  it('separa repositorio, referencia y ruta', () => {
    expect(parseGitOrigin('git+https://host/equipo/repo.git#refs/heads/main:politicas/prod.yaml')).toEqual({
      repository: 'https://host/equipo/repo.git',
      ref: 'refs/heads/main',
      path: 'politicas/prod.yaml',
    });
  });

  it('lo que no empieza por `git+` no es suyo', () => {
    expect(parseGitOrigin('examples/policy.yaml')).toBeUndefined();
  });

  it('sin referencia no se adivina una: se dice cuál es la forma', () => {
    expect(() => parseGitOrigin('git+https://host/repo.git')).toThrow(/git\+<url>#<ref>:<ruta>/);
  });

  it('sin fichero tampoco', () => {
    expect(() => parseGitOrigin('git+https://host/repo.git#refs/heads/main')).toThrow(/git\+<url>#<ref>:<ruta>/);
  });
});
