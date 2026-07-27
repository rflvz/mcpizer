/**
 * Pureza del núcleo, capa 2: prohibición estática de no determinismo.
 * `docs/diseno/verificacion.md` §2.4.2.
 *
 * Es la traducción directa de "sin reloj, sin aleatoriedad" (invariante 2) y de
 * haber declinado el puerto `Clock` (`docs/diseno/puertos.md` §3).
 *
 * Se exporta como dato para que `eslint.config.js` y el caso de fallo de
 * `verification/checks/core-purity.test.ts` apliquen el mismo bloque.
 */

const CLOCK = 'El núcleo no consulta la hora: el instante entra en la invocación como un hecho (invariante 2).';
const RANDOM = 'El núcleo no genera aleatoriedad: si algo la necesita, la produce la cáscara (invariante 2).';
const ENV = 'El núcleo no lee el entorno: no hay E/S en el dominio (invariante 2).';
const IO = 'El núcleo no importa módulos de plataforma: la periferia no cruza la frontera (invariante 1).';

/** @type {import('eslint').Linter.RulesRecord} */
export const corePurityRules = {
  'no-restricted-syntax': [
    'error',
    { selector: "MemberExpression[object.name='Date'][property.name='now']", message: CLOCK },
    { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: CLOCK },
    { selector: "MemberExpression[object.name='Math'][property.name='random']", message: RANDOM },
    { selector: "MemberExpression[object.name='performance'][property.name='now']", message: CLOCK },
    { selector: "MemberExpression[object.name='process'][property.name='env']", message: ENV },
    { selector: "MemberExpression[object.name='process'][property.name='hrtime']", message: CLOCK },
  ],
  'no-restricted-globals': [
    'error',
    { name: 'process', message: ENV },
    { name: 'performance', message: CLOCK },
    { name: 'crypto', message: RANDOM },
  ],
  'no-restricted-imports': [
    'error',
    {
      patterns: [
        { group: ['node:*'], message: IO },
        { group: ['fs', 'fs/*', 'path', 'os', 'crypto', 'child_process', 'http', 'https', 'net'], message: IO },
      ],
    },
  ],
};

/**
 * Utilidades de dobles cuya presencia en un test de contexto significa que el
 * núcleo ha dejado de ser una función. `docs/diseno/verificacion.md` §2.4.3.
 */
export const DOUBLE_MARKERS = [
  'vi.mock',
  'vi.fn',
  'vi.spyOn',
  'vi.stubGlobal',
  'vi.useFakeTimers',
  'vi.setSystemTime',
  'jest.mock',
  'jest.fn',
  'jest.spyOn',
  'sinon',
  'testdouble',
  'proxyquire',
  'nock',
];
