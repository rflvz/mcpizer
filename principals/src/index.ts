/**
 * `principals` — ¿quién invoca?
 *
 * Convierte lo que llega por el transporte en un principal del dominio: una
 * identidad con atributos, comparable y seleccionable por la política.
 *
 * No valida criptografía ni contacta con proveedores — eso es el adaptador. No
 * sabe nada de cuentas de ejecución. No sabe qué puede hacer el principal;
 * solo quién es.
 */
export {
  normalize,
  type AuthenticationProblem,
  type IssuerProfile,
  type Principal,
  type Resolution,
  type SubjectClaims,
} from './normalize.js';
