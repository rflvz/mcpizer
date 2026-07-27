// Retrato de la superficie pública de `accounts`.
// Generado por `pnpm surface`; no se edita a mano.

export interface AccountRecord {
  readonly ref: AccountRef;
  readonly secret: SecretRef;
  readonly disabled: boolean;
}

export interface AccountRef {
  readonly id: string;
}

export interface AccountRegistry {
  readonly records: readonly AccountRecord[];
}

declare const bind: (registry: AccountRegistry, id: string) => Binding;

export type Binding =
  | { readonly kind: 'bound'; readonly record: AccountRecord }
  | { readonly kind: 'disabled'; readonly record: AccountRecord }
  | { readonly kind: 'unknown'; readonly id: string };

declare const registryOf: (records: readonly AccountRecord[]) => AccountRegistry;

export interface SecretRef {
  readonly uri: string;
}

declare const usable: (binding: Binding) => boolean;
