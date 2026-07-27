/**
 * El criterio mecánico de terminación de S4 (`docs/sesiones.md` §5).
 *
 * > El artefacto desplegable se construye y arranca desde cero contra una
 * > política de ejemplo.
 *
 * La frase tiene tres trampas, y las tres se cierran aquí:
 *
 * 1. **"se construye"** puede pasar sin demostrar nada si el arnés construye a su
 *    manera. Se ejecuta `deployment/package.js`, que es lo mismo que se ejecuta a
 *    mano y lo mismo que copia la imagen: un solo empaquetado, comprobado.
 * 2. **"desde cero"** puede pasar apoyándose sin querer en el árbol de trabajo.
 *    El proceso arranca **fuera** del repositorio, con un entorno podado, y se
 *    comprueba que el artefacto no lleva ni fuentes ni herramientas de desarrollo.
 *    Y hay un caso —un artefacto sin su cierre de dependencias— que solo se cae
 *    al arrancarlo, que es la razón de arrancarlo.
 * 3. **"arranca"** puede pasar con un proceso que solo sigue vivo. Aquí un
 *    cliente MCP de verdad se conecta por los dos transportes, ve exactamente lo
 *    concedido, recibe motivo y sitio cuando se le deniega, y una concesión llega
 *    hasta el upstream con su credencial.
 *
 * Y lo que S4 añade de operación —sonda, techo de petición, parada ordenada—
 * lleva su caso de fallo, porque una comprobación que nunca ha fallado no está
 * verificada (`docs/sesiones.md` §2).
 */
import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { productVersion } from '../../deployment/package.js';
import { REPO_ROOT } from '../lib/run-checks.js';
import {
  clienteHttp,
  CLAVE_DE_CLIENTE,
  CREDENCIAL_DE_CUENTA,
  EJEMPLO,
  empaqueta,
  lanza,
  porHttp,
  porStdio,
  termina,
  type Artefacto,
  type RecorridoDeCliente,
  type Servidor,
} from '../lib/artifact.js';

const execFileAsync = promisify(execFile);

const FIXTURES = join(REPO_ROOT, 'verification', 'fixtures', 'violations');

/** Lo que un despliegue no tiene por qué cargar, y que delataría un empaquetado que arrastra el taller. */
const HERRAMIENTAS_DE_TALLER = ['typescript', 'vitest', 'eslint', 'dependency-cruiser', 'fast-check'];

/** El plazo de un orquestador antes de recurrir a SIGKILL. Generoso: aquí no se mide velocidad. */
const PLAZO_DE_PARADA = 15_000;

let artefacto: Artefacto;

beforeAll(async () => {
  artefacto = await empaqueta();
}, 300_000);

// ─────────────────────────────────────────────────────────────────────────────

describe('el artefacto desplegable se construye', () => {
  it('dice la misma versión que el repositorio del que salió', async () => {
    const raiz = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as { version: string };
    expect(artefacto.version).toBe(raiz.version);

    const { stdout } = await execFileAsync(process.execPath, [artefacto.entry, 'version'], {
      cwd: artefacto.afuera,
    });
    // Es la primera pregunta de cualquier incidencia, y tiene que contestarla el
    // artefacto, no el repositorio.
    expect(stdout).toContain(`mcpizer ${raiz.version}`);
  });

  it('y no se empaqueta si los dos manifiestos dicen versiones distintas', () => {
    // El descuido silencioso: nada se rompe, nada avisa, y el día de una
    // incidencia el número que imprime el proceso no corresponde a ningún commit.
    expect(() => productVersion(join(FIXTURES, 'version-desalineada'))).toThrow(/no coinciden/);
  });

  it('no lleva fuentes: lo que viaja es lo compilado', () => {
    const fuentes = ficheros(join(artefacto.dir, 'dist')).filter(
      (fichero) => fichero.endsWith('.ts') && !fichero.endsWith('.d.ts'),
    );
    expect(fuentes).toEqual([]);
  });

  it('no lleva el taller: ni compilador, ni linter, ni ejecutor de tests', () => {
    const closure = readdirSync(join(artefacto.dir, 'node_modules', '.pnpm'));
    const infiltradas = HERRAMIENTAS_DE_TALLER.filter((herramienta) =>
      closure.some((entrada) => entrada.startsWith(`${herramienta}@`)),
    );
    // Lo que no viaja no hay que parchearlo, y no amplía la superficie de nadie.
    expect(infiltradas).toEqual([]);
  });

  it('lleva su cierre de dependencias, y no el del repositorio', () => {
    // El SDK de MCP es la dependencia de producción cuya ausencia rompería todo.
    expect(existsSync(join(artefacto.dir, 'node_modules', '.pnpm'))).toBe(true);
    const closure = readdirSync(join(artefacto.dir, 'node_modules', '.pnpm'));
    expect(closure.some((entrada) => entrada.startsWith('@modelcontextprotocol+sdk@'))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('y arranca desde cero contra la política de ejemplo', () => {
  let cliente: RecorridoDeCliente;

  beforeAll(async () => {
    cliente = await porStdio(artefacto, EJEMPLO);
  }, 120_000);

  afterAll(async () => {
    await cliente.close();
  });

  it('anuncia solo lo concedido a la identidad con la que se conecta', () => {
    // `ci` tiene una sola concesión. Las tres tools de CRM existen en el catálogo
    // y no se le conceden, así que no salen marcadas: no salen (invariante 3).
    expect(cliente.listadas).toEqual(['facturacion__create_invoice']);
  });

  it('deniega lo no concedido con motivo y con el sitio exacto del artefacto', async () => {
    const denegada = await cliente.llama('crm-principal__get_contact');
    expect(denegada.isError).toBe(true);
    expect(denegada.texto).toContain('no_grant_matches');
    // El bucle de corrección del invariante 4 depende de que el sitio exista.
    expect(denegada.texto).toMatch(/policy\.yaml:\d+:\d+/);
  });

  it('trata un nombre inexistente sin inventarse un motivo del vocabulario cerrado', async () => {
    const inexistente = await cliente.llama('facturacion__no_existe');
    expect(inexistente.isError).toBe(true);
    expect(inexistente.texto).not.toContain('no_grant_matches');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('la concesión llega hasta el upstream, con su credencial', () => {
  let cliente: RecorridoDeCliente;

  beforeAll(async () => {
    // Con la política de ejemplo no se puede: sus upstreams son un comando y una
    // URL internas que no existen, y así debe ser en un ejemplo de documentación.
    // Pero sin esto quedaría sin ejercitar la mitad **cliente** del protocolo, que
    // es la que un empaquetado incompleto se llevaría por delante en silencio.
    cliente = await porStdio(artefacto, artefacto.conUpstream);
  }, 120_000);

  afterAll(async () => {
    await cliente.close();
  });

  it('invoca de verdad, y el upstream confirma que la credencial llegó', async () => {
    const concedida = await cliente.llama('facturacion__create_invoice', { customerId: 'c-1' });
    expect(concedida.isError).toBe(false);
    expect(concedida.texto).toContain('"credentialRecibida":true');
    expect(concedida.texto).toContain('"tool":"create_invoice"');
  });

  it('y nada canjeable vuelve al cliente', async () => {
    const concedida = await cliente.llama('facturacion__create_invoice', { customerId: 'c-2' });
    expect(concedida.texto).not.toContain(CREDENCIAL_DE_CUENTA);
    expect(concedida.texto).not.toContain(CLAVE_DE_CLIENTE);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('por HTTP: sonda, techo de petición y parada ordenada', () => {
  let servidor: Servidor;

  beforeAll(async () => {
    servidor = await porHttp(artefacto, EJEMPLO);
  }, 120_000);

  it('la sonda contesta sin credencial, y sin nada canjeable dentro', async () => {
    const respuesta = await fetch(servidor.url.replace('/mcp', '/health'));
    expect(respuesta.status).toBe(200);

    const cuerpo = await respuesta.text();
    expect(JSON.parse(cuerpo)).toMatchObject({ status: 'ok', version: artefacto.version });
    // Quien la interroga es un orquestador anónimo: todo lo que salga por aquí es
    // público (invariante 6).
    expect(cuerpo).not.toContain(CLAVE_DE_CLIENTE);
    expect(cuerpo).not.toContain(CREDENCIAL_DE_CUENTA);
    // Ni la ruta del artefacto de política, que describe la instalación.
    expect(cuerpo).not.toContain(EJEMPLO.policy);
  });

  it('un cliente MCP por HTTP ve lo mismo que uno por stdio', async () => {
    const cliente = await clienteHttp(servidor.url);
    expect(cliente.listadas).toEqual(['facturacion__create_invoice']);
    await cliente.close();
  });

  it('rechaza un cuerpo por encima del techo antes de decidir nada', async () => {
    const respuesta = await fetch(servidor.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': String(2 * 1024 * 1024) },
      body: 'x'.repeat(2 * 1024 * 1024),
    });
    expect(respuesta.status).toBe(413);
  });

  it('y no rechaza lo que cabe: el techo acota, no cierra', async () => {
    // Sin esto, un servidor que contestara 413 a todo pasaría la comprobación de
    // arriba y no atendería a nadie.
    const respuesta = await fetch(servidor.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    expect(respuesta.status).not.toBe(413);
  });

  it('SIGTERM cierra ordenadamente y sale con 0', async () => {
    const salida = await servidor.para('SIGTERM', PLAZO_DE_PARADA);
    // Con código propio: morir *por* la señal significa que nadie cerró nada.
    expect(salida).toEqual({ code: 0, signal: null });
  }, 60_000);
});

describe('SIGINT también, que es lo que llega desde una terminal', () => {
  it('sale con 0', async () => {
    const servidor = await porHttp(artefacto, EJEMPLO);
    expect(await servidor.para('SIGINT', PLAZO_DE_PARADA)).toEqual({ code: 0, signal: null });
  }, 120_000);
});

describe('y para aunque haya alguien conectado sin decir nada', () => {
  it('un socket aceptado que nunca pide nada no cuelga el cierre', async () => {
    // El caso que de verdad ocurre en un contenedor: una sonda TCP de un
    // balanceador, un `readinessProbe` de tipo tcpSocket, un escaneo de puertos.
    // Ese socket no está ocioso —nunca ha servido una petición—, así que cerrar
    // solo las conexiones ociosas deja el cierre esperando para siempre.
    const servidor = await porHttp(artefacto, EJEMPLO);
    const { hostname, port } = new URL(servidor.url);

    const mudo = connect({ host: hostname, port: Number(port) });
    await new Promise<void>((resolve, reject) => {
      mudo.once('connect', () => resolve());
      mudo.once('error', reject);
    });

    try {
      expect(await servidor.para('SIGTERM', PLAZO_DE_PARADA)).toEqual({ code: 0, signal: null });
    } finally {
      mudo.destroy();
    }
  }, 120_000);
});

describe('un arranque que falla sale, y no se queda colgado', () => {
  it('una bandera mal escrita sale con 2 antes de abrir nada', async () => {
    // Con `--discover` sobre un upstream que sí responde: comprobada *después*
    // de arrancar el descubrimiento, esta bandera dejaría un proceso con código
    // de uso fijado que nunca se entrega, porque el hijo ya arrancado mantiene
    // vivo el bucle de eventos. Lo barato de detectar se detecta antes.
    const salida = await termina([
      artefacto.entry,
      'serve',
      artefacto.conUpstream.policy,
      '--discover',
      '--issuer',
      'ci',
      '--http',
      '--port',
      'setenta',
    ]);
    expect(salida.code).toBe(2);
  }, 60_000);

  it('un origen inalcanzable sale con 3, no se queda esperando', async () => {
    const salida = await termina([
      artefacto.entry,
      'serve',
      join(artefacto.afuera, 'no-existe.yaml'),
      '--catalog',
      EJEMPLO.catalog,
      '--issuer',
      'ci',
    ]);
    expect(salida.code).toBe(3);
  }, 60_000);

  it('y un arranque a medias termina: un upstream responde y el otro no', async () => {
    // El peor caso, y el que de verdad ocurre: el descubrimiento ya abrió un
    // proceso hijo cuando el segundo upstream lo hace fallar. El operador ve el
    // mensaje correcto — y sin cerrar el descubrimiento, el proceso no muere.
    const salida = await termina([
      artefacto.entry,
      'serve',
      artefacto.conUpstreamCaido.policy,
      '--discover',
      '--issuer',
      'ci',
    ]);
    expect(salida.code).toBe(3);
  }, 60_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// Y cada una tiene un caso que la hace fallar.
// ─────────────────────────────────────────────────────────────────────────────

describe('el criterio de S4 tiene casos que lo hacen fallar', () => {
  it('un artefacto sin su cierre de dependencias no arranca', async () => {
    const destino = join(artefacto.afuera, 'sin-cierre');
    await execFileAsync(
      process.execPath,
      [join(FIXTURES, 'artefacto-sin-cierre', 'mutila.js'), artefacto.dir, destino],
      { cwd: REPO_ROOT },
    );

    // Tiene punto de entrada, tiene versión y `ls` no delata nada. Solo se cae al
    // arrancarlo, que es exactamente por lo que la comprobación lo arranca.
    expect(existsSync(join(destino, 'dist', 'cli', 'main.js'))).toBe(true);
    await expect(
      porStdio({ ...artefacto, entry: join(destino, 'dist', 'cli', 'main.js') }, EJEMPLO),
    ).rejects.toThrow();
  }, 120_000);

  it('un proceso que no atiende SIGTERM muere por la señal, no con código', async () => {
    const servidor = await lanza(
      [join(FIXTURES, 'apagado-sin-manejador', 'serve.js')],
      artefacto.afuera,
    );
    const salida = await servidor.para('SIGTERM', PLAZO_DE_PARADA);
    expect(salida.code).not.toBe(0);
    expect(salida.signal).toBe('SIGTERM');
  }, 60_000);

  it('y uno que lo atiende sin soltar lo que tenía abierto no termina', async () => {
    // El descuido que parece corrección: hay manejador, hay `close()`, y el
    // apagado sigue siendo sucio. Sin este caso, la comprobación de arriba
    // pasaría mirando solo si el manejador existe.
    const servidor = await lanza([join(FIXTURES, 'apagado-que-no-suelta', 'serve.js')], artefacto.afuera);
    await expect(servidor.para('SIGTERM', 3_000)).rejects.toThrow(/no terminó/);
  }, 60_000);
});

// ─────────────────────────────────────────────────────────────────────────────

/** Los ficheros de un árbol, en rutas relativas a él. */
function ficheros(raiz: string): string[] {
  const encontrados: string[] = [];
  const recorre = (dir: string): void => {
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
      const completa = join(dir, entrada.name);
      if (entrada.isDirectory()) recorre(completa);
      else encontrados.push(completa);
    }
  };
  recorre(raiz);
  return encontrados;
}
