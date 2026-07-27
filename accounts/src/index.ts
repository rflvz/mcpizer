/**
 * `accounts` — ¿contra qué cuenta se ejecuta?
 *
 * La segunda identidad. Sostiene referencias a cuentas de ejecución y las
 * reglas de vinculación que determinan qué referencia corresponde a un caso
 * dado, sin tocar jamás material sensible.
 */
export {
  bind,
  registryOf,
  usable,
  type AccountRecord,
  type AccountRef,
  type AccountRegistry,
  type Binding,
  type SecretRef,
} from './registry.js';
