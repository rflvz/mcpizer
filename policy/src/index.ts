/**
 * `policy` — ¿qué se ha declarado, y está bien declarado?
 *
 * Autoría y validación del artefacto declarativo: parsear, validar, compilar a
 * un modelo evaluable y producir diagnósticos utilizables.
 *
 * Esta es la superficie pública completa del contexto. Lo no exportado aquí es
 * interior, y el gestor de módulos impide alcanzarlo.
 */
export { compile, type CompileOptions, type CompileResult } from './compile.js';
export {
  hasErrors,
  type Diagnostic,
  type DiagnosticCode,
  type DiagnosticSeverity,
  type DocumentPosition,
  type RelatedLocation,
} from './diagnostics.js';
export { pointer, readDocument, type PolicyDocument } from './document.js';
export {
  windowMillis,
  type CompiledAccount,
  type CompiledCapability,
  type CompiledGrant,
  type CompiledIssuer,
  type CompiledLimits,
  type CompiledPolicy,
  type CompiledToolMapping,
  type CompiledUpstream,
  type IssuerKind,
  type PolicyAnchors,
  type ToolIdentity,
  type TransportKind,
} from './model.js';
export { schema } from './structure.js';
