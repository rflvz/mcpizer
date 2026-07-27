// VIOLACIÓN: invariante 1 — la arista prohibida está a dos saltos, que es la
// forma en que esto se rompe de verdad.
import { relay } from './relay.js';
export const decide = (): string => relay();
