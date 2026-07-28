# mcpizer

**Dado quién invoca y qué intenta hacer: qué tools ve, contra qué cuenta se ejecuta y bajo qué límites.**

Eso es todo el dominio. Un cliente MCP se conecta a mcpizer en lugar de conectarse a diez servidores upstream; mcpizer decide qué parte de ese catálogo existe para ese invocante concreto, con qué identidad de ejecución se atiende cada llamada y qué techos se le aplican.

Las dos identidades nunca son la misma cosa. **Quién invoca** es el principal: una persona, un agente, un servicio. **Con qué credencial se actúa** es la cuenta de ejecución. Que un agente pueda usar la cuenta de facturación de la empresa no lo convierte en la empresa, y el diseño no permite confundirlos en ningún punto.

## Estado

**Las cuatro sesiones, completadas**, y el producto se instala. Hay un artefacto desplegable que se construye y arranca desde cero sin este repositorio y sin red; y los siete paquetes se publican, con la comprobación de que lo publicado se instala con el `npm` de verdad y arranca fuera de aquí. Lo único que falta para subirlo es elegir licencia ([decisión 0042](docs/decisiones/0042-la-licencia-la-elige-el-dueno.md)).

Y la periferia está completa: cada puerto tiene entre **dos y cuatro** implementaciones, intercambiables sin tocar el núcleo ni la orquestación, y ninguna de las que el diseño preveía sigue sin escribir.

| Puerto | Lo mínimo | Y además |
|---|---|---|
| ¿quién invoca? | clave estática | **OIDC/JWT** por JWKS · **mTLS** por nombre distinguido |
| ¿de dónde sale la política? | fichero | **git** a una referencia fija · **HTTPS** |
| ¿qué tools hay? | catálogo declarado | **descubrimiento MCP** (`tools/list`) |
| ¿cuánto se ha usado? | memoria del proceso | **Redis** |
| ¿de dónde sale la credencial? | variable de entorno | **Vault** · **gestor de secretos cloud** · **OAuth** con refresco |
| ¿cómo se invoca? | MCP por stdio | **MCP por HTTP** streamable |
| ¿dónde va la auditoría? | JSON a stderr | **OpenTelemetry** por OTLP · **fichero con rotación** |

Ninguna de esas implementaciones obligó a cambiar un contrato de puerto — ni la segunda ni la cuarta. `runtime/src/ports.ts` es el mismo que en la sesión 2, y su retrato versionado lo demuestra.

Y la pasarela habla los dos transportes también **de cara al cliente**: por stdio la clave llega por entorno, y por HTTP por cabecera y por petición, que es lo que permite que dos identidades compartan puerto.

Qué implementación atiende a cada emisor, upstream y cuenta **lo dice el propio artefacto** —`kind`, `transport.kind` y el esquema de `secret.ref`—, así que la misma ejecución habla stdio con un upstream y HTTP con otro, y resuelve `env://` para una cuenta y `vault://` para la siguiente. Lo que no cabe en el artefacto —de dónde se carga el propio artefacto, dónde viven los contadores, adónde va la auditoría— se elige al arrancar, porque son hechos del despliegue y no de la política ([decisión 0022](docs/decisiones/0022-donde-se-elige-la-implementacion-de-cada-puerto.md)).

## Empezar

```bash
npx mcpizer validate mi-politica.yaml --catalog mi-catalogo.yaml
```

Eso es todo lo que hace falta para la parte que funciona en seco: sin clonar nada, sin desplegar nada y sin red más allá de la descarga. Si se va a usar más de una vez:

```bash
npm install -g mcpizer
```

Y para trabajar sobre este repositorio:

```bash
pnpm install
pnpm verify          # build · tipos · linter · dependencias · superficie · tests
```

> Los paquetes **todavía no están publicados**: falta elegir licencia, que es del dueño del repositorio y no del diseño ([decisión 0042](docs/decisiones/0042-la-licencia-la-elige-el-dueno.md)). Lo que sí está comprobado, en cada `pnpm verify`, es que lo que se publicaría se instala con el `npm` de verdad y arranca fuera de aquí.

Sobre el ejemplo de [`docs/diseno/artefacto.md`](docs/diseno/artefacto.md) §2, que vive en [`examples/`](examples/):

```bash
alias mcpizer='node runtime/dist/cli/main.js'   # o lo instalado, o el artefacto empaquetado

# ¿Está bien declarado? Referencias colgantes, concesiones ambiguas,
# capacidades que ninguna tool realiza, tools que ningún mapeo cubre.
mcpizer validate examples/policy.yaml --catalog examples/catalog.yaml

# ¿Puede esta persona hacer esto, y por qué?
mcpizer explain examples/policy.yaml --catalog examples/catalog.yaml \
  --issuer corp --subject ana --attr team=ventas \
  --capability crm.contact.read --at 2026-01-01T03:00:00Z

# La pregunta de auditoría real.
mcpizer who-can examples/policy.yaml --capability billing.invoice.issue

# Qué decisiones cambian entre dos versiones. Un diff de texto no lo dice.
mcpizer diff antes.yaml despues.yaml
```

Una denegación no dice solo que no: dice el código del motivo y el sitio exacto del artefacto que hay que tocar, como `examples/policy.yaml:90:5`. Ese es el bucle de corrección — se pregunta, se corrige, se vuelve a preguntar, sin desplegar y sin adivinar.

El JSON Schema del artefacto se emite con `mcpizer schema`, para editores y validadores externos, y `mcpizer version` dice qué build está corriendo — la primera pregunta de cualquier incidencia.

Todo lo anterior funciona sin red. El catálogo con el que funciona sale de preguntárselo una vez a los upstreams reales:

```bash
# El único comando que toca la red además de `serve`. Se ejecuta una vez, su
# salida se versiona junto a la política, y a partir de ahí se vuelve al seco.
mcpizer catalog examples/policy.yaml > examples/catalog.yaml
```

Un upstream que no responde aborta la generación en vez de escribir un catálogo al que le faltan tools: ese fichero parecería completo y sería una revocación silenciosa el día que alguien lo usara para verificar.

## La pasarela

Un cliente MCP se conecta a mcpizer en lugar de conectarse a los upstreams:

```bash
MCPIZER_CI_KEY=... MCPIZER_API_KEY=... \
mcpizer serve examples/policy.yaml --catalog examples/catalog.yaml --issuer ci
```

Por stdio el cliente arranca este proceso, y este arranca los upstreams declarados; la clave llega por entorno porque stdio no tiene cabeceras. La misma pasarela, con la periferia de un despliegue de verdad:

```bash
VAULT_ADDR=https://vault.internal VAULT_TOKEN=... \
mcpizer serve 'git+https://git.internal/infra/politicas.git#refs/heads/main:mcpizer.yaml' \
  --discover --issuer corp \
  --http --port 8080 \
  --usage redis://contadores.internal:6379 \
  --recorder otlp --otlp-endpoint http://otel-collector:4318
```

Con `--http` la credencial del cliente llega en `Authorization: Bearer` y se lee **en cada petición**: un servidor que cerrara sobre una identidad fija atendería a todos con la del primero, que es un fallo de autorización y no de fontanería ([decisión 0027](docs/decisiones/0027-la-credencial-del-cliente-llega-por-peticion.md)).

Lo que el cliente ve en `tools/list` es **la misma decisión** que contesta `explain`, aplicada a cada capacidad. No es un filtro aparte que haya que mantener sincronizado con la autorización, así que el fallo clásico —una tool que se oculta pero sigue siendo invocable si se adivina su nombre— no puede ocurrir por construcción.

Las tools se anuncian como `upstream__tool`, siempre cualificadas: así declarar un proveedor nuevo no renombra las tools de otro.

Y las dos identidades siguen separadas hasta el último metro. La credencial de la cuenta se resuelve **después** de que una decisión la haya autorizado, solo esa, y no vuelve hacia dentro bajo ninguna forma: no aparece en motivos, ni en registros, ni en mensajes de error. Hay un test que lo comprueba, y un caso que lo hace fallar.

## Distribuirla

Hay tres caminos y **un solo empaquetado**: ninguno construye el producto por su cuenta, o habría tres productos y uno comprobado.

| | Para quién | Qué recibe |
|---|---|---|
| `npm i -g mcpizer` · `npx mcpizer` | Quien verifica en seco, o prueba la pasarela | Los siete paquetes, resueltos por npm |
| `pnpm package` | Un despliegue | Un directorio autocontenido |
| `docker build` | Un despliegue en contenedor | Ese mismo directorio, envuelto |

Los dos últimos salen de este repositorio. El primero es el único en el que **el repositorio no interviene**: lo que llega es un tarball, y lo que ese tarball no lleve no existe. Por eso es el único que se puede romper sin que nada aquí lo note, y por eso se comprueba instalándolo de verdad — con el `npm` real, contra un registro de fixture que habla su protocolo, y ejecutando después el binario **por su nombre** ([decisión 0043](docs/decisiones/0043-lo-instalado-se-comprueba-con-el-npm-real.md)).

Los siete paquetes se publican juntos y con la misma versión, y la frontera entre contextos sobrevive: cada uno aterriza como un paquete suyo, sostenido por el mismo gestor de módulos que aquí. Aplanarlos dejaría verificada en el árbol de trabajo una propiedad que lo distribuido no tendría.

```bash
node deployment/publish.js            # en seco, como el producto: dice qué subiría
node deployment/publish.js --publish
```

Se niega antes de subir nada ante un `private` olvidado, versiones desalineadas, un paquete sin construir, un binario sin shebang o una licencia que falta. El descuido que ningún manifiesto delata —una dependencia de producción sin declarar— lo encuentra la instalación: se instala sin una queja y no arranca.

### Desplegarla

```bash
pnpm package         # → deployment/dist: el programa y el cierre de sus dependencias
node deployment/dist/dist/cli/main.js version
```

Eso es el artefacto desplegable: un directorio autocontenido. Con él y un Node 22 hay pasarela — no hace falta este repositorio, ni pnpm, ni instalar nada, ni red ([decisión 0030](docs/decisiones/0030-el-artefacto-desplegable-es-el-cierre-de-runtime.md)). No lleva fuentes, ni compilador, ni linter, ni ejecutor de tests: lo que no viaja no hay que parchearlo.

La imagen es una **envoltura** de ese mismo directorio, no otra forma de construirlo:

```bash
docker build -f deployment/Dockerfile -t mcpizer .
docker run --rm -p 8080:8080 -v "$PWD/examples:/politica:ro" mcpizer \
  serve /politica/policy.yaml --catalog /politica/catalog.yaml --issuer ci \
  --http --host 0.0.0.0 --port 8080
```

`--host 0.0.0.0` es obligatorio dentro del contenedor y por eso **no** es el defecto: abrir un puerto de autorización a toda la red tiene que ser una decisión escrita.

Lo que un despliegue puede dar por cierto está en [`docs/diseno/entrega.md`](docs/diseno/entrega.md) §3, y lo esencial cabe aquí:

- **SIGTERM y SIGINT** cierran ordenadamente —clientes, sesiones upstream, contadores y auditoría, en ese orden— y salen con **0**. Morir *por* la señal significaría que nadie cerró nada, y que el último lote de auditoría se perdió.
- **`GET /health`** contesta sin credencial, porque quien pregunta es un orquestador anónimo. Por eso solo sale lo que es público: estado, versión del proceso y versión de la política. Nunca el origen del artefacto, y nunca una enumeración de capacidades, upstreams o cuentas. Dice **vivo**, no *listo*: la bóveda, los contadores y los upstreams no se contactan al arrancar y fallan cerrado en la invocación.
- **Un fallo de arranque es una salida con código** — y sale de verdad, también cuando falla a medias con un upstream ya arrancado. Un proceso que fija el código y no muere es el modo real en que esto se rompe. Reiniciar en bucle ante una política ausente es el comportamiento correcto.
- **TLS lo termina el despliegue**, no este proceso; pero la autorización **no** puede terminarla nadie delante, o una denegación explicable se convierte en un 401 mudo ([decisión 0033](docs/decisiones/0033-tls-fuera-cors-ninguno-techo-dentro.md)).

## Estructura

```
principals/    ¿quién invoca?
capabilities/  ¿qué puede hacerse, y con qué tools?
accounts/      ¿contra qué cuenta se ejecuta?
access/        ¿se permite, y por qué?
policy/        ¿qué se ha declarado?
adapters/      periferia: identidad, bóvedas, transporte MCP, almacenamiento
runtime/       composición: traduce, orquesta, ejecuta efectos
verification/  el arnés de aceptación: las comprobaciones y sus casos de fallo
deployment/    cómo sale de aquí: el empaquetado, su imagen y el publicado
examples/      un artefacto completo y su catálogo declarado
```

Los cinco primeros son el núcleo. **Ninguno importa a otro**, y el gestor de módulos lo impide: cada uno declara una única entrada pública, así que alcanzar su interior es un error de resolución, no un aviso.

## Documentación

| Documento | Para qué |
|---|---|
| [`docs/arquitectura.md`](docs/arquitectura.md) | **Vinculante.** Estilo, invariantes y criterios de aceptación. Viaja completo a cualquier sesión de trabajo. |
| [`docs/diseno/`](docs/diseno/) | Diseño detallado: contextos, puertos, modelo, artefacto declarativo, verificación y entrega. |
| [`docs/sesiones.md`](docs/sesiones.md) | Cómo se trocea el trabajo: cuatro sesiones, qué entra en cada una y cuándo termina. |
| [`docs/decisiones/`](docs/decisiones/) | Registro de decisiones tomadas durante el diseño y la implementación, con su motivo. |

Empieza por [`docs/diseno/README.md`](docs/diseno/README.md): dice qué documento necesita cada tipo de sesión, para no arrastrar contexto que no hace falta.

## Cómo se comprueba

Los nueve criterios de la sección 5 de la arquitectura "se ejecutan y se responden, no se opinan", y con ellos los criterios de terminación de las cuatro sesiones. `pnpm verify` es ese comando, y todo lo que comprueba falla el build:

| Qué | Cómo |
|---|---|
| El núcleo no alcanza la periferia | Regla sobre el grafo de imports, transitiva |
| Ningún contexto importa a otro | Cero aristas, sin excepciones, más la prohibición de paquete común |
| Cada contexto declara su superficie | `exports` con entrada única; el import profundo no resuelve en Node |
| El núcleo es puro | Sin `node:*`, sin reloj, sin aleatoriedad, y sus tests sin un solo doble |
| Blast radius | Retrato versionado de la superficie pública de cada contexto — y de `runtime`, cuya entrada **son** los siete puertos |
| Fallo cerrado y explicabilidad | Tests de propiedad sobre artefactos generados |
| Ninguna credencial en registros ni motivos | Centinela irrepetible, y un escáner sobre todo lo observable, en las dos periferias |
| Dos implementaciones por puerto, intercambiables | Se recorre la pasarela entera dos veces y se comparan las decisiones |
| El artefacto desplegable arranca desde cero | Se empaqueta, se arranca fuera del repositorio y se le conecta un cliente MCP de verdad |
| Lo que se publica se instala y arranca | Se empaqueta con `pnpm pack`, lo instala el `npm` real desde un registro de fixture, y el binario se ejecuta por su nombre |

Y **cada una tiene un caso que la hace fallar**, en [`verification/fixtures/violations/`](verification/fixtures/violations/). Una comprobación que nunca ha fallado no está verificada: sin ese caso, una sesión larga cree tener red y no la tiene, que es peor que no tenerla porque cambia cómo se decide.

Las tres últimas filas son criterios de terminación hechos comando: las sesiones 3 y 4, y el publicado.

La de **dos implementaciones por puerto** monta la misma política con dos periferias completas —fichero·declarado·clave estática·memoria·entorno·stdio·stderr, y git·descubrimiento·OIDC·Redis·Vault·HTTP·OTLP—, hace el mismo recorrido, y las decisiones tienen que salir idénticas. Todo corre en proceso, contra servidores de fixture que hablan los protocolos de verdad.

La del **artefacto** se toma en serio las tres palabras del criterio. *Se construye* con el mismo guion que se ejecuta a mano y que invoca la imagen, no con uno "para los tests". *Desde cero* significa fuera del repositorio y con el entorno podado — y un artefacto sin su cierre de dependencias, que parece un artefacto y tiene punto de entrada, solo se cae al arrancarlo. *Arranca* no es que el proceso siga vivo: es que un cliente MCP ve lo concedido, recibe motivo y sitio al ser denegado, y una concesión llega hasta el upstream con su credencial. Después se le manda SIGTERM y tiene que salir con **0**, sin temporizador que fuerce la salida — un proceso que no termina tiene un asa que nadie cerró, y forzarlo escondería la fuga.

Nada de esto necesita Docker, ni red, ni un servicio levantado. La imagen sí lo necesita, y por eso se construye y se arranca en un trabajo de CI aparte ([decisión 0032](docs/decisiones/0032-la-imagen-es-una-envoltura.md)).


Y la del **publicado** cierra el hueco que ninguna de las otras ve: el artefacto se construye *desde* este repositorio, y lo que alguien instala llega *sin* él. Lo que el tarball no lleve, no existe. Por eso se instala con el `npm` de verdad —contra un registro de fixture cuyo espejo es el cierre que fijó el fichero de bloqueo, así que nada se resuelve por casualidad— y el binario se ejecuta por su nombre, que es lo único que ejercita el shebang y el enlace que npm deja. El descuido que encuentra y ningún manifiesto delata: una dependencia de producción sin declarar se instala sin una queja y no arranca.

## Las cinco capacidades del dominio

- **principals** — quién invoca.
- **capabilities** — el vocabulario estable de lo que puede hacerse, y a qué tools reales corresponde.
- **accounts** — contra qué cuenta se ejecuta, siempre como referencia y nunca como credencial.
- **access** — la decisión.
- **policy** — el artefacto declarativo que la gobierna, y su verificación en seco.

## Base técnica

TypeScript sobre el SDK oficial de MCP. La elección condiciona nombres y herramientas de verificación, no la estructura — ver [`docs/decisiones/0001-lenguaje-y-base-mcp.md`](docs/decisiones/0001-lenguaje-y-base-mcp.md).

**Para desarrollarlo** hacen falta Node 22 o superior y pnpm. **Para ejecutarlo**, solo Node 22: el artefacto desplegable lleva dentro todo lo demás.
