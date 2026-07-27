/**
 * `CredentialResolver` sobre variables de entorno.
 *
 * Es el mínimo para desarrollo y la más simple de las cuatro implementaciones
 * previstas. Vault ya está, en `vault-credentials.ts`; el gestor de secretos del
 * proveedor cloud y el almacén de tokens OAuth siguen previstos y sin escribir
 * (`docs/diseno/puertos.md` §2.5).
 *
 * Esta es la frontera que hace cierto el invariante 6. Todo lo canjeable del
 * sistema nace aquí y muere en `ToolInvoker`: no vuelve hacia el núcleo bajo
 * ninguna forma, ni siquiera derivada.
 */

interface Material {
  readonly value: string;
}

/**
 * **Ningún fallo degrada a ejecutar sin credencial**, y ningún mensaje de error
 * lleva el material: se nombra la referencia, que es opaca por diseño, nunca lo
 * que hay al otro lado.
 */
export function envCredentials(): { resolve(secretRef: string): Promise<Material> } {
  return {
    async resolve(secretRef: string): Promise<Material> {
      if (!secretRef.startsWith('env://')) {
        throw new Error(
          `La referencia \`${secretRef}\` no es \`env://\`. Este adaptador solo resuelve variables de entorno.`,
        );
      }

      const name = secretRef.slice('env://'.length);
      const value = process.env[name];
      if (value === undefined || value === '') {
        throw new Error(`La referencia \`${secretRef}\` no resuelve: la variable \`${name}\` no está definida.`);
      }

      return { value };
    },
  };
}
