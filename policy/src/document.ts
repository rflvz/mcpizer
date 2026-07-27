/**
 * El documento: texto YAML, valor navegable y resolución de punteros a
 * posiciones reales.
 *
 * `path` es la parte que hace útil un motivo (`docs/diseno/modelo.md` §4.1): un
 * motivo sin `path` deja al configurador buscando a ciegas. Se usa RFC 6901
 * porque es un puntero que navega el documento *y* que este módulo sabe llevar
 * hasta una línea y una columna concretas.
 */
import { LineCounter, parseDocument, type Document } from 'yaml';
import type { Diagnostic, DocumentPosition } from './diagnostics.js';

export interface PolicyDocument {
  readonly text: string;
  /** El documento como datos planos, listo para validar contra el esquema. */
  readonly value: unknown;
  /** Traduce un puntero RFC 6901 a una posición real, o `undefined` si no apunta a nada. */
  resolve(pointer: string): DocumentPosition | undefined;
}

/** Construye un puntero RFC 6901 a partir de segmentos, escapando `~` y `/`. */
export function pointer(...segments: readonly (string | number)[]): string {
  if (segments.length === 0) return '';
  return `/${segments.map((segment) => String(segment).replaceAll('~', '~0').replaceAll('/', '~1')).join('/')}`;
}

function segmentsOf(value: string): string[] {
  const trimmed = value.startsWith('#') ? value.slice(1) : value;
  if (trimmed === '' || trimmed === '/') return [];
  return trimmed
    .split('/')
    .slice(1)
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'));
}

function positionAt(document: Document, counter: LineCounter, segments: readonly string[]): DocumentPosition | undefined {
  const keys: (string | number)[] = segments.map((segment) => (/^\d+$/.test(segment) ? Number(segment) : segment));
  const node: unknown = keys.length === 0 ? document.contents : document.getIn(keys, true);
  const range = (node as { range?: readonly number[] } | null | undefined)?.range;
  if (range === undefined || range.length === 0) return undefined;
  const offset = range[0];
  if (offset === undefined) return undefined;
  const { line, col } = counter.linePos(offset);
  return { line, column: col, offset };
}

/**
 * Parsea el artefacto. Un fallo de sintaxis produce diagnósticos, nunca una
 * excepción: la CLI tiene que poder señalar el sitio.
 */
export function readDocument(text: string): {
  readonly document: PolicyDocument | undefined;
  readonly diagnostics: readonly Diagnostic[];
} {
  const counter = new LineCounter();
  const parsed = parseDocument(text, { lineCounter: counter, keepSourceTokens: true });

  const diagnostics: Diagnostic[] = parsed.errors.map((error) => {
    const offset = error.pos[0];
    const { line, col } = counter.linePos(offset);
    return {
      severity: 'error' as const,
      code: 'yaml_syntax' as const,
      message: error.message,
      path: '',
      position: { line, column: col, offset },
      related: [],
    };
  });

  if (diagnostics.length > 0) return { document: undefined, diagnostics };

  const document: PolicyDocument = {
    text,
    value: parsed.toJS({ maxAliasCount: 100 }) as unknown,
    resolve: (target) => positionAt(parsed, counter, segmentsOf(target)),
  };
  return { document, diagnostics: [] };
}
