// VIOLACIÓN: invariante 2 — E/S en el núcleo.
import { readFileSync } from 'node:fs';
export const load = (path: string): string => readFileSync(path, 'utf8');
