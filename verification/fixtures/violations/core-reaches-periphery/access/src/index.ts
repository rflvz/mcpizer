// VIOLACIÓN: invariante 1 — un contexto del núcleo alcanza la periferia.
import { readPolicyFile } from '../../adapters/src/index.js';
export const decide = (): string => readPolicyFile();
