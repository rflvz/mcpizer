// VIOLACIÓN: el núcleo lee el entorno.
export const mode = (): string | undefined => process.env['MCPIZER_MODE'];
