// VIOLACIÓN: contextos.md §4 — adapters/ no importa contextos.
import type { AccountRef } from '../../accounts/src/index.js';
export const resolve = (ref: AccountRef): string => ref.id;
