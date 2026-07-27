/**
 * La capa de composición: el único sitio donde los cinco contextos se ven a la
 * vez. Conoce a todos, y ninguno la conoce a ella.
 *
 * No es un contexto: no tiene vocabulario propio ni capacidad de negocio. Es
 * cableado, y que sea el único punto de acoplamiento total del sistema es
 * intencionado — concentra ahí la complejidad de integración en lugar de
 * repartirla (`docs/diseno/contextos.md` §3.2).
 *
 * Aquí ocurre además la frontera del invariante 6: la referencia al secreto vive
 * en `accounts` y **no se copia** a la vista que recibe `access`.
 */
import type { AccountView, GrantView, Ruleset } from '@mcpizer/access';
import { bind, registryOf, type AccountRecord, type AccountRegistry } from '@mcpizer/accounts';
import { buildCatalog, realizedCapabilities, type Catalog, type CatalogEntry } from '@mcpizer/capabilities';
import type { CompiledPolicy } from '@mcpizer/policy';
import type { IssuerProfile } from '@mcpizer/principals';
import type { DiscoveredTool } from './ports.js';

export interface Wiring {
  readonly catalog: Catalog;
  readonly accounts: AccountRegistry;
  readonly issuers: readonly IssuerProfile[];
  readonly ruleset: Ruleset;
}

/**
 * Los atributos literales que declara un emisor sin claims.
 *
 * Un emisor `oidc` mapea claims, así que no tiene literales que ofrecer; uno
 * `static-key` o `mtls` sí, y son el punto de partida razonable para preguntar
 * por él en seco.
 */
export function literalAttributes(policy: CompiledPolicy, issuerId: string): Readonly<Record<string, string>> {
  const issuer = policy.issuers.find((candidate) => candidate.id === issuerId);
  if (issuer === undefined || issuer.kind === 'oidc') return {};
  return issuer.attributes;
}

function catalogEntries(policy: CompiledPolicy, discovered: readonly DiscoveredTool[] | undefined): CatalogEntry[] {
  const declaredCapability = new Map<string, string>();
  for (const upstream of policy.upstreams) {
    for (const tool of upstream.tools) declaredCapability.set(`${tool.upstream} ${tool.name}`, tool.capability);
  }

  // Sin catálogo declarado, lo único que se sabe de las tools es lo que la
  // propia política afirma. Con él, además se ven las que existen y nadie mapea.
  const source: readonly DiscoveredTool[] =
    discovered ??
    policy.upstreams.flatMap((upstream) =>
      upstream.tools.map((tool) => ({
        upstreamId: tool.upstream,
        name: tool.name,
        description: undefined,
        inputSchema: undefined,
      })),
    );

  return source.map((tool) => ({
    upstreamId: tool.upstreamId,
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    capability: declaredCapability.get(`${tool.upstreamId} ${tool.name}`),
  }));
}

export function wire(policy: CompiledPolicy, discovered?: readonly DiscoveredTool[]): Wiring {
  const catalog = buildCatalog(catalogEntries(policy, discovered));
  const realized = new Set(realizedCapabilities(catalog));

  const accounts = registryOf(
    policy.accounts.map<AccountRecord>((account) => ({
      ref: { id: account.id },
      secret: { uri: account.secretRef },
      disabled: account.disabled,
    })),
  );

  const issuers = policy.issuers.map<IssuerProfile>((issuer) => ({
    id: issuer.id,
    declaredAttributes: Object.keys(issuer.attributes),
  }));

  const grants = policy.grants.map<GrantView>((grant) => {
    const binding = bind(accounts, grant.account);
    // Solo el asa y su estado cruzan hacia `access`. La referencia al secreto se
    // queda aquí: el núcleo nunca ve nada canjeable, ni siquiera dónde está.
    // Una cuenta que no resuelve se trata como inutilizable, no como ausente.
    const account: AccountView =
      binding.kind === 'unknown'
        ? { id: grant.account, disabled: true }
        : { id: binding.record.ref.id, disabled: binding.record.disabled };
    return {
      issuer: grant.issuer,
      attributes: grant.attributes,
      capabilities: grant.capabilities,
      account,
      limits: grant.limits,
      path: grant.path,
    };
  });

  const ruleset: Ruleset = {
    capabilities: policy.capabilities.map((capability) => ({
      id: capability.id,
      realized: realized.has(capability.id),
      path: capability.path,
    })),
    grants,
    anchors: { capabilities: policy.anchors.capabilities, grants: policy.anchors.grants },
  };

  return { catalog, accounts, issuers, ruleset };
}
