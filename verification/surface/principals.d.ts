// Retrato de la superficie pública de `principals`.
// Generado por `pnpm surface`; no se edita a mano.

export type AuthenticationProblem =
  | 'credential_missing'
  | 'credential_invalid'
  | 'credential_expired'
  | 'issuer_unknown';

export interface IssuerProfile {
  readonly id: string;
  readonly declaredAttributes: readonly string[];
}

declare const normalize: (issuer: IssuerProfile | undefined, claims: SubjectClaims) => Resolution;

export interface Principal {
  /** Forma normalizada y cualificada: emisor y sujeto, que es lo que lo hace único. */
  readonly id: string;
  readonly issuer: string;
  readonly subject: string;
  readonly attributes: Readonly<Record<string, string>>;
}

export type Resolution =
  | {
      readonly ok: true;
      readonly principal: Principal;
      /** Atributos que llegaron y el emisor no declara: se descartan, y conviene decirlo. */
      readonly discarded: readonly string[];
    }
  | { readonly ok: false; readonly problem: AuthenticationProblem; readonly detail: string | undefined };

export interface SubjectClaims {
  readonly subject: string;
  readonly attributes: Readonly<Record<string, string>>;
}
