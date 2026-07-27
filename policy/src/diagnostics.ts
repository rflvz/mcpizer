/**
 * El vocabulario de diagnóstico de `policy`: documentos, reglas, posiciones
 * dentro de un fichero y errores de autoría.
 *
 * Es deliberadamente distinto del vocabulario de `access`, que habla de
 * decisiones y motivos. Un diagnóstico de aquí es "esta concesión referencia una
 * cuenta que no existe"; un resultado de allí es "denegado porque ninguna
 * concesión cubre esta capacidad". Fusionarlos forzaría un modelo único
 * compartido (decisión 0003).
 */

/** Una posición real del documento: lo que hace útil el bucle de corrección. */
export interface DocumentPosition {
  /** Línea, empezando en 1. */
  readonly line: number;
  /** Columna, empezando en 1. */
  readonly column: number;
  /** Desplazamiento en caracteres desde el principio del documento. */
  readonly offset: number;
}

/**
 * Vocabulario cerrado. Un consumidor puede ramificar exhaustivamente y saber
 * que no le va a llegar un código que no contempla.
 */
export type DiagnosticCode =
  | 'yaml_syntax'
  | 'schema_violation'
  | 'duplicate_id'
  | 'unknown_capability_in_grant'
  | 'unknown_capability_in_tool'
  | 'unknown_account_in_grant'
  | 'unknown_issuer_in_grant'
  | 'ambiguous_grant'
  | 'capability_not_realized'
  | 'unused_account'
  | 'tool_not_in_catalog'
  | 'catalog_tool_unmapped'
  | 'attribute_not_declared'
  | 'claim_mapping_expected';

export type DiagnosticSeverity = 'error' | 'warning';

/** Otra posición implicada en el mismo diagnóstico: la segunda concesión ambigua, por ejemplo. */
export interface RelatedLocation {
  readonly path: string;
  readonly position: DocumentPosition | undefined;
  readonly note: string;
}

export interface Diagnostic {
  readonly severity: DiagnosticSeverity;
  readonly code: DiagnosticCode;
  readonly message: string;
  /** Puntero RFC 6901 al lugar del artefacto que lo origina. */
  readonly path: string;
  readonly position: DocumentPosition | undefined;
  readonly related: readonly RelatedLocation[];
}

export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === 'error');
}
