/**
 * El registro de cuentas y la resolución del vínculo.
 *
 * Aquí no hay tokens, claves, contraseñas ni nada canjeable: solo asas opacas.
 * El material vive en la periferia y no cruza la frontera (invariante 6), y
 * `CredentialResolver` es el único que sabe canjear una referencia — después de
 * que una decisión lo permita, nunca antes ni especulativamente.
 */

/**
 * Un asa. No una credencial, ni una envoltura de credencial, ni algo de lo que
 * se pueda derivar una.
 */
export interface AccountRef {
  readonly id: string;
}

/** Dónde está el secreto, jamás el secreto. */
export interface SecretRef {
  readonly uri: string;
}

/**
 * Una cuenta de ejecución tiene vida propia: puede estar deshabilitada, y eso
 * es un hecho del dominio, no un detalle de la bóveda.
 */
export interface AccountRecord {
  readonly ref: AccountRef;
  readonly secret: SecretRef;
  readonly disabled: boolean;
}

export interface AccountRegistry {
  readonly records: readonly AccountRecord[];
}

/** El resultado de resolver un vínculo. Desconocido y deshabilitado son casos distintos. */
export type Binding =
  | { readonly kind: 'bound'; readonly record: AccountRecord }
  | { readonly kind: 'disabled'; readonly record: AccountRecord }
  | { readonly kind: 'unknown'; readonly id: string };

export function registryOf(records: readonly AccountRecord[]): AccountRegistry {
  return { records };
}

export function bind(registry: AccountRegistry, id: string): Binding {
  const record = registry.records.find((candidate) => candidate.ref.id === id);
  if (record === undefined) return { kind: 'unknown', id };
  return record.disabled ? { kind: 'disabled', record } : { kind: 'bound', record };
}

export function usable(binding: Binding): boolean {
  return binding.kind === 'bound';
}
