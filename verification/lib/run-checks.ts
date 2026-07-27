/**
 * Ejecuta las herramientas reales — dependency-cruiser y ESLint — contra una
 * raíz cualquiera, con la misma configuración que corre en CI.
 *
 * El caso de fallo de una comprobación solo demuestra algo si ejecuta la regla
 * de verdad. Por eso aquí no se reimplementa ninguna: se invocan las mismas.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import type { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { corePurityRules } from '../rules/purity.js';
import { workspacePackages } from './workspace.js';

const execFileAsync = promisify(execFile);

export const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const FIXTURES = join(REPO_ROOT, 'verification', 'fixtures', 'violations');

const DEPCRUISE_BIN = join(REPO_ROOT, 'node_modules', '.bin', 'depcruise');
const DEPCRUISE_CONFIG = join(REPO_ROOT, '.dependency-cruiser.js');

export interface GraphViolation {
  readonly rule: string;
  readonly from: string;
  readonly to: string;
}

/**
 * Recorre el grafo de imports de `root` con las reglas de
 * `verification/rules/dependency-rules.js` y devuelve las violaciones.
 */
export async function cruise(root: string): Promise<GraphViolation[]> {
  const targets = workspacePackages(root)
    .map((pkg) => join(pkg.dir, 'src'))
    .filter((dir) => existsSync(join(root, dir)));
  if (targets.length === 0) throw new Error(`Sin paquetes que recorrer en ${root}`);

  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(
      DEPCRUISE_BIN,
      ['--config', DEPCRUISE_CONFIG, '--output-type', 'json', ...targets],
      { cwd: root, maxBuffer: 32 * 1024 * 1024 },
    ));
  } catch (error) {
    // depcruise sale con código distinto de cero cuando encuentra violaciones;
    // el informe sigue estando en stdout.
    const failure = error as { stdout?: string; stderr?: string };
    if (typeof failure.stdout !== 'string' || failure.stdout === '') {
      throw new Error(`depcruise falló en ${root}: ${failure.stderr ?? String(error)}`);
    }
    stdout = failure.stdout;
  }

  const report = JSON.parse(stdout) as {
    summary: { violations: { rule: { name: string }; from: string; to: string }[] };
  };
  return report.summary.violations.map((violation) => ({
    rule: violation.rule.name,
    from: violation.from,
    to: violation.to,
  }));
}

/**
 * Aplica el bloque de pureza de `verification/rules/purity.js` a los ficheros
 * indicados, con la misma configuración de parser que `eslint.config.js`.
 */
export async function lintForPurity(root: string, patterns: string[]): Promise<Linter.LintMessage[]> {
  const eslint = new ESLint({
    cwd: root,
    errorOnUnmatchedPattern: false,
    overrideConfigFile: true,
    overrideConfig: tseslint.config({
      files: ['**/*.ts'],
      languageOptions: { parser: tseslint.parser },
      rules: corePurityRules,
    }) as ESLint.Options['overrideConfig'],
  });
  const results = await eslint.lintFiles(patterns.filter((pattern) => existsSync(join(root, pattern))));
  return results.flatMap((result) => result.messages);
}

/**
 * Resuelve un especificador con el gestor de módulos de Node, en un proceso
 * aparte.
 *
 * El punto de §2.3 es que la frontera la sostenga el propio gestor de módulos.
 * Comprobarlo dentro del ejecutor de tests mediría el resolutor del ejecutor,
 * que no es el que corre en producción.
 */
export async function importWithNode(specifier: string): Promise<{ ok: boolean; code: string }> {
  const script = `import(${JSON.stringify(specifier)}).then(
    () => { console.log('OK'); },
    (error) => { console.log(error?.code ?? 'SIN_CÓDIGO'); },
  );`;
  const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: REPO_ROOT,
  });
  const code = stdout.trim();
  return { ok: code === 'OK', code };
}
