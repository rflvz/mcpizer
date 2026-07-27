/**
 * `CredentialResolver` sobre HashiCorp Vault, motor KV v2.
 *
 * Es la frontera que hace cierto el invariante 6, igual que
 * `env-credentials.ts`, pero con lo que de verdad separa una bóveda de una
 * variable de entorno: **modos de fallo propios**. Una variable existe o no
 * existe; una bóveda además puede estar caída, negarte el paso o haberte
 * caducado el token, y `docs/diseno/puertos.md` §2.5 exige que los cuatro
 * aborten la ejecución sin degradar nunca a ejecutar sin credencial.
 *
 * Ningún mensaje de error lleva material: se nombra la referencia, que es opaca
 * por diseño, nunca lo que hay al otro lado ni el token con que se pidió.
 */

interface Material {
  readonly value: string;
}

export interface VaultOptions {
  /** La dirección de la bóveda. Sin ella no hay adaptador que construir. */
  readonly address: string;
  /** El token con que se lee. Nunca aparece en un mensaje de error. */
  readonly token: string;
  /** El campo que se toma del secreto cuando la referencia no nombra uno. */
  readonly defaultField?: string;
  /** Corta la espera: una bóveda que no contesta tiene que abortar, no colgar el arranque. */
  readonly timeoutMs?: number;
}

interface Reference {
  readonly mount: string;
  readonly path: string;
  readonly field: string;
}

/**
 * `vault://<montaje>/<ruta>[#<campo>]`.
 *
 * El campo es opcional porque `examples/policy.yaml` declara referencias sin él
 * y exigirlo rompería políticas que solo se verifican en seco — el mismo motivo
 * por el que la decisión 0017 hizo opcionales `subject` y `secret`.
 */
function parse(secretRef: string, defaultField: string): Reference {
  const sinEsquema = secretRef.slice('vault://'.length);
  const almohadilla = sinEsquema.indexOf('#');
  const localizador = almohadilla === -1 ? sinEsquema : sinEsquema.slice(0, almohadilla);
  const field = almohadilla === -1 ? defaultField : sinEsquema.slice(almohadilla + 1);

  const barra = localizador.indexOf('/');
  if (barra <= 0 || barra === localizador.length - 1) {
    throw new Error(
      `La referencia \`${secretRef}\` no tiene la forma \`vault://<montaje>/<ruta>\`.`,
    );
  }

  return { mount: localizador.slice(0, barra), path: localizador.slice(barra + 1), field };
}

export function vaultCredentials(options: VaultOptions): { resolve(secretRef: string): Promise<Material> } {
  const defaultField = options.defaultField ?? 'value';
  const timeoutMs = options.timeoutMs ?? 5_000;
  const address = options.address.replace(/\/+$/, '');

  return {
    async resolve(secretRef: string): Promise<Material> {
      if (!secretRef.startsWith('vault://')) {
        throw new Error(
          `La referencia \`${secretRef}\` no es \`vault://\`. Este adaptador solo resuelve secretos de la bóveda.`,
        );
      }

      const { mount, path, field } = parse(secretRef, defaultField);
      // KV v2 interpone `data` entre el punto de montaje y la ruta. Es la
      // diferencia con v1, y equivocarla da un 404 indistinguible de un secreto
      // que no existe.
      const url = `${address}/v1/${mount}/data/${path}`;

      let response: Response;
      try {
        response = await fetch(url, {
          headers: { 'X-Vault-Token': options.token },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (cause) {
        // Bóveda inalcanzable. Aborta: nunca degrada a ejecutar sin credencial.
        throw new Error(`La bóveda no responde; \`${secretRef}\` no se puede resolver.`, { cause });
      }

      if (response.status === 403 || response.status === 401) {
        // El token de la bóveda no vale, o ha caducado. Se dice que no vale, y
        // no cuál era.
        throw new Error(`La bóveda niega el acceso a \`${secretRef}\`.`);
      }
      if (response.status === 404) {
        throw new Error(`La referencia \`${secretRef}\` no existe en la bóveda.`);
      }
      if (!response.ok) {
        throw new Error(`La bóveda contestó ${response.status} a \`${secretRef}\`.`);
      }

      let payload: { data?: { data?: Record<string, unknown> } };
      try {
        payload = (await response.json()) as { data?: { data?: Record<string, unknown> } };
      } catch (cause) {
        throw new Error(`La bóveda contestó algo ininteligible a \`${secretRef}\`.`, { cause });
      }

      const value = payload.data?.data?.[field];
      if (typeof value !== 'string' || value === '') {
        // Se nombra el campo que falta, no el contenido de los que sí están.
        throw new Error(`El secreto \`${secretRef}\` no trae un campo \`${field}\` utilizable.`);
      }

      return { value };
    },
  };
}
