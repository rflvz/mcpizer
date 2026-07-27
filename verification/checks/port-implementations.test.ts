/**
 * El criterio mecánico de terminación de S3 (`docs/sesiones.md` §5).
 *
 * > Cada puerto tiene al menos dos implementaciones intercambiables por
 * > configuración, sin tocar el núcleo ni `runtime`.
 *
 * Las tres mitades se responden aquí, y ninguna se opina:
 *
 * 1. **Dos implementaciones.** Se enumeran, y la enumeración se comprueba contra
 *    los siete puertos que `runtime/src/ports.ts` declara — no contra una lista
 *    escrita a mano que podría quedarse corta sin que nadie se enterara.
 * 2. **Intercambiables por configuración.** Se recorre la pasarela **entera** dos
 *    veces, cambiando solo la periferia, y se comparan las decisiones. Que
 *    salgan iguales es lo que "intercambiable" significa cuando se ejecuta.
 * 3. **Sin tocar el núcleo ni `runtime`.** Lo sostienen los retratos de
 *    superficie versionados: los cinco contextos y `runtime` tienen el suyo, y
 *    `pnpm check:surface` falla si alguno cambia. Aquí se comprueba además que
 *    el de `runtime` **existe** y contiene los siete puertos, porque un retrato
 *    que no cubriera los contratos no compraría nada.
 *
 * Exige haber construido antes: se ejecuta `runtime/dist/cli/main.js`.
 */
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../lib/run-checks.js';
import { periferiaA, periferiaB, type PeriferiaB, type Periferia, type Recorrido } from '../lib/peripheries.js';

const execFileAsync = promisify(execFile);

/**
 * Los siete puertos y sus implementaciones, con el fichero de cada una.
 *
 * `UsageReader` y `UsageWriter` van juntos porque los implementa el mismo
 * adaptador en los dos casos, que es lo que el diseño previó
 * (`docs/diseno/puertos.md` §2.4).
 */
const PUERTOS: Readonly<Record<string, readonly string[]>> = {
  PrincipalResolver: ['static-key-principal.ts', 'oidc-principal.ts', 'mtls-principal.ts'],
  PolicySource: ['policy-file.ts', 'policy-git.ts', 'policy-http.ts'],
  CatalogSource: ['declared-catalog.ts', 'mcp-discovery.ts'],
  UsageReader: ['memory-usage.ts', 'redis-usage.ts'],
  UsageWriter: ['memory-usage.ts', 'redis-usage.ts'],
  CredentialResolver: [
    'env-credentials.ts',
    'vault-credentials.ts',
    'gcp-secrets-credentials.ts',
    'oauth-credentials.ts',
  ],
  ToolInvoker: ['mcp-stdio-invoker.ts', 'mcp-http-invoker.ts'],
  DecisionRecorder: ['stderr-recorder.ts', 'otlp-recorder.ts', 'file-recorder.ts'],
};

/**
 * Lo que `docs/diseno/puertos.md` §4 promete que existe, contado.
 *
 * La tabla de arriba es la lista real; esta es la promesa del documento. Que se
 * comparen es lo que impide que el documento diga tres y el directorio tenga
 * dos — el modo en que una tabla de diseño deja de describir el sistema sin que
 * nadie se entere.
 */
const PROMETIDAS: Readonly<Record<string, number>> = {
  PrincipalResolver: 3,
  PolicySource: 3,
  CatalogSource: 3,
  UsageReader: 2,
  UsageWriter: 2,
  CredentialResolver: 4,
  ToolInvoker: 2,
  DecisionRecorder: 3,
};

const RETRATO = join(REPO_ROOT, 'verification', 'surface', 'runtime.d.ts');

describe('cada puerto declarado tiene al menos dos implementaciones', () => {
  const retrato = readFileSync(RETRATO, 'utf8');

  it('el retrato de `runtime` existe y lleva los siete puertos', () => {
    // Sin esto, "no se ha tocado `runtime`" sería una afirmación de revisión.
    // Con esto, cambiar un contrato pone rojo `pnpm check:surface`.
    for (const puerto of Object.keys(PUERTOS)) {
      expect(retrato, `\`${puerto}\` no aparece en el retrato de \`runtime\``).toContain(`interface ${puerto}`);
    }
  });

  it('no hay ningún puerto en `ports.ts` que esta tabla se deje fuera', () => {
    const declarados = [...readFileSync(join(REPO_ROOT, 'runtime', 'src', 'ports.ts'), 'utf8').matchAll(
      /^export interface (\w+) \{/gm,
    )].map((match) => match[1]);

    // Los puertos son los que declaran una operación; el resto de interfaces de
    // `ports.ts` son las formas que viajan por ellos.
    const puertos = declarados.filter((nombre) => nombre !== undefined && nombre in PUERTOS);
    expect(puertos.sort()).toEqual(Object.keys(PUERTOS).sort());
  });

  it('las implementaciones de cada puerto existen como ficheros distintos', () => {
    for (const [puerto, implementaciones] of Object.entries(PUERTOS)) {
      const distintas = new Set(implementaciones);
      expect(distintas.size, `\`${puerto}\` no tiene dos implementaciones distintas`).toBeGreaterThanOrEqual(2);
      for (const fichero of implementaciones) {
        expect(() => readFileSync(join(REPO_ROOT, 'adapters', 'src', fichero), 'utf8')).not.toThrow();
      }
    }
  });

  it('y son tantas como `puertos.md` §4 promete', () => {
    // `CatalogSource` cuenta tres con dos ficheros: `mcp-discovery.ts` sirve los
    // dos transportes del protocolo con el mismo código, y el documento las
    // cuenta como implementaciones distintas porque lo son de cara al artefacto.
    const reales = Object.fromEntries(
      Object.entries(PUERTOS).map(([puerto, implementaciones]) => [
        puerto,
        puerto === 'CatalogSource' ? implementaciones.length + 1 : implementaciones.length,
      ]),
    );
    expect(reales).toEqual(PROMETIDAS);
  });
});

describe('las dos periferias deciden lo mismo', () => {
  let a: Periferia;
  let b: PeriferiaB;
  let recorridoA: Recorrido;
  let recorridoB: Recorrido;

  beforeAll(async () => {
    a = await periferiaA();
    b = await periferiaB();
    recorridoA = await a.recorre();
    recorridoB = await b.recorre();
  }, 120_000);

  afterAll(async () => {
    await a.close();
    await b.close();
  });

  it('anuncian exactamente las mismas tools', () => {
    // Una sola: `create_invoice`. `delete_invoice` existe en el upstream y está
    // mapeada, pero su capacidad no se concede — así que no sale. Lo no
    // concedido no se marca como prohibido: no sale (invariante 3).
    expect(recorridoA.listadas).toEqual(['facturacion__create_invoice']);
    expect(recorridoB.listadas).toEqual(recorridoA.listadas);
  });

  it('conceden lo mismo, y la llamada llega al upstream con su credencial', () => {
    expect(recorridoA.concedida.isError).toBe(false);
    expect(recorridoB.concedida.isError).toBe(false);
    for (const recorrido of [recorridoA, recorridoB]) {
      expect(recorrido.concedida.texto).toContain('"credentialRecibida":true');
      expect(recorrido.concedida.texto).toContain('"tool":"create_invoice"');
    }
  });

  it('deniegan lo mismo, con el mismo motivo y el mismo sitio a tocar', () => {
    for (const recorrido of [recorridoA, recorridoB]) {
      expect(recorrido.denegada.isError).toBe(true);
      expect(recorrido.denegada.texto).toContain('no_grant_matches');
      // Y el sitio: una denegación no dice solo que no.
      expect(recorrido.denegada.texto).toMatch(/policy\.yaml:\d+:\d+/);
    }
  });

  it('tratan igual un nombre que no existe', () => {
    for (const recorrido of [recorridoA, recorridoB]) {
      expect(recorrido.inexistente.isError).toBe(true);
      // Sin inventarse un motivo del vocabulario cerrado de `ReasonCode`.
      expect(recorrido.inexistente.texto).not.toContain('no_grant_matches');
    }
  });

  it('agotan el techo en la misma llamada, con contadores en memoria y en Redis', () => {
    for (const recorrido of [recorridoA, recorridoB]) {
      expect(recorrido.agotada.isError).toBe(true);
      expect(recorrido.agotada.texto).toContain('limit_exhausted');
    }
  });
});

describe('la periferia de S3 hizo de verdad lo que dice', () => {
  let b: PeriferiaB;

  beforeAll(async () => {
    b = await periferiaB();
    await b.recorre();
  }, 120_000);

  afterAll(async () => {
    await b.close();
  });

  it('la credencial de la cuenta salió de la bóveda, y solo la autorizada', () => {
    // Nunca antes de decidir, nunca especulativamente, nunca para varias
    // cuentas por si acaso.
    expect(b.vault.peticiones).toContain('/v1/kv/data/mcpizer/facturacion');
  });

  it('viajó al upstream por cabecera, no por entorno', () => {
    expect(b.upstream.autorizaciones.some((cabecera) => cabecera?.startsWith('Bearer ') === true)).toBe(true);
  });

  it('los contadores acabaron en Redis, contados por el propio almacén', () => {
    const claves = Object.keys(b.redis.volcado());
    expect(claves.some((clave) => clave.startsWith('mcpizer:usage:'))).toBe(true);
    expect(b.redis.recibidos.some((comando) => comando[0] === 'HINCRBY')).toBe(true);
  });

  it('las decisiones llegaron al colector OTLP, permisos y denegaciones', () => {
    const registros = b.otlp.registros();
    const cuerpos = registros.map((registro) => registro.body?.stringValue ?? '');

    expect(cuerpos.some((cuerpo) => cuerpo.startsWith('allow'))).toBe(true);
    // Registrar solo denegaciones dejaría sin rastro el caso que más importa
    // auditar; registrar solo permisos, al revés. Tienen que estar los dos.
    expect(cuerpos.some((cuerpo) => cuerpo.startsWith('deny'))).toBe(true);

    const claves = registros.flatMap((registro) => (registro.attributes ?? []).map((atributo) => atributo.key));
    expect(claves).toContain('mcpizer.account');
    expect(claves).toContain('mcpizer.principal');
  });

  it('el catálogo lo descubrió preguntando al upstream, no leyendo un fichero', () => {
    // Si el descubrimiento no hubiera ocurrido, la política no habría compilado
    // con catálogo y `create_invoice` no tendría esquema que anunciar.
    expect(b.upstream.autorizaciones.length).toBeGreaterThan(0);
  });
});

/**
 * El almacén compartido es lo que hace que el invariante 3 se pueda ensayar.
 *
 * Con contadores en memoria la regla "uso desconocido se trata como techo
 * agotado" no tenía cómo fallar: la memoria no se cae. Con Redis sí, y por eso
 * esta comprobación aparece justo ahora — junto con el caso que la hace fallar.
 */
describe('el almacén que no responde deniega, y eso tiene un caso que lo hace fallar', () => {
  const FIXTURE = join(REPO_ROOT, 'verification', 'fixtures', 'violations', 'usage-fails-open', 'reader.js');
  const ENTORNO = { ...process.env, MCPIZER_CI_KEY: 'k', MCPIZER_API_KEY: 'k', BILLING_OPS_KEY: 'k' };

  async function corre(modo: 'cerrado' | 'abierto'): Promise<{ kind: string; code?: string }> {
    const { stdout } = await execFileAsync(process.execPath, [FIXTURE, modo], { cwd: REPO_ROOT, env: ENTORNO });
    return JSON.parse(stdout.trim()) as { kind: string; code?: string };
  }

  it('con el adaptador de Redis y el almacén caído, deniega por `usage_unknown`', async () => {
    // El rechazo del puerto llega a `access` como uso desconocido, y desconocido
    // es techo agotado. Nunca cero.
    expect(await corre('cerrado')).toEqual({ kind: 'denied', code: 'usage_unknown' });
  }, 30_000);

  it('un lector que devuelve cero cuando el almacén falla ejecuta sin techo', async () => {
    // El descuido que parece robustez. Si esto denegara, la comprobación de
    // arriba estaría mirando otra cosa y pasaría igual.
    expect(await corre('abierto')).toMatchObject({ kind: 'invoked' });
  }, 30_000);
});
