/**
 * `CredentialResolver` sobre el gestor de secretos del proveedor cloud.
 *
 * Es la tercera implementación de `docs/diseno/puertos.md` §2.5, y lo que la
 * separa de las otras dos no es la fachada: es **cómo se autentica ella misma**.
 * Una variable de entorno no se autentica; una bóveda se autentica con un token
 * que alguien inyecta. Un gestor cloud se autentica con una identidad que la
 * plataforma le presta, y esa identidad **caduca**: hay que pedirla, guardarla,
 * y volver a pedirla antes de que deje de valer.
 *
 * Ese ciclo de vida vive aquí y no se filtra a ninguna parte. El puerto sigue
 * siendo `resolve(secretRef) → material`, y quien lo usa no sabe que por debajo
 * hubo dos peticiones, ni que una de ellas se ahorró.
 *
 * Se habla la API directamente en vez de montar el SDK del proveedor, por el
 * mismo motivo que con Redis y OpenTelemetry: lo que el servicio entiende es el
 * protocolo, y un SDK de nube es de las dependencias más pesadas que existen
 * para producir dos peticiones HTTP (decisión 0026).
 *
 * Ningún mensaje de error lleva material: se nombra la referencia, que es opaca
 * por diseño, nunca lo que hay al otro lado ni el token con que se pidió.
 */

interface Material {
  readonly value: string;
}

export interface GcpSecretsOptions {
  /**
   * De dónde se pide la identidad prestada. Por defecto, el servidor de
   * metadatos de la plataforma, que es el único sitio donde vive.
   */
  readonly metadataUrl?: string;
  /** La base de la API. Se parametriza para poder ejercitarla sin salir a la red. */
  readonly apiBase?: string;
  readonly timeoutMs?: number;
  /** Margen con que se renueva la identidad antes de que caduque. */
  readonly refreshMarginMs?: number;
  /** El instante, que en la cáscara es un dato y no un puerto. */
  readonly now?: () => number;
}

const METADATA_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';
const API_BASE = 'https://secretmanager.googleapis.com/v1';

/** `gcp-secrets://projects/<p>/secrets/<s>[/versions/<v>]`. */
function parse(secretRef: string): string {
  const name = secretRef.slice('gcp-secrets://'.length).replace(/\/+$/, '');
  if (!/^projects\/[^/]+\/secrets\/[^/]+(\/versions\/[^/]+)?$/.test(name)) {
    throw new Error(
      `La referencia \`${secretRef}\` no tiene la forma ` +
        '`gcp-secrets://projects/<proyecto>/secrets/<secreto>[/versions/<versión>]`.',
    );
  }
  // Sin versión, la última. Fijar una versión es lo que permite desplegar una
  // rotación de credencial sin que dependa de cuándo arrancó cada proceso.
  return name.includes('/versions/') ? name : `${name}/versions/latest`;
}

export function gcpSecretsCredentials(options: GcpSecretsOptions = {}): {
  resolve(secretRef: string): Promise<Material>;
} {
  const metadataUrl = options.metadataUrl ?? METADATA_URL;
  const apiBase = (options.apiBase ?? API_BASE).replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? 5_000;
  const refreshMarginMs = options.refreshMarginMs ?? 60_000;
  const now = options.now ?? ((): number => Date.now());

  /** La identidad prestada y hasta cuándo vale. Nunca sale de este módulo. */
  let prestada: { token: string; expiraEn: number } | undefined;
  let pidiendo: Promise<string> | undefined;

  async function pide(): Promise<string> {
    let response: Response;
    try {
      response = await fetch(metadataUrl, {
        headers: { 'Metadata-Flavor': 'Google' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      throw new Error('El servidor de metadatos no responde; no hay identidad con la que leer secretos.', {
        cause,
      });
    }
    if (!response.ok) {
      throw new Error(`El servidor de metadatos contestó ${response.status}; no hay identidad prestada.`);
    }

    const payload = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof payload.access_token !== 'string' || payload.access_token === '') {
      throw new Error('El servidor de metadatos no devolvió ninguna identidad utilizable.');
    }

    const duracion = typeof payload.expires_in === 'number' ? payload.expires_in * 1_000 : 0;
    prestada = { token: payload.access_token, expiraEn: now() + duracion };
    return payload.access_token;
  }

  function identidad(): Promise<string> {
    if (prestada !== undefined && prestada.expiraEn - refreshMarginMs > now()) {
      return Promise.resolve(prestada.token);
    }
    // Una sola petición en vuelo aunque lleguen diez invocaciones a la vez: al
    // arrancar, todas las cuentas se resuelven casi al mismo tiempo.
    pidiendo ??= pide().finally(() => {
      pidiendo = undefined;
    });
    return pidiendo;
  }

  return {
    async resolve(secretRef: string): Promise<Material> {
      if (!secretRef.startsWith('gcp-secrets://')) {
        throw new Error(
          `La referencia \`${secretRef}\` no es \`gcp-secrets://\`. Este adaptador solo resuelve secretos del gestor cloud.`,
        );
      }

      const name = parse(secretRef);
      const token = await identidad();

      let response: Response;
      try {
        response = await fetch(`${apiBase}/${name}:access`, {
          headers: { authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (cause) {
        // Gestor inalcanzable. Aborta: nunca degrada a ejecutar sin credencial.
        throw new Error(`El gestor de secretos no responde; \`${secretRef}\` no se puede resolver.`, { cause });
      }

      if (response.status === 401 || response.status === 403) {
        // La identidad prestada ya no vale. Se olvida, para que el siguiente
        // intento pida una nueva en vez de repetir la caducada para siempre.
        prestada = undefined;
        throw new Error(`El gestor de secretos niega el acceso a \`${secretRef}\`.`);
      }
      if (response.status === 404) {
        throw new Error(`La referencia \`${secretRef}\` no existe en el gestor de secretos.`);
      }
      if (!response.ok) {
        throw new Error(`El gestor de secretos contestó ${response.status} a \`${secretRef}\`.`);
      }

      let payload: { payload?: { data?: unknown } };
      try {
        payload = (await response.json()) as { payload?: { data?: unknown } };
      } catch (cause) {
        throw new Error(`El gestor de secretos contestó algo ininteligible a \`${secretRef}\`.`, { cause });
      }

      const data = payload.payload?.data;
      if (typeof data !== 'string' || data === '') {
        throw new Error(`El secreto \`${secretRef}\` no trae contenido utilizable.`);
      }

      // La API devuelve el contenido en base64. Un secreto que no decodifica es
      // un secreto que no sirve, y decirlo es mejor que entregar bytes rotos.
      const value = Buffer.from(data, 'base64').toString('utf8');
      if (value === '') throw new Error(`El secreto \`${secretRef}\` viene vacío.`);
      return { value };
    },
  };
}
