// VIOLACIÓN: el núcleo importa un módulo de plataforma.
import { readFileSync } from 'node:fs';
export const read = (p: string): string => readFileSync(p, 'utf8');
