/**
 * La topología del repositorio, en un solo sitio.
 *
 * Todas las comprobaciones de `docs/diseno/verificacion.md` §2 se apoyan en
 * estas listas, y también lo hacen los casos de fallo de `verification/checks/`.
 * Que la regla real y su caso de fallo lean la misma fuente es lo que impide
 * que aflojar una regla deje su test en verde.
 */

/** Los cinco contextos delimitados. `docs/diseno/contextos.md` §2. */
export const CONTEXTS = ['principals', 'capabilities', 'accounts', 'access', 'policy'];

/** Periferia y composición. `docs/diseno/contextos.md` §4. */
export const PERIPHERY = ['adapters', 'runtime'];

/** Los siete paquetes del workspace. */
export const PACKAGES = [...CONTEXTS, ...PERIPHERY];

/**
 * De qué paquetes se versiona un retrato de superficie.
 * `docs/diseno/verificacion.md` §3.1.
 *
 * Los cinco contextos, por el blast radius. Y `runtime`, que no es un contexto
 * pero **declara los puertos**: su punto de entrada reexporta los siete
 * contratos, así que el retrato *es* el contrato. Sin él, "la segunda
 * implementación de cada puerto sin tocar `runtime`" ([`../../docs/sesiones.md`]
 * §5) sería una afirmación de revisión; con él, cambiar un puerto pone rojo
 * `pnpm check:surface` y hay que justificarlo en el diff.
 *
 * `adapters` no se retrata: es justo el sitio donde se espera que aparezcan
 * implementaciones nuevas, y un retrato ahí solo generaría ruido.
 */
export const PORTRAYED = [...CONTEXTS, 'runtime'];

/**
 * Nombres de paquete prohibidos. `docs/diseno/verificacion.md` §2.2.
 *
 * Ataca la forma real en que la regla de cero aristas se erosiona: nadie añade
 * un import prohibido, alguien crea un paquete común "solo para los ids".
 */
export const FORBIDDEN_PACKAGE_NAMES = ['shared', 'common', 'core', 'kernel', 'types'];

/**
 * Nombres técnicos prohibidos en el primer nivel.
 * `docs/diseno/verificacion.md` §3.5 y `docs/arquitectura.md` §2.2.
 */
export const FORBIDDEN_TOP_LEVEL_NAMES = [
  'controllers',
  'services',
  'repositories',
  'models',
  'utils',
  'helpers',
  'lib',
];

/** Fragmento de expresión regular que casa con cualquier paquete de contexto. */
export const CONTEXT_GROUP = `(${CONTEXTS.join('|')})`;

/** Fragmento de expresión regular que casa con periferia o composición. */
export const PERIPHERY_GROUP = `(${PERIPHERY.join('|')})`;
