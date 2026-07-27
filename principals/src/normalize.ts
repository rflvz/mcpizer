/**
 * Normalización de identidades de procedencias distintas —un `sub` de OIDC, un
 * subject de certificado, el id de una clave estática— a una forma única que el
 * resto del sistema entiende.
 */

/**
 * Un identificador y los atributos sobre los que la política discrimina.
 *
 * Nunca contiene material de credencial: ni el token del que salió, ni un hash,
 * ni una huella. Ya está autenticado cuando llega — la prueba de identidad se
 * consumió en el borde y no viaja hacia dentro (invariante 6).
 */
export interface Principal {
  /** Forma normalizada y cualificada: emisor y sujeto, que es lo que lo hace único. */
  readonly id: string;
  readonly issuer: string;
  readonly subject: string;
  readonly attributes: Readonly<Record<string, string>>;
}

/** Los atributos que un emisor declara. Lo que no esté aquí no puede discriminarse. */
export interface IssuerProfile {
  readonly id: string;
  readonly declaredAttributes: readonly string[];
}

/** Lo que trae el borde, ya validado por el adaptador. */
export interface SubjectClaims {
  readonly subject: string;
  readonly attributes: Readonly<Record<string, string>>;
}

/**
 * Los cuatro casos que `PrincipalResolver` distingue, porque acaban en motivos
 * distintos (`docs/diseno/puertos.md` §2.1).
 */
export type AuthenticationProblem =
  | 'credential_missing'
  | 'credential_invalid'
  | 'credential_expired'
  | 'issuer_unknown';

export type Resolution =
  | {
      readonly ok: true;
      readonly principal: Principal;
      /** Atributos que llegaron y el emisor no declara: se descartan, y conviene decirlo. */
      readonly discarded: readonly string[];
    }
  | { readonly ok: false; readonly problem: AuthenticationProblem; readonly detail: string | undefined };

/**
 * Un principal "anónimo" no es un valor válido: la ausencia de identidad es
 * fallo, no un principal vacío. Es fallo cerrado en el borde exterior.
 */
export function normalize(issuer: IssuerProfile | undefined, claims: SubjectClaims): Resolution {
  if (issuer === undefined) {
    return { ok: false, problem: 'issuer_unknown', detail: undefined };
  }
  if (claims.subject.trim() === '') {
    return { ok: false, problem: 'credential_missing', detail: 'sin sujeto' };
  }

  const declared = new Set(issuer.declaredAttributes);
  const attributes: Record<string, string> = {};
  const discarded: string[] = [];
  for (const [name, value] of Object.entries(claims.attributes)) {
    if (declared.has(name)) attributes[name] = value;
    else discarded.push(name);
  }

  return {
    ok: true,
    principal: {
      id: `${issuer.id}:${claims.subject}`,
      issuer: issuer.id,
      subject: claims.subject,
      attributes,
    },
    discarded: discarded.sort(),
  };
}
