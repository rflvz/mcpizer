/**
 * `PrincipalResolver` sobre identidad de certificado de cliente.
 *
 * Es la tercera implementación que `docs/diseno/puertos.md` §2.1 daba por
 * prevista, y la que cubre el caso que ni OIDC ni una clave estática cubren:
 * **una identidad que no se presenta, se demuestra**, y que no caduca en horas
 * sino en meses.
 *
 * Quien verifica la cadena del certificado es el terminador TLS, no este
 * proceso — la decisión 0033 dejó TLS fuera del programa a propósito, y aquí no
 * se reabre. Lo que llega es el resultado de esa verificación: el nombre
 * distinguido del cliente, en la cabecera que el terminador añade.
 *
 * **Eso es una frontera de confianza, y no se disimula.** Este adaptador cree lo
 * que le llega por esa cabecera; que sea cierto depende de dos cosas que ningún
 * código de aquí puede comprobar: que el proceso solo sea alcanzable a través
 * del terminador, y que el terminador **borre** cualquier cabecera del mismo
 * nombre que traiga el cliente. Por eso el defecto de `--host` es la interfaz de
 * bucle, por eso hay que nombrar la cabecera explícitamente con `--key-header`,
 * y por eso el emisor tiene que declararse `kind: mtls` en el artefacto, que se
 * revisa por PR (decisión 0037).
 */

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

/** Un emisor `mtls`: los atributos salen de componentes del nombre distinguido. */
export interface MtlsIssuer {
  readonly id: string;
  /** Nombre de atributo → `dn:<componente>`. Lo no declarado se descarta. */
  readonly attributes: Readonly<Record<string, string>>;
}

const DN = 'dn:';

/**
 * El nombre distinguido, sacado de lo presentado.
 *
 * Se admiten las dos formas con que los terminadores lo reenvían: la cabecera
 * `XFCC` de Envoy —una lista de pares donde el que importa es `Subject="…"`— y
 * un nombre distinguido a secas, que es lo que ponen los que reenvían un solo
 * campo. Distinguirlas por la presencia de `Subject=` es suficiente y no obliga
 * a declarar cuál usa cada despliegue.
 */
function distinguishedName(presented: string): string | undefined {
  const xfcc = /(?:^|;)\s*Subject="((?:[^"\\]|\\.)*)"/i.exec(presented);
  // Hay **dos** capas de escapado y solo se deshace la de fuera. La cabecera
  // entrecomilla el nombre distinguido y escapa comillas y contrabarras; el
  // nombre distinguido, por dentro, escapa sus propias comas. Deshacer las dos a
  // la vez convertiría `CN=Apellido\, Nombre` en dos componentes.
  if (xfcc?.[1] !== undefined) return xfcc[1].replace(/\\(["\\])/g, '$1');
  // Un DN a secas tiene al menos un `<componente>=<valor>`; cualquier otra cosa
  // no es un nombre distinguido y no se intenta adivinar.
  return /^\s*[A-Za-z][A-Za-z0-9.]*\s*=/.test(presented) ? presented : undefined;
}

/**
 * Los componentes del nombre distinguido, en minúsculas.
 *
 * Un componente repetido —`OU` lo está a menudo— **no produce atributo**, por la
 * misma razón que un claim multivaluado no lo produce: los atributos son de un
 * solo valor y el selector es una conjunción de igualdades, así que quedarse con
 * uno cualquiera decidiría por sorteo (decisión 0024).
 */
function components(dn: string): Map<string, string | null> {
  const found = new Map<string, string | null>();
  // Se parte por comas que no vayan escapadas: un valor puede llevar coma, y
  // `CN=Apellido\, Nombre` es una forma perfectamente legal.
  for (const parte of dn.split(/(?<!\\),/)) {
    const igual = parte.indexOf('=');
    if (igual <= 0) continue;
    const clave = parte.slice(0, igual).trim().toLowerCase();
    const valor = parte.slice(igual + 1).trim().replace(/\\(.)/g, '$1');
    if (clave === '' || valor === '') continue;
    // `null` marca "repetido", que es distinto de "ausente" y se descarta igual.
    found.set(clave, found.has(clave) ? null : valor);
  }
  return found;
}

export function mtlsPrincipals(issuers: readonly MtlsIssuer[]): {
  resolve(credentials: Credentials | undefined): Promise<Resolved>;
} {
  const byId = new Map(issuers.map((issuer) => [issuer.id, issuer]));

  return {
    async resolve(credentials: Credentials | undefined): Promise<Resolved> {
      if (credentials === undefined || credentials.presented === '') {
        // Sin cabecera no hay identidad. No es que el certificado sea malo: es
        // que no llegó ninguno, y eso se distingue porque se arregla distinto.
        return { ok: false, problem: 'credential_missing' };
      }

      const issuer = byId.get(credentials.issuer);
      if (issuer === undefined) return { ok: false, problem: 'issuer_unknown' };

      const dn = distinguishedName(credentials.presented);
      if (dn === undefined) return { ok: false, problem: 'credential_invalid' };

      const partes = components(dn);
      const subject = partes.get('cn');
      if (typeof subject !== 'string') {
        // Un certificado sin nombre común, o con dos, no identifica a nadie. Un
        // principal "anónimo" no es un valor de retorno válido.
        return { ok: false, problem: 'credential_invalid' };
      }

      // Solo los componentes declarados se convierten en atributos. Lo demás del
      // nombre distinguido se descarta: la política no puede discriminar sobre
      // algo que el artefacto no nombra.
      const attributes: Record<string, string> = {};
      for (const [name, source] of Object.entries(issuer.attributes)) {
        if (!source.startsWith(DN)) continue;
        const value = partes.get(source.slice(DN.length).toLowerCase());
        if (typeof value === 'string') attributes[name] = value;
      }

      return { ok: true, issuer: issuer.id, subject, attributes };
    },
  };
}
