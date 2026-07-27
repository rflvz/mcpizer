/**
 * `PolicySource` sobre HTTP.
 *
 * Es la tercera implementación que `docs/diseno/puertos.md` §2.2 daba por
 * prevista, y la que corresponde a un artefacto servido por algo que no es un
 * sistema de ficheros ni un repositorio: un servidor de configuración, un
 * *bucket*, un operador que lo publica.
 *
 * Frente a fichero y git trae un modo de fallo que ninguno de los dos tiene: el
 * origen puede contestar **otra cosa**. Un portal cautivo, un balanceador que
 * devuelve su página de error o un proxy que interpone HTML producen una
 * respuesta con código 200 y un cuerpo que no es la política. Por eso la versión
 * es la huella del contenido y no lo que diga el servidor: un `ETag` que no
 * cambia mientras el cuerpo sí lo hace convertiría un cambio de autorización en
 * algo invisible.
 *
 * **Exige canal autenticado.** El artefacto es lo que decide quién puede hacer
 * qué; traerlo por un canal que cualquiera en el camino puede reescribir es
 * entregar la autorización a quien esté en medio. Se admite `http://` solo
 * contra la interfaz de bucle, que es donde no hay camino (decisión 0038).
 */
import { createHash } from 'node:crypto';

interface LoadedArtifact {
  readonly text: string;
  /** Etiqueta que permite saber si el artefacto ha cambiado. Aquí, la huella del cuerpo. */
  readonly version: string;
  readonly origin: string;
}

export interface HttpOrigin {
  readonly url: string;
  /** Corta la espera: un origen que no contesta tiene que abortar el arranque, no colgarlo. */
  readonly timeoutMs?: number;
}

/** Los nombres que no salen a ninguna red. */
const BUCLE = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * `http(s)://…` como especificador de política.
 *
 * Devuelve `undefined` para cualquier otra forma, igual que `parseGitOrigin`:
 * así el despachador prueba las formas en orden y lo que no reconoce nadie
 * acaba siendo una ruta de fichero.
 */
export function parseHttpOrigin(specifier: string): HttpOrigin | undefined {
  if (!specifier.startsWith('http://') && !specifier.startsWith('https://')) return undefined;

  let url: URL;
  try {
    url = new URL(specifier);
  } catch {
    return undefined;
  }

  if (url.protocol === 'http:' && !BUCLE.has(url.hostname)) {
    throw new Error(
      `\`${specifier}\` traería la política por un canal que cualquiera en el camino puede reescribir. ` +
        'El artefacto decide quién puede hacer qué: usa `https://`, o móntalo como fichero.',
    );
  }

  return { url: specifier };
}

export function policyHttp(origin: HttpOrigin): { load(): Promise<LoadedArtifact> } {
  const timeoutMs = origin.timeoutMs ?? 10_000;

  return {
    async load(): Promise<LoadedArtifact> {
      let response: Response;
      try {
        response = await fetch(origin.url, {
          // Sin caché intermedia: una política vieja servida desde un proxy es
          // una decisión de autorización vieja, y nadie se enteraría.
          headers: { accept: 'application/yaml, text/yaml, text/plain, */*', 'cache-control': 'no-cache' },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (cause) {
        throw new Error(`El origen \`${origin.url}\` no responde.`, { cause });
      }

      if (!response.ok) {
        // Ni política vacía ni valores por defecto: arranque fallido. Una
        // política vacía sería válida y lo denegaría todo, que es seguro e
        // indistinguible de un fallo de infraestructura.
        throw new Error(`El origen \`${origin.url}\` contestó ${response.status}.`);
      }

      const text = await response.text();
      if (text.trim() === '') {
        throw new Error(`El origen \`${origin.url}\` devolvió un cuerpo vacío.`);
      }

      return {
        text,
        version: createHash('sha256').update(text).digest('hex').slice(0, 12),
        origin: origin.url,
      };
    },
  };
}
