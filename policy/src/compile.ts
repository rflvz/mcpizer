/**
 * De texto a política compilada, con todos los diagnósticos que el esquema no
 * puede expresar.
 *
 * Es la razón por la que el invariante 8 se cumple: compilar y evaluar no
 * requiere contactar con nada, así que una configuración se verifica entera en
 * local — incluidas las preguntas del tipo "¿quién puede llegar a esta
 * capacidad?".
 */
import type { Diagnostic, DiagnosticCode, DiagnosticSeverity, RelatedLocation } from './diagnostics.js';
import { hasErrors } from './diagnostics.js';
import { pointer, readDocument, type PolicyDocument } from './document.js';
import {
  windowMillis,
  type CompiledAccount,
  type CompiledCapability,
  type CompiledGrant,
  type CompiledIssuer,
  type CompiledPolicy,
  type CompiledToolMapping,
  type CompiledTransport,
  type CompiledUpstream,
  type IssuerKind,
  type ToolIdentity,
  type TransportKind,
} from './model.js';
import { validateStructure } from './structure.js';

export interface CompileOptions {
  /**
   * El catálogo declarado. Sin él no se puede saber si un mapeo apunta a una
   * tool que ya no existe; con él, la verificación en seco detecta también lo
   * que de otro modo solo aparecería en ejecución
   * (`docs/diseno/artefacto.md` §4).
   */
  readonly catalog?: readonly ToolIdentity[] | undefined;
}

export interface CompileResult {
  readonly document: PolicyDocument | undefined;
  /** Ausente si hay algún diagnóstico de severidad `error`. */
  readonly policy: CompiledPolicy | undefined;
  readonly diagnostics: readonly Diagnostic[];
}

/** Forma del documento después de validarlo contra el esquema. */
interface RawPolicy {
  version: 1;
  capabilities: { id: string; description?: string }[];
  upstreams?: {
    id: string;
    transport: { kind: TransportKind; command?: string; args?: string[]; url?: string };
    tools: { name: string; capability: string }[];
  }[];
  accounts: { id: string; disabled?: boolean; secret: { ref: string } }[];
  principals: {
    issuers: {
      id: string;
      kind: IssuerKind;
      subject?: string;
      secret?: { ref: string };
      attributes?: Record<string, string>;
    }[];
  };
  grants: {
    to: { issuer: string; attributes?: Record<string, string> };
    capabilities: string[];
    using: string;
    limits?: { calls: number; per: string };
  }[];
}

class Diagnostics {
  private readonly collected: Diagnostic[] = [];

  constructor(private readonly document: PolicyDocument) {}

  add(
    severity: DiagnosticSeverity,
    code: DiagnosticCode,
    path: string,
    message: string,
    related: readonly { path: string; note: string }[] = [],
  ): void {
    this.collected.push({
      severity,
      code,
      message,
      path,
      position: this.document.resolve(path),
      related: related.map<RelatedLocation>((entry) => ({
        path: entry.path,
        position: this.document.resolve(entry.path),
        note: entry.note,
      })),
    });
  }

  get all(): readonly Diagnostic[] {
    return this.collected;
  }
}

/**
 * Decisión 0011: los selectores son conjunciones de igualdades sobre atributos
 * de un solo valor. Dos selectores son disjuntos si y solo si comparten una
 * clave con valores distintos; en cualquier otro caso pueden casar con el mismo
 * principal y hay que tratarlos como solapados.
 */
function selectorsOverlap(
  left: { issuer: string; attributes: Readonly<Record<string, string>> },
  right: { issuer: string; attributes: Readonly<Record<string, string>> },
): boolean {
  if (left.issuer !== right.issuer) return false;
  for (const [key, value] of Object.entries(left.attributes)) {
    const other = right.attributes[key];
    if (other !== undefined && other !== value) return false;
  }
  return true;
}

/**
 * El esquema ya garantiza que un `mcp-stdio` trae `command` y un `mcp-http` trae
 * `url`; esto solo lo interpreta, igual que `windowMillis` con la ventana.
 */
function compileTransport(transport: {
  kind: TransportKind;
  command?: string;
  args?: string[];
  url?: string;
}): CompiledTransport {
  if (transport.kind === 'mcp-stdio') {
    return { kind: 'mcp-stdio', command: transport.command ?? '', args: transport.args ?? [] };
  }
  return { kind: 'mcp-http', url: transport.url ?? '' };
}

function reportDuplicates(
  diagnostics: Diagnostics,
  entries: readonly { id: string; path: string }[],
  what: string,
): void {
  const firstSeen = new Map<string, string>();
  for (const entry of entries) {
    const previous = firstSeen.get(entry.id);
    if (previous === undefined) {
      firstSeen.set(entry.id, entry.path);
      continue;
    }
    diagnostics.add('error', 'duplicate_id', entry.path, `${what} \`${entry.id}\` está declarado dos veces.`, [
      { path: previous, note: 'primera declaración' },
    ]);
  }
}

export function compile(text: string, options: CompileOptions = {}): CompileResult {
  const parsed = readDocument(text);
  if (parsed.document === undefined) {
    return { document: undefined, policy: undefined, diagnostics: parsed.diagnostics };
  }
  const document = parsed.document;

  const structural = validateStructure(document);
  if (structural.length > 0) {
    return { document, policy: undefined, diagnostics: structural };
  }

  const raw = document.value as RawPolicy;
  const diagnostics = new Diagnostics(document);

  const anchors = {
    capabilities: pointer('capabilities'),
    upstreams: pointer('upstreams'),
    accounts: pointer('accounts'),
    issuers: pointer('principals', 'issuers'),
    grants: pointer('grants'),
  };

  // ── Capacidades, upstreams, cuentas y emisores ────────────────────────────
  const capabilityPaths = new Map<string, string>();
  raw.capabilities.forEach((capability, index) => {
    capabilityPaths.set(capability.id, pointer('capabilities', index));
  });
  reportDuplicates(
    diagnostics,
    raw.capabilities.map((capability, index) => ({ id: capability.id, path: pointer('capabilities', index) })),
    'La capacidad',
  );

  const mappings: CompiledToolMapping[] = [];
  const upstreams: CompiledUpstream[] = (raw.upstreams ?? []).map((upstream, upstreamIndex) => {
    const upstreamPath = pointer('upstreams', upstreamIndex);
    const tools = upstream.tools.map((tool, toolIndex) => {
      const toolPath = pointer('upstreams', upstreamIndex, 'tools', toolIndex);
      if (!capabilityPaths.has(tool.capability)) {
        diagnostics.add(
          'error',
          'unknown_capability_in_tool',
          `${toolPath}/capability`,
          `La tool \`${tool.name}\` se mapea a la capacidad \`${tool.capability}\`, que no está declarada.`,
        );
      }
      return { upstream: upstream.id, name: tool.name, capability: tool.capability, path: toolPath };
    });
    mappings.push(...tools);
    return { id: upstream.id, transport: compileTransport(upstream.transport), tools, path: upstreamPath };
  });
  reportDuplicates(
    diagnostics,
    upstreams.map((upstream) => ({ id: upstream.id, path: upstream.path })),
    'El upstream',
  );

  const accounts: CompiledAccount[] = raw.accounts.map((account, index) => ({
    id: account.id,
    secretRef: account.secret.ref,
    disabled: account.disabled ?? false,
    path: pointer('accounts', index),
  }));
  reportDuplicates(
    diagnostics,
    accounts.map((account) => ({ id: account.id, path: account.path })),
    'La cuenta',
  );
  const accountsById = new Map(accounts.map((account) => [account.id, account]));

  const issuers: CompiledIssuer[] = raw.principals.issuers.map((issuer, index) => {
    const issuerPath = pointer('principals', 'issuers', index);
    const attributes = issuer.attributes ?? {};
    if (issuer.kind === 'oidc') {
      for (const [name, source] of Object.entries(attributes)) {
        if (!source.startsWith('claim:')) {
          diagnostics.add(
            'error',
            'claim_mapping_expected',
            `${issuerPath}/attributes/${name}`,
            `Un emisor \`oidc\` declara sus atributos como \`claim:<nombre>\`; \`${source}\` es un literal.`,
          );
        }
      }
    }
    // Sujeto y referencia a la clave son enganche con la periferia, no política:
    // son opcionales por el mismo motivo por el que `discovery` lo es en un
    // emisor `oidc` (`docs/diseno/artefacto.md` §1). Un emisor `static-key` sin
    // ellos no puede autenticar a nadie, que es fallo cerrado, y la pasarela lo
    // dice al arrancar; la verificación en seco no tiene nada que objetar.
    return {
      id: issuer.id,
      kind: issuer.kind,
      attributes,
      subject: issuer.subject,
      secretRef: issuer.secret?.ref,
      path: issuerPath,
    };
  });
  reportDuplicates(
    diagnostics,
    issuers.map((issuer) => ({ id: issuer.id, path: issuer.path })),
    'El emisor',
  );
  const issuersById = new Map(issuers.map((issuer) => [issuer.id, issuer]));

  // ── Concesiones ───────────────────────────────────────────────────────────
  const grants: CompiledGrant[] = raw.grants.map((grant, index) => {
    const grantPath = pointer('grants', index);
    const attributes = grant.to.attributes ?? {};

    const issuer = issuersById.get(grant.to.issuer);
    if (issuer === undefined) {
      diagnostics.add(
        'error',
        'unknown_issuer_in_grant',
        `${grantPath}/to/issuer`,
        `La concesión selecciona el emisor \`${grant.to.issuer}\`, que no está declarado.`,
        [{ path: anchors.issuers, note: 'emisores declarados' }],
      );
    } else {
      for (const name of Object.keys(attributes)) {
        if (!(name in issuer.attributes)) {
          diagnostics.add(
            'error',
            'attribute_not_declared',
            `${grantPath}/to/attributes/${name}`,
            `El emisor \`${issuer.id}\` no declara el atributo \`${name}\`, así que la política no puede discriminar sobre él.`,
            [{ path: `${issuer.path}/attributes`, note: 'atributos declarados' }],
          );
        }
      }
    }

    for (const [capabilityIndex, capability] of grant.capabilities.entries()) {
      if (!capabilityPaths.has(capability)) {
        diagnostics.add(
          'error',
          'unknown_capability_in_grant',
          pointer('grants', index, 'capabilities', capabilityIndex),
          `La concesión nombra la capacidad \`${capability}\`, que no está declarada.`,
          [{ path: anchors.capabilities, note: 'capacidades declaradas' }],
        );
      }
    }

    if (!accountsById.has(grant.using)) {
      diagnostics.add(
        'error',
        'unknown_account_in_grant',
        `${grantPath}/using`,
        `La concesión se ejecuta contra la cuenta \`${grant.using}\`, que no está declarada.`,
        [{ path: anchors.accounts, note: 'cuentas declaradas' }],
      );
    }

    const limits =
      grant.limits === undefined
        ? undefined
        : { calls: grant.limits.calls, per: grant.limits.per, windowMs: windowMillis(grant.limits.per) };

    return {
      issuer: grant.to.issuer,
      attributes,
      capabilities: grant.capabilities,
      account: grant.using,
      limits,
      path: grantPath,
    };
  });

  // Ambigüedad sobre la segunda identidad: error de autoría, nunca resolución
  // silenciosa (decisión 0005). Elegir en silencio significaría que la respuesta
  // a "¿con qué cuenta se ejecutó esto?" depende de una regla que el autor no
  // escribió y probablemente no conoce.
  for (let left = 0; left < grants.length; left += 1) {
    for (let right = left + 1; right < grants.length; right += 1) {
      const one = grants[left];
      const other = grants[right];
      if (one === undefined || other === undefined) continue;
      if (one.account === other.account) continue;
      if (!selectorsOverlap(one, other)) continue;
      const shared = one.capabilities.filter((capability) => other.capabilities.includes(capability));
      if (shared.length === 0) continue;
      diagnostics.add(
        'error',
        'ambiguous_grant',
        one.path,
        `Dos concesiones cubren ${shared.map((capability) => `\`${capability}\``).join(', ')} para el mismo ` +
          `principal con cuentas distintas (\`${one.account}\` y \`${other.account}\`). Estrecha uno de los dos selectores.`,
        [{ path: other.path, note: 'la otra concesión' }],
      );
    }
  }

  // ── Señales que no impiden compilar ───────────────────────────────────────
  const realized = new Set(mappings.map((mapping) => mapping.capability));
  const capabilities: CompiledCapability[] = raw.capabilities.map((capability, index) => {
    const path = pointer('capabilities', index);
    if (!realized.has(capability.id)) {
      diagnostics.add(
        'warning',
        'capability_not_realized',
        path,
        `Ninguna tool declarada realiza \`${capability.id}\`: concederla no hace visible nada.`,
      );
    }
    return {
      id: capability.id,
      description: capability.description,
      realized: realized.has(capability.id),
      path,
    };
  });

  const used = new Set(grants.map((grant) => grant.account));
  for (const account of accounts) {
    if (!used.has(account.id)) {
      diagnostics.add('warning', 'unused_account', account.path, `Ninguna concesión usa la cuenta \`${account.id}\`.`);
    }
  }

  if (options.catalog !== undefined) {
    const known = new Set(options.catalog.map((tool) => `${tool.upstream} ${tool.name}`));
    for (const mapping of mappings) {
      if (!known.has(`${mapping.upstream} ${mapping.name}`)) {
        diagnostics.add(
          'error',
          'tool_not_in_catalog',
          `${mapping.path}/name`,
          `El catálogo declarado de \`${mapping.upstream}\` no contiene ninguna tool \`${mapping.name}\`.`,
        );
      }
    }
    const mapped = new Set(mappings.map((mapping) => `${mapping.upstream} ${mapping.name}`));
    for (const tool of options.catalog) {
      if (!mapped.has(`${tool.upstream} ${tool.name}`)) {
        diagnostics.add(
          'warning',
          'catalog_tool_unmapped',
          anchors.upstreams,
          `\`${tool.upstream}/${tool.name}\` existe en el catálogo y ningún mapeo la cubre: nadie la ve ni la invoca.`,
        );
      }
    }
  }

  const all = diagnostics.all;
  if (hasErrors(all)) return { document, policy: undefined, diagnostics: all };

  return {
    document,
    policy: { version: 1, capabilities, upstreams, accounts, issuers, grants, anchors },
    diagnostics: all,
  };
}
