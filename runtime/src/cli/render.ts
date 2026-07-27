/**
 * Presentación de los resultados en seco.
 *
 * Todo lo que señala un sitio se imprime como `fichero:línea:columna`, que es lo
 * que un editor sabe abrir: el bucle de corrección del invariante 4 depende de
 * que ir al sitio señalado sea un gesto, no una búsqueda.
 */
import type { Decision, ReasonCode } from '@mcpizer/access';
import type { Diagnostic, DocumentPosition } from '@mcpizer/policy';
import type { AuthenticationProblem } from '@mcpizer/principals';
import type { DecisionChange, Explanation, ReachReport } from '../dry-run.js';
import type { CallOutcome } from '../gateway.js';

export function at(origin: string, position: DocumentPosition | undefined): string {
  return position === undefined ? origin : `${origin}:${position.line}:${position.column}`;
}

/**
 * La prosa de cada motivo, en un solo sitio.
 *
 * La pasarela la comparte con `explain`: que la denegación que recibe un cliente
 * MCP y la que imprime la verificación en seco digan lo mismo es lo que hace que
 * el bucle de corrección funcione igual desde los dos lados.
 */
export const REASONS: Readonly<Record<ReasonCode, string>> = {
  granted: 'una concesión lo cubre',
  capability_not_declared: 'la capacidad no está declarada',
  capability_not_realized: 'ninguna tool declarada realiza la capacidad',
  no_grant_matches: 'ninguna concesión cubre esta capacidad para este principal',
  ambiguous_grant: 'dos concesiones la cubren con cuentas distintas',
  account_disabled: 'la cuenta está deshabilitada',
  usage_unknown: 'el uso acumulado es desconocido, y eso se trata como techo agotado',
  limit_exhausted: 'el techo de la concesión está agotado',
};

export const PROBLEMS: Readonly<Record<AuthenticationProblem, string>> = {
  credential_missing: 'no llega ninguna identidad',
  credential_invalid: 'la credencial no es válida',
  credential_expired: 'la credencial ha caducado',
  issuer_unknown: 'el emisor no está declarado en el artefacto',
};

export function renderDiagnostics(origin: string, diagnostics: readonly Diagnostic[]): string[] {
  const lines: string[] = [];
  for (const diagnostic of diagnostics) {
    lines.push(`${at(origin, diagnostic.position)}  ${diagnostic.severity}  ${diagnostic.code}`);
    lines.push(`    ${diagnostic.message}`);
    lines.push(`    en ${diagnostic.path === '' ? '<documento>' : diagnostic.path}`);
    for (const related of diagnostic.related) {
      lines.push(`    ${related.note}: ${at(origin, related.position)}  ${related.path}`);
    }
    lines.push('');
  }
  return lines;
}

/**
 * Lo que un cliente MCP lee cuando su invocación no se ejecuta.
 *
 * Cada caso dice **qué pasó y dónde tocar**, que es el invariante 4 llevado
 * hasta el borde: quien configura el sistema recibe la denegación con el sitio
 * exacto y no tiene que adivinar. Y los casos se mantienen distinguibles —una
 * denegación de política no se parece a un proveedor caído— porque confundirlos
 * haría inútil ese bucle.
 */
export function renderCallOutcome(origin: string, outcome: CallOutcome): string {
  switch (outcome.kind) {
    case 'invoked':
      return '';
    case 'unauthenticated':
      return `mcpizer: sin principal — ${outcome.problem}: ${PROBLEMS[outcome.problem]}.`;
    case 'unknown-tool':
      return (
        `mcpizer: \`${outcome.name}\` no es ninguna tool declarada. ` +
        'Lo no declarado no se expone, así que tampoco se invoca.'
      );
    case 'denied':
      return (
        `mcpizer: denegado — ${outcome.reason.code}: ${REASONS[outcome.reason.code]}.\n` +
        `El sitio a tocar es ${at(origin, outcome.position)} (${outcome.reason.path}).`
      );
    case 'credential-failed':
      return (
        `mcpizer: la cuenta \`${outcome.account}\` estaba autorizada y su credencial no se pudo resolver: ` +
        `${outcome.detail}. No se ejecuta nada sin credencial.`
      );
    case 'upstream-failed':
      return `mcpizer: el upstream \`${outcome.upstreamId}\` falló: ${outcome.detail}. No es una denegación de política.`;
  }
}

function renderDecision(origin: string, decision: Decision, position: DocumentPosition | undefined): string[] {
  const lines = [
    decision.outcome === 'allow' ? 'PERMITIDO' : 'DENEGADO',
    `  motivo    ${decision.reason.code} — ${REASONS[decision.reason.code]}`,
  ];
  if (decision.reason.subject !== undefined) lines.push(`  sobre     ${decision.reason.subject}`);
  lines.push(`  sitio     ${at(origin, position)}  ${decision.reason.path}`);
  if (decision.outcome === 'allow') {
    lines.push(`  cuenta    ${decision.account.id}`);
    lines.push(
      `  techo     ${decision.limits === undefined ? 'sin techo declarado' : `${decision.limits.calls} llamadas por ${decision.limits.per}`}`,
    );
  }
  return lines;
}

export function renderExplanation(origin: string, explanation: Explanation): string[] {
  if (!explanation.resolution.ok) {
    return [
      'SIN PRINCIPAL',
      `  motivo    ${explanation.resolution.problem} — ${PROBLEMS[explanation.resolution.problem]}`,
      ...(explanation.resolution.detail === undefined ? [] : [`  detalle   ${explanation.resolution.detail}`]),
    ];
  }

  const lines: string[] = [];
  const { principal, discarded } = explanation.resolution;
  const attributes = Object.entries(principal.attributes)
    .map(([name, value]) => `${name}=${value}`)
    .join(' ');
  lines.push(`principal   ${principal.id}${attributes === '' ? '' : `  [${attributes}]`}`);
  if (discarded.length > 0) {
    lines.push(`            descartados por no estar declarados: ${discarded.join(', ')}`);
  }
  lines.push('');

  if (explanation.decision === undefined) return lines;
  lines.push(...renderDecision(origin, explanation.decision, explanation.position));
  if (explanation.tools.length > 0) {
    lines.push(`  ve        ${explanation.tools.map((tool) => `${tool.upstreamId}/${tool.name}`).join(', ')}`);
  }
  return lines;
}

export function renderReach(origin: string, report: ReachReport): string[] {
  const { reachability } = report;
  if (!reachability.declared) {
    return [`La capacidad \`${reachability.capability}\` no está declarada en el artefacto.`];
  }

  const lines = [`Quién llega a \`${reachability.capability}\`:`, ''];
  if (reachability.through.length === 0) {
    lines.push('  nadie. La capacidad existe y ninguna concesión la nombra.');
  }
  for (const entry of reachability.through) {
    const selector = Object.entries(entry.attributes)
      .map(([name, value]) => `${name}=${value}`)
      .join(' ');
    lines.push(`  emisor ${entry.issuer}${selector === '' ? '' : `  [${selector}]`}`);
    lines.push(`    con la cuenta   ${entry.account.id}${entry.account.disabled ? '  (deshabilitada)' : ''}`);
    lines.push(
      `    bajo el techo   ${entry.limits === undefined ? 'sin techo declarado' : `${entry.limits.calls} por ${entry.limits.per}`}`,
    );
    lines.push(`    declarado en    ${at(origin, report.positions[entry.path])}  ${entry.path}`);
    lines.push('');
  }
  if (!reachability.realized) {
    lines.push('Aviso: ninguna tool declarada realiza esta capacidad, así que concederla no expone nada.');
  } else {
    lines.push(`La realizan: ${report.tools.map((tool) => `${tool.upstreamId}/${tool.name}`).join(', ')}`);
  }
  return lines;
}

export function renderDiff(changes: readonly DecisionChange[]): string[] {
  if (changes.length === 0) return ['Ninguna decisión cambia entre las dos versiones.'];

  const lines = [`${changes.length} decisión(es) cambian:`, ''];
  for (const change of changes) {
    const selector = Object.entries(change.attributes)
      .map(([name, value]) => `${name}=${value}`)
      .join(' ');
    const describe = (summary: DecisionChange['before']): string =>
      summary === undefined
        ? 'la capacidad no existía'
        : `${summary.outcome === 'allow' ? 'permitido' : 'denegado'} (${summary.code}${summary.account === undefined ? '' : `, cuenta ${summary.account}`})`;
    lines.push(`  ${change.issuer}${selector === '' ? '' : `  [${selector}]`}  →  ${change.capability}`);
    lines.push(`    antes   ${describe(change.before)}`);
    lines.push(`    ahora   ${describe(change.after)}`);
    lines.push('');
  }
  return lines;
}
