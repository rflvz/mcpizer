// VIOLACIÓN: el núcleo consulta la hora en lugar de recibirla como hecho.
export const stamp = (): number => Date.now();
export const today = (): Date => new Date();
