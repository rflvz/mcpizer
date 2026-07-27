/**
 * Los puertos: contratos que declara la composición e implementa la periferia.
 *
 * En la mayoría de proyectos hexagonales los declara el dominio y los llama el
 * dominio. Aquí no, porque el núcleo es una función pura: el dominio no solo no
 * importa infraestructura, es que no tiene ningún punto por el que pudiera
 * hacerlo (`docs/diseno/puertos.md` §1).
 *
 * S1 declara los dos que la verificación en seco necesita. Los otros cinco
 * —`PrincipalResolver`, `UsageReader`/`UsageWriter`, `CredentialResolver`,
 * `ToolInvoker` y `DecisionRecorder`— llegan con la pasarela, que es donde
 * empiezan a tener implementación (decisión 0010).
 */

export interface PolicyArtifact {
  readonly text: string;
  /** Etiqueta de versión: permite saber si el artefacto ha cambiado. */
  readonly version: string;
  readonly origin: string;
}

/** De entrada. Entrega el artefacto declarativo sin interpretarlo. */
export interface PolicySource {
  load(): Promise<PolicyArtifact>;
}

export interface DiscoveredTool {
  readonly upstreamId: string;
  readonly name: string;
  readonly description: string | undefined;
  readonly inputSchema: unknown;
}

/** De entrada. Descubre qué tools ofrecen los upstreams; describe lo que hay, sin filtrar ni decidir. */
export interface CatalogSource {
  toolsOf(upstreamId?: string): Promise<readonly DiscoveredTool[]>;
}
