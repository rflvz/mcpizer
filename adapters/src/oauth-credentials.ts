/**
 * `CredentialResolver` sobre un almacén de tokens OAuth, con refresco.
 *
 * Es la cuarta implementación de `docs/diseno/puertos.md` §2.5, y la única en la
 * que **la credencial de la cuenta no existe hasta que se pide**. Las otras tres
 * leen algo que ya está escrito en alguna parte; esta lo acuña, con una
 * caducidad, contra el emisor del upstream. Es lo que hace falta cuando el
 * proveedor al que se llama no acepta claves de larga vida.
 *
 * Todo el ciclo de vida vive aquí. El puerto sigue siendo
 * `resolve(secretRef) → material`, y quien lo usa no sabe que por debajo hubo
 * una acuñación, ni que la siguiente llamada se la ahorró, ni que a los
 * cincuenta minutos habrá otra.
 *
 * **El secreto del cliente no vive en la referencia**: la referencia nombra otra
 * referencia, y esa la resuelve el mismo despachador que resuelve las demás. Así
 * el artefacto sigue sin contener nada canjeable, que es la razón por la que
 * puede vivir en git y revisarse por PR ([`artefacto.md`](../../docs/diseno/artefacto.md) §5),
 * y así el secreto del cliente puede estar en la bóveda como cualquier otro.
 *
 *   oauth+https://id.internal/oauth2/token?client=agente&secret=env://CLAVE&scope=crm.read
 */

interface Material {
  readonly value: string;
}

export interface OauthOptions {
  /**
   * Cómo se resuelve la referencia anidada del secreto del cliente.
   *
   * Se recibe en vez de construirse aquí porque el despachador de esquemas vive
   * en el compositor: este adaptador no tiene por qué saber cuántas formas de
   * guardar un secreto existen, ni cuáles están configuradas.
   */
  readonly resolveClientSecret: (secretRef: string) => Promise<Material>;
  readonly timeoutMs?: number;
  /** Margen con que se renueva el token antes de que caduque. */
  readonly refreshMarginMs?: number;
  /** El instante, que en la cáscara es un dato y no un puerto. */
  readonly now?: () => number;
}

interface Solicitud {
  readonly endpoint: string;
  readonly client: string;
  readonly secretRef: string;
  readonly scope: string | undefined;
}

/** Los nombres que no salen a ninguna red. */
const BUCLE = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Los parámetros de la referencia, sin la convención de los formularios.
 *
 * `URLSearchParams` traduce `+` a espacio, porque es lo que manda el formato de
 * un formulario HTML. Esto no es un formulario: es una referencia, y el valor de
 * `secret` es **otra referencia**, que puede llevar un `+` —`oauth+…` lo lleva
 * en el nombre—. Decodificar como si fuera un formulario lo parte en silencio,
 * que es la peor forma de romperlo: la referencia sigue pareciendo correcta.
 */
function query(search: string): Map<string, string> {
  const parametros = new Map<string, string>();
  for (const par of search.replace(/^\?/, '').split('&')) {
    if (par === '') continue;
    const igual = par.indexOf('=');
    const clave = igual === -1 ? par : par.slice(0, igual);
    const valor = igual === -1 ? '' : par.slice(igual + 1);
    parametros.set(decodeURIComponent(clave), decodeURIComponent(valor));
  }
  return parametros;
}

/**
 * `oauth+<url>?client=…&secret=…[&scope=…]`.
 *
 * La forma `oauth+<url>` es la misma que la de `PolicySource` sobre git, y por
 * la misma razón: dice a la vez qué adaptador atiende y cómo se alcanza el otro
 * extremo, sin una bandera nueva que haya que mantener sincronizada.
 */
function parse(secretRef: string): Solicitud {
  let url: URL;
  try {
    url = new URL(secretRef.slice('oauth+'.length));
  } catch {
    throw new Error(
      `La referencia \`${secretRef}\` no tiene la forma \`oauth+<url>?client=…&secret=…\`.`,
    );
  }

  if (url.protocol === 'http:' && !BUCLE.has(url.hostname)) {
    // Por aquí viaja el secreto del cliente. Un canal que cualquiera en el
    // camino puede leer lo entrega, y con él todo lo que ese cliente pueda
    // hacer (decisión 0038).
    throw new Error(
      `La referencia \`${secretRef}\` mandaría el secreto del cliente por un canal que cualquiera puede leer. Usa \`https\`.`,
    );
  }

  const parametros = query(url.search);
  const client = parametros.get('client');
  const secret = parametros.get('secret');
  if (client === undefined || client === '' || secret === undefined || secret === '') {
    throw new Error(`La referencia \`${secretRef}\` no declara \`client\` y \`secret\`.`);
  }
  if (secret.startsWith('oauth+')) {
    // Sin esto, una referencia que se nombrara a sí misma daría una recursión
    // infinita en el arranque en vez de un mensaje.
    throw new Error(`La referencia \`${secretRef}\` anida otra \`oauth+\`; el secreto del cliente no se acuña.`);
  }
  const scope = parametros.get('scope');

  // Los parámetros de la referencia no viajan al emisor: lo que se manda es la
  // petición que la especificación fija, y nada más.
  const endpoint = new URL(url.toString());
  endpoint.search = '';

  return { endpoint: endpoint.toString(), client, secretRef: secret, scope };
}

export function oauthCredentials(options: OauthOptions): { resolve(secretRef: string): Promise<Material> } {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const refreshMarginMs = options.refreshMarginMs ?? 60_000;
  const now = options.now ?? ((): number => Date.now());

  /** Los tokens acuñados, por referencia. Nunca salen de este módulo. */
  const acuñados = new Map<string, { token: string; expiraEn: number }>();
  const acuñando = new Map<string, Promise<string>>();

  async function acuña(secretRef: string, solicitud: Solicitud): Promise<string> {
    const { value: clientSecret } = await options.resolveClientSecret(solicitud.secretRef);

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: solicitud.client,
      client_secret: clientSecret,
    });
    if (solicitud.scope !== undefined) body.set('scope', solicitud.scope);

    let response: Response;
    try {
      response = await fetch(solicitud.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      // Emisor inalcanzable. Aborta: nunca degrada a ejecutar sin credencial.
      throw new Error(`El emisor de tokens no responde; \`${secretRef}\` no se puede acuñar.`, { cause });
    }

    if (response.status === 400 || response.status === 401) {
      // Se dice que el cliente no vale, y no cuál era su secreto.
      throw new Error(`El emisor de tokens rechaza el cliente de \`${secretRef}\`.`);
    }
    if (!response.ok) {
      throw new Error(`El emisor de tokens contestó ${response.status} a \`${secretRef}\`.`);
    }

    let payload: { access_token?: unknown; expires_in?: unknown };
    try {
      payload = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
    } catch (cause) {
      throw new Error(`El emisor de tokens contestó algo ininteligible a \`${secretRef}\`.`, { cause });
    }

    if (typeof payload.access_token !== 'string' || payload.access_token === '') {
      throw new Error(`El emisor de tokens no devolvió ningún token utilizable para \`${secretRef}\`.`);
    }

    // Un token sin caducidad declarada se trata como si caducara ya: se usa esta
    // vez y no se guarda. Suponerle una vida larga es la forma de acabar
    // mandando al upstream un token muerto.
    const duracion = typeof payload.expires_in === 'number' ? payload.expires_in * 1_000 : 0;
    if (duracion > refreshMarginMs) {
      acuñados.set(secretRef, { token: payload.access_token, expiraEn: now() + duracion });
    }
    return payload.access_token;
  }

  return {
    async resolve(secretRef: string): Promise<Material> {
      if (!secretRef.startsWith('oauth+')) {
        throw new Error(
          `La referencia \`${secretRef}\` no es \`oauth+\`. Este adaptador solo acuña tokens.`,
        );
      }

      const vigente = acuñados.get(secretRef);
      if (vigente !== undefined && vigente.expiraEn - refreshMarginMs > now()) {
        return { value: vigente.token };
      }
      acuñados.delete(secretRef);

      // Una sola acuñación en vuelo por referencia: dos llamadas simultáneas a
      // la misma cuenta no tienen por qué pedir dos tokens.
      let pendiente = acuñando.get(secretRef);
      if (pendiente === undefined) {
        const solicitud = parse(secretRef);
        pendiente = acuña(secretRef, solicitud).finally(() => {
          acuñando.delete(secretRef);
        });
        acuñando.set(secretRef, pendiente);
      }

      return { value: await pendiente };
    },
  };
}
