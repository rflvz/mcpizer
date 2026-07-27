/**
 * `PrincipalResolver` sobre clave estática declarada en el artefacto.
 *
 * Es la más simple de las tres implementaciones previstas
 * (`docs/diseno/puertos.md` §2.1), y la que el modo de desarrollo local
 * necesita. La segunda es `oidc-principal.ts`; el subject de un certificado
 * mTLS sigue pendiente.
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
  /** Referencia a la clave, no la clave. `env://NOMBRE` siempre; `vault://…` si hay bóveda declarada. */
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

/**
 * Dónde puede vivir la clave de un emisor. Sin bóveda declarada, solo `env://`.
 *
 * Esto **duplica** a propósito lo que hace `vault-credentials.ts`. La decisión
 * 0017 ya declaró aceptada esa duplicación: son dos fronteras distintas que hoy
 * comparten un esquema de URI, y unificarlas exigiría un sitio común que las
 * volvería a acoplar — justo en la frontera que existe para separar las dos
 * identidades. Una clave de emisor se consume *antes* de decidir; una credencial
 * de cuenta, *después* y solo si una decisión la autorizó.
 */
export interface IssuerVault {
  readonly address: string;
  readonly token: string;
  readonly defaultField?: string;
  readonly timeoutMs?: number;
}

async function readSecret(ref: string, vault: IssuerVault | undefined): Promise<string | undefined> {
  if (ref.startsWith('env://')) {
    const name = ref.slice('env://'.length);
    const value = process.env[name];
    return value === undefined || value === '' ? undefined : value;
  }

  if (ref.startsWith('vault://') && vault !== undefined) {
    const sinEsquema = ref.slice('vault://'.length);
    const almohadilla = sinEsquema.indexOf('#');
    const localizador = almohadilla === -1 ? sinEsquema : sinEsquema.slice(0, almohadilla);
    const campo = almohadilla === -1 ? (vault.defaultField ?? 'value') : sinEsquema.slice(almohadilla + 1);
    const barra = localizador.indexOf('/');
    if (barra <= 0 || barra === localizador.length - 1) return undefined;

    try {
      const response = await fetch(
        `${vault.address.replace(/\/+$/, '')}/v1/${localizador.slice(0, barra)}/data/${localizador.slice(barra + 1)}`,
        {
          headers: { 'X-Vault-Token': vault.token },
          signal: AbortSignal.timeout(vault.timeoutMs ?? 5_000),
        },
      );
      if (!response.ok) return undefined;
      const payload = (await response.json()) as { data?: { data?: Record<string, unknown> } };
      const value = payload.data?.data?.[campo];
      return typeof value === 'string' && value !== '' ? value : undefined;
    } catch {
      // Una bóveda caída deja al emisor sin clave contra la que comparar, y eso
      // deniega. Nunca autentica: es fallo cerrado, y el motivo por el que este
      // `catch` no puede reescribirse para "seguir adelante".
      return undefined;
    }
  }

  return undefined;
}

/**
 * **Nunca devuelve un principal cuya credencial no haya validado.** Un principal
 * "anónimo" no es un valor de retorno válido: la ausencia de identidad es fallo,
 * no un principal vacío. Es fallo cerrado en el borde exterior.
 */
export function staticKeyPrincipals(
  issuers: readonly StaticKeyIssuer[],
  vault?: IssuerVault,
): {
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

      const expected = await readSecret(issuer.secretRef, vault);
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
