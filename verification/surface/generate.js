/**
 * `docs/diseno/verificacion.md` §3.1 — blast radius.
 *
 * Genera un retrato de la superficie pública de cada contexto a partir de su
 * punto de entrada declarado, y lo versiona. El criterio se lee así en la
 * práctica: si un PR cambia el interior de un contexto y en el diff aparece el
 * retrato de **otro**, la frontera no está comprando lo que promete.
 *
 *   node verification/surface/generate.js --write   regenera los retratos
 *   node verification/surface/generate.js --check   falla si alguno ha cambiado
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { PORTRAYED } from '../rules/packages.js';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const HERE = fileURLToPath(new URL('.', import.meta.url));

const COMPILER_OPTIONS = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  strict: true,
  skipLibCheck: true,
  noEmit: true,
};

/** Texto de la declaración de un símbolo exportado, sin comentarios ni cuerpo. */
function render(checker, exported) {
  // Un `export { X } from './x.js'` llega como alias; lo que interesa retratar
  // es la declaración a la que apunta, no el reexport.
  const symbol =
    (exported.flags & ts.SymbolFlags.Alias) === 0 ? exported : checker.getAliasedSymbol(exported);
  const declarations = symbol.getDeclarations() ?? [];
  const rendered = [];
  for (const declaration of declarations) {
    if (
      ts.isInterfaceDeclaration(declaration) ||
      ts.isTypeAliasDeclaration(declaration) ||
      ts.isEnumDeclaration(declaration)
    ) {
      rendered.push(declaration.getText());
    } else {
      const type = checker.getTypeOfSymbolAtLocation(symbol, declaration);
      rendered.push(`declare const ${exported.getName()}: ${checker.typeToString(type)};`);
    }
  }
  return rendered.length > 0 ? rendered.join('\n') : `declare const ${exported.getName()}: unknown;`;
}

function surfaceOf(context) {
  const entry = join(REPO_ROOT, context, 'src', 'index.ts');
  const program = ts.createProgram([entry], COMPILER_OPTIONS);
  const source = program.getSourceFile(entry);
  if (source === undefined) throw new Error(`Sin punto de entrada para ${context}`);

  const checker = program.getTypeChecker();
  const moduleSymbol = checker.getSymbolAtLocation(source);
  const exported = moduleSymbol === undefined ? [] : checker.getExportsOfModule(moduleSymbol);

  const body = exported
    .slice()
    .sort((a, b) => a.getName().localeCompare(b.getName()))
    .map((symbol) => render(checker, symbol))
    .join('\n\n');

  return `// Retrato de la superficie pública de \`${context}\`.\n// Generado por \`pnpm surface\`; no se edita a mano.\n\n${body}\n`;
}

const mode = process.argv[2] ?? '--check';
const stale = [];

for (const context of PORTRAYED) {
  const target = join(HERE, `${context}.d.ts`);
  const current = surfaceOf(context);
  if (mode === '--write') {
    writeFileSync(target, current);
    continue;
  }
  let committed = '';
  try {
    committed = readFileSync(target, 'utf8');
  } catch {
    stale.push(`${context}: no hay retrato versionado.`);
    continue;
  }
  if (committed !== current) stale.push(`${context}: la superficie pública ha cambiado.`);
}

if (mode === '--write') {
  console.log(`Retratos regenerados para: ${PORTRAYED.join(', ')}.`);
} else if (stale.length > 0) {
  console.error(stale.join('\n'));
  console.error('\nSi el cambio es deliberado, ejecuta `pnpm surface` y revisa el diff.');
  process.exit(1);
} else {
  console.log(`La superficie pública de ${PORTRAYED.join(', ')} no ha cambiado.`);
}
