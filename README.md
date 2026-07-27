# mcpizer

**Dado quién invoca y qué intenta hacer: qué tools ve, contra qué cuenta se ejecuta y bajo qué límites.**

Eso es todo el dominio. Un cliente MCP se conecta a mcpizer en lugar de conectarse a diez servidores upstream; mcpizer decide qué parte de ese catálogo existe para ese invocante concreto, con qué identidad de ejecución se atiende cada llamada y qué techos se le aplican.

Las dos identidades nunca son la misma cosa. **Quién invoca** es el principal: una persona, un agente, un servicio. **Con qué credencial se actúa** es la cuenta de ejecución. Que un agente pueda usar la cuenta de facturación de la empresa no lo convierte en la empresa, y el diseño no permite confundirlos en ningún punto.

## Estado

**Sesión 3 completada**: la periferia real. Cada puerto tiene al menos **dos** implementaciones, intercambiables sin tocar el núcleo ni la orquestación.

| Puerto | Lo mínimo | Lo real |
|---|---|---|
| ¿quién invoca? | clave estática | **OIDC/JWT** con validación por JWKS |
| ¿de dónde sale la política? | fichero | **git** a una referencia fija |
| ¿qué tools hay? | catálogo declarado | **descubrimiento MCP** (`tools/list`) |
| ¿cuánto se ha usado? | memoria del proceso | **Redis** |
| ¿de dónde sale la credencial? | variable de entorno | **HashiCorp Vault** |
| ¿cómo se invoca? | MCP por stdio | **MCP por HTTP** streamable |
| ¿dónde va la auditoría? | JSON a stderr | **OpenTelemetry** por OTLP |

Y la pasarela habla los dos transportes también **de cara al cliente**: por stdio la clave llega por entorno, y por HTTP por cabecera y por petición, que es lo que permite que dos identidades compartan puerto.

Qué implementación atiende a cada emisor, upstream y cuenta **lo dice el propio artefacto** —`kind`, `transport.kind` y el esquema de `secret.ref`—, así que la misma ejecución habla stdio con un upstream y HTTP con otro, y resuelve `env://` para una cuenta y `vault://` para la siguiente. Lo que no cabe en el artefacto —de dónde se carga el propio artefacto, dónde viven los contadores, adónde va la auditoría— se elige al arrancar, porque son hechos del despliegue y no de la política ([decisión 0022](docs/decisiones/0022-donde-se-elige-la-implementacion-de-cada-puerto.md)).

Queda la sesión 4: empaquetado, despliegue y operación ([`docs/sesiones.md`](docs/sesiones.md) §5).

## Empezar

```bash
pnpm install
pnpm verify          # build · tipos · linter · dependencias · superficie · tests
```

Y sobre el ejemplo de [`docs/diseno/artefacto.md`](docs/diseno/artefacto.md) §2, que vive en [`examples/`](examples/):

```bash
alias mcpizer='node runtime/dist/cli/main.js'

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

El JSON Schema del artefacto se emite con `mcpizer schema`, para editores y validadores externos.

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
examples/      un artefacto completo y su catálogo declarado
```

Los cinco primeros son el núcleo. **Ninguno importa a otro**, y el gestor de módulos lo impide: cada uno declara una única entrada pública, así que alcanzar su interior es un error de resolución, no un aviso.

## Documentación

| Documento | Para qué |
|---|---|
| [`docs/arquitectura.md`](docs/arquitectura.md) | **Vinculante.** Estilo, invariantes y criterios de aceptación. Viaja completo a cualquier sesión de trabajo. |
| [`docs/diseno/`](docs/diseno/) | Diseño detallado: contextos, puertos, modelo, artefacto declarativo y verificación. |
| [`docs/sesiones.md`](docs/sesiones.md) | Cómo se trocea el trabajo: cuatro sesiones, qué entra en cada una y cuándo termina. |
| [`docs/decisiones/`](docs/decisiones/) | Registro de decisiones tomadas durante el diseño y la implementación, con su motivo. |

Empieza por [`docs/diseno/README.md`](docs/diseno/README.md): dice qué documento necesita cada tipo de sesión, para no arrastrar contexto que no hace falta.

## Cómo se comprueba

Los nueve criterios de la sección 5 de la arquitectura "se ejecutan y se responden, no se opinan". `pnpm verify` es ese comando, y todo lo que comprueba falla el build:

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

Y **cada una tiene un caso que la hace fallar**, en [`verification/fixtures/violations/`](verification/fixtures/violations/). Una comprobación que nunca ha fallado no está verificada: sin ese caso, una sesión larga cree tener red y no la tiene, que es peor que no tenerla porque cambia cómo se decide.

La última fila es el criterio de terminación de la sesión 3 hecho comando. Se monta la misma política con dos periferias completas —fichero·declarado·clave estática·memoria·entorno·stdio·stderr, y git·descubrimiento·OIDC·Redis·Vault·HTTP·OTLP—, se hace el mismo recorrido, y las decisiones tienen que salir idénticas. Todo corre en proceso, contra servidores de fixture que hablan los protocolos de verdad: no hace falta Docker, ni red, ni un servicio levantado.

## Las cinco capacidades del dominio

- **principals** — quién invoca.
- **capabilities** — el vocabulario estable de lo que puede hacerse, y a qué tools reales corresponde.
- **accounts** — contra qué cuenta se ejecuta, siempre como referencia y nunca como credencial.
- **access** — la decisión.
- **policy** — el artefacto declarativo que la gobierna, y su verificación en seco.

## Base técnica

TypeScript sobre el SDK oficial de MCP. La elección condiciona nombres y herramientas de verificación, no la estructura — ver [`docs/decisiones/0001-lenguaje-y-base-mcp.md`](docs/decisiones/0001-lenguaje-y-base-mcp.md).

Requiere Node 22 o superior y pnpm.
