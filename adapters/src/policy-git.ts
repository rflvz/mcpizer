/**
 * `PolicySource` sobre un repositorio git a una referencia fija.
 *
 * Es el modo esperado en cuanto hay más de una persona: la política se revisa
 * por PR y la pasarela lee exactamente lo que se aprobó
 * (`docs/diseno/puertos.md` §2.2).
 *
 * Frente al fichero local cambian dos cosas que el contrato del puerto no ve
 * pero que son la razón de que esta implementación exista:
 *
 * 1. **La etiqueta de versión es el sha del commit**, no un resumen del texto.
 *    El contrato pide "una etiqueta que permita saber si ha cambiado"; un sha lo
 *    hace y además dice *qué* cambió y quién lo aprobó, que un hash de contenido
 *    no puede.
 * 2. **No hay copia de trabajo.** Se lee el blob del objeto, sin `checkout`: no
 *    hay directorio que pueda quedar sucio ni fichero que otro proceso pueda
 *    tocar entre la lectura y la decisión.
 */
import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface LoadedArtifact {
  readonly text: string;
  /** Etiqueta que permite saber si el artefacto ha cambiado. Aquí, el sha del commit. */
  readonly version: string;
  readonly origin: string;
}

export interface GitOrigin {
  /** Cualquier cosa que `git fetch` acepte: URL remota o ruta local. */
  readonly repository: string;
  /** La referencia, fija a propósito: `refs/heads/main`, una etiqueta o un sha. */
  readonly ref: string;
  /** La ruta del artefacto **dentro** del repositorio. */
  readonly path: string;
  /** Dónde vive el espejo. Por defecto, un directorio derivado del repositorio bajo el temporal. */
  readonly mirror?: string;
}

/**
 * Interpreta `git+<url>#<ref>:<ruta>`.
 *
 * El `#` separa lo que identifica al repositorio de lo que identifica al
 * artefacto dentro de él, y el `:` es el mismo separador que usa git en
 * `<commit>:<ruta>`. Así la CLI acepta un solo argumento posicional y no hace
 * falta una bandera nueva por cada pieza.
 */
export function parseGitOrigin(specifier: string): GitOrigin | undefined {
  if (!specifier.startsWith('git+')) return undefined;

  const sinPrefijo = specifier.slice('git+'.length);
  const almohadilla = sinPrefijo.indexOf('#');
  if (almohadilla <= 0) {
    throw new Error(`\`${specifier}\` no dice a qué referencia ir. La forma es \`git+<url>#<ref>:<ruta>\`.`);
  }

  const repository = sinPrefijo.slice(0, almohadilla);
  const resto = sinPrefijo.slice(almohadilla + 1);
  const dosPuntos = resto.indexOf(':');
  if (dosPuntos <= 0 || dosPuntos === resto.length - 1) {
    throw new Error(`\`${specifier}\` no dice qué fichero leer. La forma es \`git+<url>#<ref>:<ruta>\`.`);
  }

  return { repository, ref: resto.slice(0, dosPuntos), path: resto.slice(dosPuntos + 1) };
}

/** Un nombre de directorio estable para un repositorio, sin caracteres de ruta. */
function mirrorName(repository: string): string {
  return `mcpizer-git-${repository.replace(/[^a-zA-Z0-9._-]/g, '-')}`;
}

/**
 * Un origen inalcanzable, una referencia que no existe o un fichero que no está
 * en ese commit producen **arranque fallido**, nunca una política vacía: una
 * política vacía sería sintácticamente válida y lo denegaría todo, que es seguro
 * pero indistinguible de un fallo de infraestructura.
 */
export function policyGit(origin: GitOrigin): { load(): Promise<LoadedArtifact> } {
  const mirror = origin.mirror ?? join(tmpdir(), mirrorName(origin.repository));

  const git = async (...args: string[]): Promise<string> => {
    const { stdout } = await run('git', ['-C', mirror, ...args], {
      maxBuffer: 32 * 1024 * 1024,
      // Ni prompt de credenciales ni editor: un arranque no interactivo que se
      // queda esperando a un humano es peor que uno que falla.
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
    });
    return stdout;
  };

  return {
    async load(): Promise<LoadedArtifact> {
      const origen = `${origin.repository}#${origin.ref}:${origin.path}`;

      try {
        await mkdir(mirror, { recursive: true });
        // Un repositorio desnudo: sin copia de trabajo que ensuciar. `git init`
        // sobre uno ya inicializado es idempotente, así que el espejo se
        // reutiliza entre arranques sin traerse la historia otra vez.
        await git('init', '--bare', '--quiet');
      } catch (cause) {
        throw new Error(`No se pudo preparar el espejo de \`${origin.repository}\` en \`${mirror}\`.`, { cause });
      }

      try {
        await git('fetch', '--depth', '1', '--quiet', origin.repository, origin.ref);
      } catch (cause) {
        throw new Error(`No se pudo traer \`${origin.ref}\` de \`${origin.repository}\`.`, { cause });
      }

      let version: string;
      try {
        version = (await git('rev-parse', 'FETCH_HEAD')).trim();
      } catch (cause) {
        throw new Error(`\`${origin.ref}\` no resuelve a ningún commit en \`${origin.repository}\`.`, { cause });
      }

      let text: string;
      try {
        // Plomería, no porcelana: `cat-file blob` no pagina, no colorea y no
        // depende de la configuración del usuario.
        text = await git('cat-file', 'blob', `${version}:${origin.path}`);
      } catch (cause) {
        throw new Error(`El commit \`${version.slice(0, 12)}\` no contiene \`${origin.path}\`.`, { cause });
      }

      return { text, version, origin: origen };
    },
  };
}
