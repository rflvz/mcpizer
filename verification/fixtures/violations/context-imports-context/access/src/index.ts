// VIOLACIÓN: decisión 0004 — ningún contexto importa a otro contexto.
import type { Principal } from '../../principals/src/index.js';
export const decide = (principal: Principal): string => principal.id;
