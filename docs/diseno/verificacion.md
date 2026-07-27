# Verificación: de criterio a comprobación

Traduce los nueve criterios de la sección 5 de [`../arquitectura.md`](../arquitectura.md) a comprobaciones concretas sobre TypeScript.

Prerrequisito de lectura: `../arquitectura.md`. Se apoya en la estructura descrita en [`contextos.md`](contextos.md) §4, resumida aquí para que este documento se sostenga solo.

La sección 5 dice que estos criterios "se ejecutan y se responden, no se opinan". Este documento existe para que eso sea literal.

---

## 1. El cimiento: cada contexto es un paquete

Casi todas las comprobaciones se apoyan en una sola decisión de empaquetado.

**Cada contexto es un paquete de un workspace, y declara un único punto de entrada público.**

En TypeScript la herramienta es el campo `exports` del manifiesto del paquete. Un paquete que expone exactamente una entrada hace que el import profundo **falle al resolver**: no es un aviso del linter que alguien pueda silenciar, es un error de resolución de módulos que rompe la compilación y la ejecución.

Esto convierte tres exigencias de la sección 3 — que exista superficie declarada, que sea localizable, y que "la declaración de frontera no sea un comentario ni una convención de nombres" — en una propiedad que sostiene el propio gestor de módulos. Es lo más cerca que TypeScript llega de los `internal` del compilador de Go, y es la razón por la que el resto de comprobaciones son baratas.

Estructura resultante, según [`contextos.md`](contextos.md) §4:

```
principals/  capabilities/  accounts/  access/  policy/   ← núcleo, un paquete cada uno
adapters/    runtime/                                     ← periferia y composición
```

---

## 2. Los cuatro automáticos desde el primer commit

La sección 5 los señala como baratos y de entrada. Lo son porque los tres primeros son reglas sobre el mismo grafo de imports.

### 2.1 Dirección de dependencias

> El núcleo no depende de periferia.

**Regla de análisis estático** (dependency-cruiser o equivalente): ningún paquete de contexto puede alcanzar `adapters/` ni `runtime/`, ni directa ni transitivamente. La transitividad es la parte que importa — el invariante 1 dice "ni directa ni transitivamente", y es la vía por la que esto se rompe de verdad.

Se ejecuta en CI y localmente. Falla el build, no avisa.

### 2.2 Fronteras entre contextos

> Ningún contexto alcanza el interior de otro.

**Una sola regla, sin excepciones**: ningún paquete de contexto importa a otro paquete de contexto ([`contextos.md`](contextos.md) §3).

Que no haya lista de excepciones es lo que la mantiene viva. Una regla con excepciones acumula entradas hasta que ya no comprueba nada, y cada excepción es una discusión. Cero aristas permitidas no admite negociación: si un contexto necesita a otro, o se traduce en composición o la frontera está mal puesta.

**Comprobación adicional**: no existe ningún paquete `shared`, `common`, `core`, `kernel` ni `types`. Se comprueba sobre el manifiesto del workspace. Es una lista de nombres prohibidos, admitidamente tosca, pero ataca la forma exacta en que esta regla se erosiona: nadie añade un import prohibido, alguien crea un paquete común "solo para los ids" y seis meses después es el modelo compartido que la sección 3 prohíbe.

### 2.3 Frontera explicitada

> Cada contexto tiene una superficie pública declarada y localizable; su ausencia falla.

Se deriva de §1. La comprobación es un test que recorre los paquetes de contexto y verifica que cada uno declara `exports` con una entrada única. **Un paquete sin superficie declarada falla**, que es exactamente lo que pide el criterio.

Sin esto, la regla de §2.2 sería incompleta: se podría respetar "no importar otro contexto" mientras se alcanza su interior por una ruta relativa que atraviesa la carpeta.

### 2.4 Pureza del núcleo

> El dominio se ejecuta sin dobles de infraestructura ni entorno.

Tres comprobaciones, de más fuerte a más débil:

1. **Prohibición estática de E/S**: ningún paquete de contexto importa módulos de plataforma (`node:*` y equivalentes). Misma herramienta que §2.1.
2. **Prohibición estática de no determinismo**: `Date.now`, `new Date()` sin argumentos, `Math.random`, `performance.now` y `process.env` están prohibidos en el núcleo, vía regla de ESLint. Es la traducción directa de "sin reloj, sin aleatoriedad" y de haber declinado el puerto `Clock` ([`puertos.md`](puertos.md) §3).
3. **Señal secundaria — los tests del dominio no usan dobles.** Se comprueba que ningún test de un paquete de contexto importa utilidades de mock. Es más débil que las anteriores, pero cubre el caso que se les escapa: si probar el núcleo empieza a necesitar simular algo, el núcleo ha dejado de ser una función aunque siga sin importar nada prohibido. Es la señal temprana, y la que la sección 5 describe al decir "sin dobles".

---

## 3. Los que empiezan como revisión

La sección 5 los admite como revisión antes de automatizarse. Aquí se indica desde ya con qué mecanismo se automatizan, para que no se queden en revisión indefinidamente.

### 3.1 Blast radius

> Un cambio interno en un contexto no altera la superficie pública de ningún otro.

**Snapshot de la superficie pública por contexto**: se genera la declaración de tipos del punto de entrada de cada paquete y se versiona. Un cambio que altere el snapshot de un contexto lo hace visible en el diff.

El criterio se lee así en la práctica: si un PR cambia el interior de un contexto y en el diff aparece el snapshot de **otro**, el criterio falla. Con la regla de §2.2 esto no debería poder ocurrir — no hay aristas —, así que el snapshot funciona sobre todo como red de seguridad y como prueba de que la regla fuerte compra lo que promete.

*Automatizable desde el principio si se genera el snapshot con las herramientas de declaración del propio compilador; se clasifica aquí porque el juicio de "cambio interno" sigue siendo humano.*

### 3.2 Fallo cerrado

> Ninguna configuración válida produce acceso a algo no declarado.

Es una propiedad universal sobre configuraciones, así que se comprueba con **tests de propiedad**: se generan artefactos válidos arbitrarios y se afirma que ninguna capacidad no concedida aparece jamás en un permiso, y que ninguna tool sin mapeo aparece jamás en un catálogo.

Se apoya en que el núcleo es puro: generar miles de casos es barato cuando la evaluación es una función de datos a datos sin E/S.

Casos que merecen test explícito, porque son los modos de fallo reales: artefacto vacío deniega todo; capacidad declarada sin concesión deniega; tool sin mapeo no aparece en el catálogo; `usage` desconocido se trata como límite agotado ([`puertos.md`](puertos.md) §2.4); una denegación no expone `accountRef` ([`modelo.md`](modelo.md) §4).

### 3.3 Explicabilidad

> Toda denegación produce motivo; una denegación sin motivo falla.

Se refuerza en dos niveles:

- **Por tipos**: si `reason` es obligatorio en `Decision`, una decisión sin motivo no compila. La mayor parte del criterio se satisface en el compilador, no en un test.
- **Por propiedad**: sobre configuraciones generadas, toda decisión — permiso incluido, según [`modelo.md`](modelo.md) §4 — lleva motivo, con `code` del vocabulario cerrado y con `path` que resuelve a una posición real del artefacto.

Lo segundo es lo que hace útil lo primero. Un `path` que no resuelve satisface el tipo y no sirve para nada: el bucle de corrección del invariante 4 depende de que el sitio señalado exista.

### 3.4 Justificación de puertos

> Cada puerto tiene al menos dos implementaciones previstas y documentadas.

Documentado en [`puertos.md`](puertos.md), con tabla resumen y con la lista de puertos declinados y su motivo. Se revisa en el PR que introduzca un puerto nuevo: si no puede nombrar dos implementaciones, no se abre la frontera.

*Automatizable parcialmente* — comprobar que cada puerto declarado en `runtime/` aparece en la tabla — pero la parte que importa, que la variación sea real y no hipotética, es juicio.

### 3.5 El artefacto desplegable arranca

> El artefacto desplegable se construye y arranca desde cero contra una política de ejemplo.

No es uno de los nueve criterios de la sección 5: es el criterio de terminación de S4 ([`../sesiones.md`](../sesiones.md) §5), y aparece aquí porque también falla el build y también lleva su caso de fallo.

**Se construye con el mismo guion** que se ejecuta a mano y que invoca la imagen —un solo empaquetado, no uno "para los tests"—, **se arranca fuera del repositorio** con el entorno podado, y se le pasa un cliente MCP de verdad por los dos transportes. Que el proceso siga vivo no cuenta como arrancar: cuenta que vea lo concedido, que reciba motivo y sitio al ser denegado, y que una concesión llegue hasta el upstream.

Los casos que lo hacen fallar están en [`entrega.md`](entrega.md) §4. Todo corre sin Docker, sin red y sin servicios; la imagen se construye aparte, en CI ([0032](../decisiones/0032-la-imagen-es-una-envoltura.md)).

### 3.6 Legibilidad estructural

> La estructura de primer nivel se lee como el dominio, no como el framework.

Revisión. La comprobación es la de la sección 2.2 de la arquitectura: quien abre el repositorio entiende en segundos de qué trata. Los cinco nombres de contexto son sustantivos del dominio y `adapters/` y `runtime/` son honestamente periferia.

*Semiautomatizable*: una lista de nombres prohibidos en el primer nivel — `controllers`, `services`, `repositories`, `models`, `utils`, `helpers`, `lib` — ataca la deriva más probable, que es que aparezcan por acumulación y no por decisión.

---

## 4. Resumen

| Criterio (sección 5) | Mecanismo | ¿Automático ya? |
|---|---|---|
| Dirección de dependencias | Regla sobre el grafo de imports, transitiva | Sí |
| Fronteras entre contextos | Cero aristas entre contextos, sin excepciones + prohibición de paquete común | Sí |
| Frontera explicitada | `exports` con entrada única; el import profundo no resuelve | Sí |
| Pureza del núcleo | Prohibición de E/S, reloj y aleatoriedad + tests sin dobles | Sí |
| Blast radius | Retrato de superficie pública por contexto, versionado y comprobado | Sí |
| Fallo cerrado | Tests de propiedad sobre configuraciones generadas | Sí |
| Explicabilidad | `reason` obligatorio por tipos + propiedad de que `path` resuelve | Sí |
| Justificación de puertos | Se recorre la pasarela con las dos periferias y se comparan las decisiones | Sí, salvo el juicio |
| Legibilidad estructural | Lista de nombres técnicos prohibidos en primer nivel | Sí, salvo el juicio |

Y el criterio de terminación de cada sesión, por el mismo mecanismo y con las mismas exigencias:

| Criterio | Mecanismo |
|---|---|
| S1 · el `path` de un motivo resuelve a una posición real | Recorrido sobre el ejemplo de [`artefacto.md`](artefacto.md) §2 |
| S2 · ninguna credencial en registros ni en motivos | Centinelas irrepetibles y un escáner sobre todo lo observable |
| S3 · dos implementaciones por puerto, intercambiables | Dos periferias completas, el mismo recorrido, decisiones idénticas |
| S4 · el artefacto desplegable se construye y arranca desde cero | §3.5 |

**Todas fallan el build.** Un criterio que solo avisa no es un criterio de aceptación.

*La columna "¿Automático ya?" decía "Casi" o "Revisión" en cinco filas cuando este documento se escribió. Se ha puesto al día: lo que quedaba de revisión en las dos últimas es el juicio —si la variación de un puerto es real y no hipotética, si el primer nivel se lee como el dominio—, y eso sigue siendo humano por definición. Lo mecánico de las dos está automatizado.*

---

## 5. Qué no se comprueba, y por qué

- **Alcanzabilidad de upstreams, bóvedas o emisores.** Requeriría red y rompería el invariante 8. La verificación en seco comprueba integridad referencial, no que las cosas respondan ([`artefacto.md`](artefacto.md) §1).
- **Corrección del mapeo tool→capacidad.** Que `get_contact` realice de verdad `crm.contact.read` es una afirmación sobre el mundo, no sobre el código. Lo que sí se comprueba es que todo mapeo apunte a una tool existente en el catálogo declarado y a una capacidad declarada.
- **Cobertura de tests como número.** La sección 2.4 dice que las métricas son señales, no objetivos. Lo que se exige es que el núcleo se pruebe sin dobles; que eso llegue a un porcentaje no añade información.
