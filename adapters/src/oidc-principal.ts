/**
 * `PrincipalResolver` sobre OIDC/JWT con validación por JWKS.
 *
 * Es la frontera con variación más segura de todo el sistema
 * (`docs/diseno/puertos.md` §2.1): un equipo con Okta y otro con mTLS no van a
 * converger nunca. Y es la que de verdad ejercita el contrato, porque frente a
 * una clave estática trae **ciclo de vida**: un token caduca, una clave rota, y
 * el JWKS se descubre en vez de declararse.
 *
 * Se verifica con `jose` a propósito. Escribir la comprobación de firma a mano
 * es el sitio del sistema donde un error deja de ser un fallo y pasa a ser una
 * vulnerabilidad de autenticación, y aquí no hay nada que ganar haciéndolo
 * (decisión 0026). El fixture que emite los tokens firma con `node:crypto`, sin
 * `jose`: si firmara con la misma biblioteca, un error de uso se cancelaría
 * contra sí mismo.
 *
 * **Nunca devuelve un principal cuya credencial no haya validado.** Todo camino
 * que no acabe en una firma buena, un emisor esperado, una audiencia esperada y
 * una ventana de validez vigente acaba en fallo.
 */
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';

/** Un emisor `oidc` utilizable: los que no declaran descubrimiento no autentican a nadie. */
export interface OidcIssuer {
  readonly id: string;
  /** La URL de `.well-known/openid-configuration`. */
  readonly discovery: string;
  /** A quién van dirigidos los tokens. Sin ella, un token de otro servicio valdría aquí. */
  readonly audience: string | undefined;
  /** Nombre de atributo → `claim:<nombre>`. Lo no declarado se descarta. */
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

const CLAIM = 'claim:';

/**
 * Un claim convertido en atributo, o nada.
 *
 * La decisión 0011 fijó que los atributos son de **un solo valor**, y `groups`
 * es un array en cualquier IdP real. Un array de un elemento se reduce sin
 * ambigüedad; uno de varios no, y entonces el atributo **no se produce**.
 *
 * No se rechaza el token entero: sería incoherente con que un emisor pueda
 * declarar claims que ninguna concesión usa. Y no producirlo es fallo cerrado
 * por construcción, porque el selector es una conjunción de igualdades y un
 * atributo ausente no casa con ninguna (decisión 0024).
 */
function attributeOf(claim: unknown): string | undefined {
  if (typeof claim === 'string') return claim === '' ? undefined : claim;
  if (typeof claim === 'number' || typeof claim === 'boolean') return String(claim);
  if (Array.isArray(claim) && claim.length === 1) return attributeOf(claim[0]);
  return undefined;
}

/** El descubrimiento, resuelto una vez por emisor y reutilizado. */
interface Discovered {
  readonly issuer: string;
  readonly jwks: JWTVerifyGetKey;
}

/**
 * Cómo se traduce un fallo de `jose` a los cuatro motivos del puerto.
 *
 * Los cuatro se distinguen porque acaban en motivos distintos, y confundirlos
 * rompería el bucle de corrección: "tu token ha caducado" y "tu token no es de
 * este sistema" se arreglan de formas muy diferentes.
 */
function failureOf(error: unknown): Failure {
  const code = (error as { code?: unknown }).code;
  if (code === 'ERR_JWT_EXPIRED') return 'credential_expired';
  return 'credential_invalid';
}

export function oidcPrincipals(
  issuers: readonly OidcIssuer[],
  options: { readonly timeoutMs?: number } = {},
): { resolve(credentials: Credentials | undefined): Promise<Resolved> } {
  const byId = new Map(issuers.map((issuer) => [issuer.id, issuer]));
  const discovered = new Map<string, Promise<Discovered>>();
  const timeoutMs = options.timeoutMs ?? 5_000;

  async function discover(issuer: OidcIssuer): Promise<Discovered> {
    const response = await fetch(issuer.discovery, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
      throw new Error(`El descubrimiento de \`${issuer.id}\` contestó ${response.status}.`);
    }
    const document = (await response.json()) as { issuer?: unknown; jwks_uri?: unknown };
    if (typeof document.issuer !== 'string' || typeof document.jwks_uri !== 'string') {
      throw new Error(`El descubrimiento de \`${issuer.id}\` no declara \`issuer\` y \`jwks_uri\`.`);
    }
    return {
      issuer: document.issuer,
      // `jose` cachea el JWKS y solo vuelve a pedirlo ante un `kid` que no
      // conoce, que es exactamente lo que hace barata la rotación de claves.
      jwks: createRemoteJWKSet(new URL(document.jwks_uri), { timeoutDuration: timeoutMs }),
    };
  }

  function discoveryOf(issuer: OidcIssuer): Promise<Discovered> {
    let pending = discovered.get(issuer.id);
    if (pending === undefined) {
      pending = discover(issuer).catch((error: unknown) => {
        // Un descubrimiento que falló no se cachea: el siguiente intento vuelve
        // a probar en vez de heredar la caída del proveedor para siempre.
        discovered.delete(issuer.id);
        throw error;
      });
      discovered.set(issuer.id, pending);
    }
    return pending;
  }

  return {
    async resolve(credentials: Credentials | undefined): Promise<Resolved> {
      if (credentials === undefined || credentials.presented === '') {
        return { ok: false, problem: 'credential_missing' };
      }

      const issuer = byId.get(credentials.issuer);
      if (issuer === undefined) return { ok: false, problem: 'issuer_unknown' };

      let target: Discovered;
      try {
        target = await discoveryOf(issuer);
      } catch {
        // El proveedor no contesta. No es que el token sea malo: es que no hay
        // contra qué validarlo, y eso deniega igual. Fallo cerrado en el borde
        // exterior, como cuando la clave estática declarada no se puede leer.
        return { ok: false, problem: 'credential_invalid' };
      }

      let payload: JWTPayload;
      try {
        // `jose` comprueba la firma, `iss`, `aud`, `exp` y `nbf`. La audiencia se
        // pasa solo si el emisor la declara: exigirla sin declararla haría que
        // ningún token pasara nunca, y eso es un fallo de autoría disfrazado de
        // denegación.
        ({ payload } = await jwtVerify(credentials.presented, target.jwks, {
          issuer: target.issuer,
          ...(issuer.audience === undefined ? {} : { audience: issuer.audience }),
        }));
      } catch (error) {
        return { ok: false, problem: failureOf(error) };
      }

      const subject = payload.sub;
      if (typeof subject !== 'string' || subject === '') {
        // Un token sin sujeto no identifica a nadie, y un principal "anónimo" no
        // es un valor de retorno válido.
        return { ok: false, problem: 'credential_invalid' };
      }

      // Solo los claims declarados se convierten en atributos. Lo demás del
      // token se descarta: la política no puede discriminar sobre algo que el
      // artefacto no nombra.
      const attributes: Record<string, string> = {};
      for (const [name, source] of Object.entries(issuer.attributes)) {
        if (!source.startsWith(CLAIM)) continue;
        const value = attributeOf(payload[source.slice(CLAIM.length)]);
        if (value !== undefined) attributes[name] = value;
      }

      return { ok: true, issuer: issuer.id, subject, attributes };
    },
  };
}
