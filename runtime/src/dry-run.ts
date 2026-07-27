/**
 * La verificación en seco: la superficie que hace real el invariante 8.
 *
 * Todo lo de aquí funciona sin red, sin credenciales y sin despliegue. Reúne los
 * hechos —el artefacto, el catálogo, el instante, el uso— y llama a la decisión;
 * ejecutar el efecto es lo único que no ocurre, porque en seco no hay efecto.
 */
import { evaluate, reach, visible, type Decision, type Instant, type PrincipalView, type Reachability, type Ruleset, type Usage } from '@mcpizer/access';
import { visibleTools, type ToolDescriptor } from '@mcpizer/capabilities';
import { compile, type CompiledPolicy, type Diagnostic, type DocumentPosition, type PolicyDocument, type ToolIdentity } from '@mcpizer/policy';
import { normalize, type Resolution } from '@mcpizer/principals';
import type { CatalogSource, PolicyArtifact, PolicySource } from './ports.js';
import { literalAttributes, wire, type Wiring } from './wiring.js';

export interface LoadedPolicy {
  readonly artifact: PolicyArtifact;
  readonly document: PolicyDocument | undefined;
  readonly policy: CompiledPolicy | undefined;
  readonly diagnostics: readonly Diagnostic[];
  /** Ausente cuando la política no compila: sin modelo evaluable no hay nada que cablear. */
  readonly wiring: Wiring | undefined;
}

/** Reúne los hechos y compila. Es el paso 1 de la cáscara. */
export async function loadPolicy(source: PolicySource, catalog?: CatalogSource): Promise<LoadedPolicy> {
  const artifact = await source.load();
  const discovered = catalog === undefined ? undefined : await catalog.toolsOf();
  const declared: readonly ToolIdentity[] | undefined =
    discovered?.map((tool) => ({ upstream: tool.upstreamId, name: tool.name }));

  const result = compile(artifact.text, { catalog: declared });
  return {
    artifact,
    document: result.document,
    policy: result.policy,
    diagnostics: result.diagnostics,
    wiring: result.policy === undefined ? undefined : wire(result.policy, discovered),
  };
}

export interface Question {
  readonly issuer: string;
  readonly subject: string;
  /** Atributos dados a mano. Se completan con los literales que declare el emisor. */
  readonly attributes: Readonly<Record<string, string>>;
  readonly capability: string;
  readonly at: Instant;
  readonly usage: Usage;
}

export interface Explanation {
  readonly resolution: Resolution;
  /** Ausente si el principal no resuelve: sin quién invoca no hay nada que decidir. */
  readonly decision: Decision | undefined;
  /** El sitio exacto a tocar. Es lo que convierte "denegado" en "denegado, y aquí". */
  readonly position: DocumentPosition | undefined;
  /** Las tools que el principal vería por esta capacidad. Vacío si no se le concede. */
  readonly tools: readonly ToolDescriptor[];
}

/**
 * El bucle de corrección del invariante 4 convertido en herramienta: se
 * pregunta, se recibe el sitio exacto a tocar, se corrige y se vuelve a
 * preguntar. Que el instante sea un parámetro —y no el reloj del sistema—
 * permite preguntar por ventanas futuras sin trucos.
 */
export function explain(loaded: LoadedPolicy, question: Question): Explanation {
  const { policy, wiring, document } = loaded;
  if (policy === undefined || wiring === undefined) {
    return {
      resolution: { ok: false, problem: 'issuer_unknown', detail: 'la política no compila' },
      decision: undefined,
      position: undefined,
      tools: [],
    };
  }

  const profile = wiring.issuers.find((issuer) => issuer.id === question.issuer);
  const resolution = normalize(profile, {
    subject: question.subject,
    attributes: { ...literalAttributes(policy, question.issuer), ...question.attributes },
  });
  if (!resolution.ok) {
    return { resolution, decision: undefined, position: undefined, tools: [] };
  }

  const principal: PrincipalView = {
    id: resolution.principal.id,
    issuer: resolution.principal.issuer,
    attributes: resolution.principal.attributes,
  };
  const decision = evaluate(
    { principal, capability: question.capability, at: question.at, usage: question.usage },
    wiring.ruleset,
  );

  return {
    resolution,
    decision,
    position: document?.resolve(decision.reason.path),
    tools: decision.outcome === 'allow' ? visibleTools(wiring.catalog, [question.capability]) : [],
  };
}

export interface ReachReport {
  readonly reachability: Reachability;
  readonly positions: Readonly<Record<string, DocumentPosition | undefined>>;
  readonly tools: readonly ToolDescriptor[];
}

/** La pregunta de auditoría real: "¿quién puede emitir facturas?". */
export function whoCan(loaded: LoadedPolicy, capability: string): ReachReport | undefined {
  const { wiring, document } = loaded;
  if (wiring === undefined) return undefined;

  const reachability = reach(capability, wiring.ruleset);
  const positions: Record<string, DocumentPosition | undefined> = {};
  for (const entry of reachability.through) positions[entry.path] = document?.resolve(entry.path);
  return { reachability, positions, tools: visibleTools(wiring.catalog, [capability]) };
}

export interface DecisionSummary {
  readonly outcome: 'allow' | 'deny';
  readonly code: string;
  readonly account: string | undefined;
  readonly path: string;
}

export interface DecisionChange {
  readonly issuer: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly capability: string;
  readonly before: DecisionSummary | undefined;
  readonly after: DecisionSummary | undefined;
}

function summarize(decision: Decision): DecisionSummary {
  return {
    outcome: decision.outcome,
    code: decision.reason.code,
    account: decision.outcome === 'allow' ? decision.account.id : undefined,
    path: decision.reason.path,
  };
}

/**
 * Los principales por los que merece la pena preguntar.
 *
 * El espacio de principales no es enumerable —los atributos son abiertos—, pero
 * los selectores sí lo son: cada concesión es una conjunción de igualdades, así
 * que un principal que la cumple exactamente basta para observar su efecto. Se
 * añade además uno sin atributos por emisor, que es quien acusa que una
 * concesión ha dejado de aplicar al caso general.
 */
function representatives(versions: readonly CompiledPolicy[]): PrincipalView[] {
  const found = new Map<string, PrincipalView>();
  for (const policy of versions) {
    for (const issuer of policy.issuers) {
      found.set(`${issuer.id}|`, { id: `${issuer.id}:*`, issuer: issuer.id, attributes: {} });
    }
    for (const grant of policy.grants) {
      const key = `${grant.issuer}|${JSON.stringify(Object.entries(grant.attributes).sort())}`;
      if (!found.has(key)) {
        found.set(key, { id: `${grant.issuer}:*`, issuer: grant.issuer, attributes: grant.attributes });
      }
    }
  }
  return [...found.values()];
}

function decisionFor(ruleset: Ruleset | undefined, principal: PrincipalView, capability: string, at: Instant): Decision | undefined {
  if (ruleset === undefined) return undefined;
  if (!ruleset.capabilities.some((declared) => declared.id === capability)) return undefined;
  return evaluate({ principal, capability, at, usage: { kind: 'not-consulted' } }, ruleset);
}

/**
 * Qué decisiones cambian entre dos versiones del artefacto.
 *
 * Un diff de texto no lo dice: añadir un atributo a un selector es una línea y
 * puede cortarle el acceso a un equipo entero.
 */
export function effectiveDiff(before: LoadedPolicy, after: LoadedPolicy, at: Instant): readonly DecisionChange[] {
  const versions = [before.policy, after.policy].filter((policy): policy is CompiledPolicy => policy !== undefined);
  const capabilities = [...new Set(versions.flatMap((policy) => policy.capabilities.map((entry) => entry.id)))].sort();

  const changes: DecisionChange[] = [];
  for (const principal of representatives(versions)) {
    for (const capability of capabilities) {
      const one = decisionFor(before.wiring?.ruleset, principal, capability, at);
      const other = decisionFor(after.wiring?.ruleset, principal, capability, at);
      const left = one === undefined ? undefined : summarize(one);
      const right = other === undefined ? undefined : summarize(other);
      if (JSON.stringify(left) === JSON.stringify(right)) continue;
      changes.push({
        issuer: principal.issuer,
        attributes: principal.attributes,
        capability,
        before: left,
        after: right,
      });
    }
  }
  return changes;
}

/** Qué ve un principal, para las respuestas que enumeran en vez de decidir sobre una capacidad. */
export function seenBy(loaded: LoadedPolicy, principal: PrincipalView, at: Instant): readonly ToolDescriptor[] {
  if (loaded.wiring === undefined) return [];
  const granted = visible(principal, loaded.wiring.ruleset, at).map((entry) => entry.capability.id);
  return visibleTools(loaded.wiring.catalog, granted);
}
