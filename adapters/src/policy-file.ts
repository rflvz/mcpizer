/**
 * `PolicySource` sobre fichero local.
 *
 * El puerto solo consigue bytes: no parsea, no valida, no interpreta. Si
 * mezclara ambas cosas, cambiar de origen obligaría a reimplementar la
 * validación (`docs/diseno/puertos.md` §2.2).
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export interface LoadedArtifact {
  readonly text: string;
  /** Etiqueta que permite saber si el artefacto ha cambiado. */
  readonly version: string;
  readonly origin: string;
}

/**
 * Un origen inalcanzable o sin artefacto produce **arranque fallido**, nunca una
 * política vacía: una política vacía sería sintácticamente válida y lo denegaría
 * todo, que es seguro pero indistinguible de un fallo de infraestructura.
 */
export function policyFile(path: string): { load(): Promise<LoadedArtifact> } {
  return {
    async load(): Promise<LoadedArtifact> {
      let text: string;
      try {
        text = await readFile(path, 'utf8');
      } catch (cause) {
        throw new Error(`No se pudo leer el artefacto en \`${path}\`.`, { cause });
      }
      return {
        text,
        version: createHash('sha256').update(text).digest('hex').slice(0, 12),
        origin: path,
      };
    },
  };
}
