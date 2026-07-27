/**
 * Las reglas sobre el grafo de imports.
 *
 * Cubren tres de las cuatro comprobaciones automáticas de
 * `docs/diseno/verificacion.md` §2: dirección de dependencias (§2.1), fronteras
 * entre contextos (§2.2) y la parte estática de la pureza del núcleo (§2.4.1).
 *
 * Se exportan como dato para que `.dependency-cruiser.js` y los tests de
 * `verification/checks/` ejecuten exactamente el mismo conjunto: un caso de
 * fallo que no use la regla real no demuestra nada.
 */
import { CONTEXT_GROUP, PERIPHERY_GROUP } from './packages.js';

/** @type {import('dependency-cruiser').IForbiddenRuleType[]} */
export const forbidden = [
  {
    name: 'core-must-not-reach-periphery',
    comment:
      'Invariante 1: el núcleo no conoce la periferia, ni directa ni transitivamente. ' +
      'La transitividad es la parte que importa: es la vía por la que esto se rompe de verdad.',
    severity: 'error',
    from: { path: `^${CONTEXT_GROUP}/` },
    to: { path: `^${PERIPHERY_GROUP}/`, reachable: true },
  },
  {
    name: 'no-cross-context-imports',
    comment:
      'Decisión 0004: ningún contexto importa a otro contexto. Sin excepciones. ' +
      'Si un contexto necesita a otro, o se traduce en composición o la frontera está mal puesta.',
    severity: 'error',
    from: { path: `^${CONTEXT_GROUP}/` },
    to: { path: `^${CONTEXT_GROUP}/`, pathNot: '^$1/' },
  },
  {
    name: 'core-must-not-use-platform-modules',
    comment:
      'Invariante 2: sin E/S en el núcleo. Ningún contexto importa módulos de plataforma.',
    severity: 'error',
    from: { path: `^${CONTEXT_GROUP}/` },
    to: { dependencyTypes: ['core'] },
  },
  {
    name: 'adapters-must-not-import-contexts',
    comment:
      '`docs/diseno/contextos.md` §4: adapters/ no importa contextos; implementa los ' +
      'contratos de puerto que declara runtime/.',
    severity: 'error',
    from: { path: '^adapters/' },
    to: { path: `^${CONTEXT_GROUP}/`, reachable: true },
  },
  {
    name: 'not-to-unresolvable',
    comment:
      'Un import que no resuelve no puede comprobarse. Sin esta regla, una arista prohibida ' +
      'entre contextos pasaría por buena solo porque el paquete no declara la dependencia.',
    severity: 'error',
    from: {},
    to: { couldNotResolve: true },
  },
  {
    name: 'no-circular',
    comment: 'Un ciclo de imports no tiene frontera legible.',
    severity: 'error',
    from: {},
    to: { circular: true },
  },
];

/**
 * Opciones de recorrido y resolución compartidas por la ejecución real y por
 * los casos de fallo, para que ambos vean el mismo grafo.
 *
 * @type {import('dependency-cruiser').ICruiseOptions}
 */
export const options = {
  // `doNotFollow` en lugar de `exclude`: un import entre paquetes del workspace
  // resuelve a través del enlace de `node_modules`, así que excluirlo borraría
  // del grafo justo las aristas que la regla de fronteras tiene que ver.
  doNotFollow: { path: '(^|/)node_modules/' },
  // TypeScript en modo `nodenext` escribe los especificadores relativos con
  // extensión `.js` aunque el fichero sea `.ts`. Resolverlos exige el resolutor
  // de TypeScript, no el de Node: sin esto el grafo saldría casi vacío.
  tsConfig: { fileName: 'tsconfig.base.json' },
  tsPreCompilationDeps: true,
  enhancedResolveOptions: {
    extensions: ['.ts', '.js'],
    exportsFields: ['exports'],
    conditionNames: ['import', 'types', 'default'],
  },
};
