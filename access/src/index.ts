/**
 * `access` — ¿se permite, y por qué?
 *
 * El corazón: recibe hechos, devuelve una decisión con motivo. No lee la
 * política del disco, no resuelve identidades, no invoca tools, no registra
 * nada, y no conoce el tiempo salvo como parámetro recibido.
 */
export { evaluate, visible, type VisibleCapability } from './evaluate.js';
export { reach, type Reachability, type ReachEntry } from './reach.js';
export type {
  AccountView,
  CapabilityView,
  Decision,
  GrantView,
  Instant,
  Invocation,
  LimitsView,
  PrincipalView,
  Reason,
  ReasonCode,
  Ruleset,
  RulesetAnchors,
  Usage,
} from './model.js';
