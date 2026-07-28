/**
 * El criterio mecánico de esta sesión.
 *
 * > Lo que se publica se instala con `npm` y arranca, desde cero y sin red.
 *
 * Hasta aquí el producto se conseguía de dos maneras, y las dos exigían este
 * repositorio: clonarlo, o construir el artefacto desde él. Publicar es la
 * tercera, y es la única en la que **el repositorio no interviene** — lo que
 * llega a quien instala es un tarball, y lo que ese tarball no lleve no existe.
 *
 * La frase tiene las mismas trampas que la de S4, y se cierran igual:
 *
 * 1. **"lo que se publica"** puede pasar sin demostrar nada si el arnés empaqueta
 *    a su manera. Los siete tarballs los produce `pnpm pack`, que es el camino
 *    que recorre `pnpm publish`; y el manifiesto que se anuncia se lee **del
 *    tarball**, no del árbol de trabajo, porque la sustitución de `workspace:*`
 *    es justo lo que hay que comprobar.
 * 2. **"se instala"** puede pasar contra un doble que conteste que sí. Se instala
 *    con el `npm` de verdad contra un registro que habla su protocolo, cuyo
 *    espejo es el cierre que fijó el fichero de bloqueo: lo que nadie declaró no
 *    está, así que no se resuelve por casualidad.
 * 3. **"arranca"** puede pasar mirando si el fichero existe. Aquí se ejecuta el
 *    binario **por su nombre**, fuera del repositorio y con el entorno podado, y
 *    un cliente MCP de verdad se conecta a él.
 *
 * Y cada una lleva su caso de fallo (`docs/sesiones.md` §2), incluido el único
 * que ningún manifiesto delata y solo aparece al instalar de verdad.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { publicables, PUBLICABLES } from '../../deployment/publish.js';
import { EJEMPLO, entorno, recorre, type RecorridoDeCliente } from '../lib/artifact.js';
import {
  conNpx,
  ejecuta,
  instala,
  instalacion,
  propios,
  registro,
  type Instalacion,
} from '../lib/installation.js';
import { REPO_ROOT } from '../lib/run-checks.js';

const execFileAsync = promisify(execFile);

const FIXTURES = join(REPO_ROOT, 'verification', 'fixtures', 'violations');

let instalado: Instalacion;
/** El ejemplo, copiado fuera del repositorio: el instalado no lo toca ni de lectura. */
let ejemplo: { policy: string; catalog: string };

beforeAll(async () => {
  instalado = await instalacion();

  const policy = join(instalado.afuera, basename(EJEMPLO.policy));
  const catalog = join(instalado.afuera, basename(EJEMPLO.catalog));
  await copyFile(EJEMPLO.policy, policy);
  await copyFile(EJEMPLO.catalog, catalog);
  ejemplo = { policy, catalog };
}, 300_000);

afterAll(async () => {
  await instalado?.registro.detiene();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('lo que se publica se instala', () => {
  it('deja un `mcpizer` en el PATH que dice la versión del producto', async () => {
    expect(existsSync(instalado.bin)).toBe(true);

    // Por su nombre, no con `node <ruta>`: lo que se comprueba es el enlace que
    // npm dejó, shebang incluido.
    const { code, stdout } = await ejecuta(instalado, ['version']);
    expect(code).toBe(0);
    expect(stdout).toContain(`mcpizer ${instalado.version}`);
  });

  it('y los siete siguen siendo siete: la frontera sobrevive al publicado', async () => {
    // La frontera entre contextos no la sostiene una convención sino el gestor
    // de módulos (`docs/diseno/verificacion.md` §1). Si publicar aplanara los
    // siete paquetes en uno, esa frontera existiría en el árbol de trabajo y no
    // en lo que la gente instala — que es verificar otra cosa.
    const nombres = (await propios()).map(({ manifiesto }) => manifiesto.name).sort();
    expect(nombres).toHaveLength(PUBLICABLES.length);

    // Cada contexto aterriza como un paquete suyo, con su propio manifiesto y su
    // propia superficie declarada. Es la misma frontera de siempre, sostenida por
    // el mismo mecanismo, en un árbol que no es este.
    const aparte = nombres
      .filter((nombre) => nombre !== 'mcpizer')
      .filter((nombre) => existsSync(join(instalado.raiz, 'node_modules', nombre, 'package.json')));
    expect(aparte).toHaveLength(PUBLICABLES.length - 1);
  });

  it('valida el ejemplo sin red y sin repositorio a la vista', async () => {
    const { code, stdout } = await ejecuta(instalado, [
      'validate',
      ejemplo.policy,
      '--catalog',
      ejemplo.catalog,
    ]);
    expect(code).toBe(0);
    expect(stdout.toLowerCase()).not.toContain('error');
  });

  it('explica una denegación con motivo y con el sitio del artefacto', async () => {
    const { stdout } = await ejecuta(instalado, [
      'explain',
      ejemplo.policy,
      '--catalog',
      ejemplo.catalog,
      '--issuer',
      'corp',
      '--subject',
      'ana',
      '--attr',
      'team=compras',
      '--capability',
      'billing.invoice.issue',
    ]);

    // El bucle de corrección del invariante 4 tiene que llegar entero hasta aquí:
    // sin el sitio, una denegación es una opinión.
    expect(stdout).toContain('no_grant_matches');
    expect(stdout).toMatch(/policy\.yaml:\d+:\d+/);
  });

  it('y `npx mcpizer` contesta lo mismo sin instalar nada', async () => {
    // Es lo primero que ofrece el README, y el camino que de verdad recorre
    // quien solo quiere preguntarle una cosa a una política. Resuelve, descarga
    // y ejecuta en un paso, en un árbol que no es el de nadie.
    const { code, stdout } = await conNpx(instalado.registro, ['version']);
    expect(code).toBe(0);
    expect(stdout).toContain(`mcpizer ${instalado.version}`);
  }, 120_000);

  it('y un cliente MCP real se conecta a lo instalado y ve solo lo concedido', async () => {
    const cliente: RecorridoDeCliente = await recorre(
      new StdioClientTransport({
        command: instalado.bin,
        args: ['serve', ejemplo.policy, '--catalog', ejemplo.catalog, '--issuer', 'ci'],
        env: entorno(),
        cwd: instalado.afuera,
        stderr: 'ignore',
      }),
    );

    try {
      expect(cliente.listadas).toEqual(['facturacion__create_invoice']);

      const denegada = await cliente.llama('crm-principal__get_contact');
      expect(denegada.isError).toBe(true);
      expect(denegada.texto).toContain('no_grant_matches');
    } finally {
      await cliente.close();
    }
  }, 60_000);
});

// ─────────────────────────────────────────────────────────────────────────────

describe('publicar se niega antes de subir nada', () => {
  const DESCUIDOS = [
    ['privado', /sigue marcado como `private`/],
    ['desalineado', /tienen que decir la misma versión/],
    ['sin-construir', /no está construido/],
    ['sin-shebang', /no empieza por shebang/],
  ] as const;

  it.each(DESCUIDOS)('se niega con un %s', async (descuido, esperado) => {
    const destino = await mkdtemp(join(tmpdir(), `mcpizer-${descuido}-`));
    await execFileAsync(
      process.execPath,
      [join(FIXTURES, 'publicado-roto', 'mutila.js'), destino, descuido],
      { cwd: REPO_ROOT },
    );

    const { problemas } = publicables(destino);
    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toMatch(esperado);
  });

  it('y sobre este repositorio lo único que falta es elegir licencia', () => {
    // La licencia no la elige el diseño ni esta comprobación: es del dueño
    // (decisión 0042). Lo que sí puede afirmarse es que no falta **nada más**,
    // de modo que el día que se elija, publicar sea un solo paso.
    const { problemas } = publicables(REPO_ROOT);
    expect(problemas.filter((problema) => !problema.includes('`license`'))).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('y el descuido que ningún manifiesto delata', () => {
  it('una dependencia de producción sin declarar instala sin quejarse y no arranca', async () => {
    // Es el caso que justifica todo el andamiaje de arriba. Declarar como `dev`
    // algo que el código usa en producción produce un tarball impecable, y
    // `pnpm publish` lo sube sin pestañear. El registro tampoco se queja: lo que
    // npm instala es lo que los manifiestos piden, y esto no lo pide nadie.
    //
    // El primero que se entera es quien instaló.
    //
    // Se le quita a los dos paquetes que lo declaran, porque un cierre de
    // dependencias no es una lista: mientras cualquier otro siga pidiendo `yaml`,
    // el fichero aterriza igual y quien lo importaba sin declararlo lo encuentra
    // por vecindad. Ese apaño es exactamente por lo que el descuido sobrevive
    // tanto tiempo en los repositorios donde ocurre.
    const roto = await registro((manifiesto) => ({
      ...manifiesto,
      dependencies: Object.fromEntries(
        Object.entries((manifiesto['dependencies'] ?? {}) as Record<string, string>).filter(
          ([nombre]) => nombre !== 'yaml',
        ),
      ),
    }));

    try {
      // npm no protesta: instalar sale con 0 y deja el binario en su sitio.
      const { bin, raiz, afuera } = await instala(roto);
      expect(existsSync(bin)).toBe(true);
      expect(existsSync(join(raiz, 'node_modules', 'yaml'))).toBe(false);

      const { code, stderr } = await ejecuta({ bin, afuera }, ['validate', ejemplo.policy]);
      expect(code).not.toBe(0);
      expect(stderr).toMatch(/ERR_MODULE_NOT_FOUND|Cannot find package/);
    } finally {
      await roto.detiene();
    }
  }, 300_000);
});

// ─────────────────────────────────────────────────────────────────────────────

describe('el manifiesto publicado dice lo que hay que decir', () => {
  it('`workspace:*` no llega al registro: pnpm lo sustituye por la versión', async () => {
    // Si llegara, npm no sabría resolverlo y el producto sería ininstalable. Es
    // el motivo de que empaquete pnpm y no un guion propio.
    const producto = (await propios()).find(({ manifiesto }) => manifiesto.name === 'mcpizer');
    const dependencias = Object.values(
      (producto?.manifiesto['dependencies'] ?? {}) as Record<string, string>,
    );

    expect(dependencias).not.toHaveLength(0);
    expect(dependencias.every((rango) => rango === instalado.version)).toBe(true);
  });

  it('y el taller no se publica', async () => {
    const nombres = (await propios()).map(({ manifiesto }) => manifiesto.name);
    expect(nombres).not.toContain('mcpizer-workspace');

    const raiz = JSON.parse(await readFile(join(REPO_ROOT, 'package.json'), 'utf8')) as {
      private?: boolean;
    };
    expect(raiz.private).toBe(true);
  });
});
