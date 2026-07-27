/**
 * `PrincipalResolver` sobre clave estática declarada en el artefacto.
 *
 * Es la más simple de las tres implementaciones previstas
 * (`docs/diseno/puertos.md` §2.1), y la que el modo de desarrollo local
 * necesita. OIDC/JWT y el subject de un certificado mTLS llegan en S3.
 *
 * La referencia a la clave la resuelve **este adaptador**, no el puerto
 * `CredentialResolver`: ese puerto canjea una referencia de *cuenta* ya
 * autorizada por una decisión, y pasarle una clave de emisor colapsaría las dos
 * identidades justo en la frontera que existe para separarlas.
 */
import { timingSafeEqual } from 'node:crypto';

/** Un emisor `static-key` utilizable: los que no declaran clave no autentican a nadie. */
export interface StaticKeyIssuer {
  readonly id: string;
  readonly subject: string;
  /** Referencia a la clave, no la clave. `env://NOMBRE` es lo único que se resuelve hoy. */
  readonly secretRef: string;
  readonly attributes: Readonly<Record<string, string>>;
}

interface Credentials {
  readonly issuer: string;
  readonly presented: string;
}

type Failure = 'credential_missing' | 'credential_invalid' | 'credential_expired' | 'issuer_unknown';

type Resolved =
  | {
      readonly ok: true;
      readonly issuer: string;
      readonly subject: string;
      readonly attributes: Readonly<Record<string, string>>;
    }
  | { readonly ok: false; readonly problem: Failure };

/**
 * Comparación en tiempo constante. Comparar claves con `===` filtra su prefijo
 * por el tiempo que tarda en fallar, y una clave estática vive mucho.
 */
function sameSecret(one: string, other: string): boolean {
  const left = Buffer.from(one, 'utf8');
  const right = Buffer.from(other, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** `env://NOMBRE` → el valor de esa variable. El resto de esquemas llega con las bóvedas de S3. */
function readSecret(ref: string): string | undefined {
  if (!ref.startsWith('env://')) return undefined;
  const name = ref.slice('env://'.length);
  const value = process.env[name];
  return value === undefined || value === '' ? undefined : value;
}

/**
 * **Nunca devuelve un principal cuya credencial no haya validado.** Un principal
 * "anónimo" no es un valor de retorno válido: la ausencia de identidad es fallo,
 * no un principal vacío. Es fallo cerrado en el borde exterior.
 */
export function staticKeyPrincipals(issuers: readonly StaticKeyIssuer[]): {
  resolve(credentials: Credentials | undefined): Promise<Resolved>;
} {
  const byId = new Map(issuers.map((issuer) => [issuer.id, issuer]));

  return {
    async resolve(credentials: Credentials | undefined): Promise<Resolved> {
      if (credentials === undefined || credentials.presented === '') {
        return { ok: false, problem: 'credential_missing' };
      }

      const issuer = byId.get(credentials.issuer);
      if (issuer === undefined) return { ok: false, problem: 'issuer_unknown' };

      const expected = readSecret(issuer.secretRef);
      // La clave declarada no se puede leer. No es que la presentada sea mala:
      // es que no hay contra qué compararla, y eso deniega igual.
      if (expected === undefined) return { ok: false, problem: 'credential_invalid' };

      if (!sameSecret(credentials.presented, expected)) {
        return { ok: false, problem: 'credential_invalid' };
      }

      return { ok: true, issuer: issuer.id, subject: issuer.subject, attributes: issuer.attributes };
    },
  };
}
