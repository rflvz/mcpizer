/**
 * Escáneres estructurales sobre un árbol de repositorio.
 *
 * Cada función recibe la raíz sobre la que trabajar, de modo que la misma
 * comprobación se puede ejecutar contra este repositorio y contra un fixture de
 * violación. Es lo que hace literal la regla de `docs/sesiones.md` §2: *una
 * comprobación que nunca ha fallado no está verificada*.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  CONTEXTS,
  FORBIDDEN_PACKAGE_NAMES,
  FORBIDDEN_TOP_LEVEL_NAMES,
} from '../rules/packages.js';
import { DOUBLE_MARKERS } from '../rules/purity.js';

export interface WorkspacePackage {
  /** Nombre del directorio de primer nivel. */
  readonly dir: string;
  /** Nombre declarado en el manifiesto, sin el ámbito. */
  readonly name: string;
  readonly manifest: Record<string, unknown>;
}

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', '.github']);

function topLevelDirs(root: string): string[] {
  return readdirSync(root)
    .filter((entry) => !IGNORED_DIRS.has(entry) && !entry.startsWith('.'))
    .filter((entry) => statSync(join(root, entry)).isDirectory())
    .sort();
}

/** Descubre los paquetes del workspace: todo directorio de primer nivel con manifiesto. */
export function workspacePackages(root: string): WorkspacePackage[] {
  const packages: WorkspacePackage[] = [];
  for (const dir of topLevelDirs(root)) {
    let raw: string;
    try {
      raw = readFileSync(join(root, dir, 'package.json'), 'utf8');
    } catch {
      continue;
    }
    const manifest = JSON.parse(raw) as Record<string, unknown>;
    const declared = typeof manifest['name'] === 'string' ? manifest['name'] : dir;
    packages.push({ dir, name: declared.replace(/^@[^/]+\//, ''), manifest });
  }
  return packages;
}

/**
 * §2.3 — Frontera explicitada.
 *
 * Cada paquete declara `exports` con **una única entrada**. Es lo que convierte
 * el import profundo en un error de resolución de módulos y no en un aviso
 * silenciable (decisión 0001).
 */
export function undeclaredSurfaces(root: string): string[] {
  const problems: string[] = [];
  for (const pkg of workspacePackages(root)) {
    const exports = pkg.manifest['exports'];
    if (exports === undefined) {
      problems.push(`${pkg.dir}: el manifiesto no declara \`exports\`; no tiene superficie pública.`);
      continue;
    }
    if (typeof exports !== 'object' || exports === null || Array.isArray(exports)) {
      problems.push(`${pkg.dir}: \`exports\` no es un mapa de entradas.`);
      continue;
    }
    const entries = Object.keys(exports);
    if (entries.length !== 1 || entries[0] !== '.') {
      problems.push(
        `${pkg.dir}: \`exports\` declara ${entries.length} entradas (${entries.join(', ')}); ` +
          'la superficie pública tiene que ser exactamente una.',
      );
    }
  }
  return problems;
}

/**
 * §2.2 — No existe paquete común.
 *
 * Ataca la forma real en que la regla de cero aristas se erosiona: nadie añade
 * un import prohibido, alguien crea un paquete "solo para los ids".
 */
export function forbiddenPackages(root: string): string[] {
  return workspacePackages(root)
    .filter((pkg) => FORBIDDEN_PACKAGE_NAMES.includes(pkg.name) || FORBIDDEN_PACKAGE_NAMES.includes(pkg.dir))
    .map(
      (pkg) =>
        `${pkg.dir}: nombre de paquete prohibido (decisión 0004). ` +
        'Si dos contextos necesitan el mismo concepto, la frontera está mal puesta.',
    );
}

/** §3.5 — Legibilidad estructural: nombres técnicos prohibidos en el primer nivel. */
export function forbiddenTopLevelNames(root: string): string[] {
  return topLevelDirs(root)
    .filter((dir) => FORBIDDEN_TOP_LEVEL_NAMES.includes(dir))
    .map((dir) => `${dir}/: nombre técnico en el primer nivel; la estructura debe leerse como el dominio.`);
}

function sourceFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...sourceFiles(full));
    else if (full.endsWith('.ts') || full.endsWith('.js')) files.push(full);
  }
  return files;
}

/**
 * §2.4.3 — Señal secundaria: los tests del dominio no usan dobles.
 *
 * Es más débil que la prohibición estática, y cubre lo que a esta se le escapa:
 * si probar el núcleo empieza a necesitar simular algo, el núcleo ha dejado de
 * ser una función aunque siga sin importar nada prohibido.
 */
export function doublesInContextTests(root: string): string[] {
  const problems: string[] = [];
  for (const context of CONTEXTS) {
    for (const file of sourceFiles(join(root, context, 'test'))) {
      const contents = readFileSync(file, 'utf8');
      for (const marker of DOUBLE_MARKERS) {
        if (contents.includes(marker)) {
          problems.push(
            `${relative(root, file)}: usa \`${marker}\`. El núcleo es una función de datos a datos; ` +
              'si probarlo necesita un doble, el invariante 2 está roto.',
          );
        }
      }
    }
  }
  return problems;
}
