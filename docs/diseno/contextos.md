# Contextos delimitados y fronteras

Cierra el punto abierto en la sección 3 y en el segundo guion de la sección 6 de [`../arquitectura.md`](../arquitectura.md).

Prerrequisito de lectura: `../arquitectura.md`. Este documento no depende de ningún otro de `docs/diseno/`.

---

## 1. Antes de los contextos: dónde vive realmente la decisión

Hay una tensión entre dos invariantes que conviene resolver antes de dibujar fronteras, porque la resolución determina la forma de todo lo demás.

El invariante 1 dice que el núcleo no conoce la periferia. El invariante 2 dice que el núcleo es puro: sin reloj, sin red, sin aleatoriedad, sin E/S.

La lectura habitual de hexagonal satisface el primero y rompe el segundo. En esa lectura el dominio define puertos y *los llama*: pide la hora a un `Clock`, pide contadores a un `UsageStore`. La dependencia sigue apuntando hacia dentro, sí, pero el dominio ya no es determinista — depende de qué devuelvan esas llamadas, y probarlo exige dobles. El invariante 2 dice explícitamente "el dominio se ejecuta sin dobles de infraestructura", así que esa lectura queda descartada.

**Decisión: el núcleo no llama a nada. Es una función.**

```
        cáscara imperativa (periferia + composición)
   ┌──────────────────────────────────────────────────┐
   │  1. reúne hechos      ── puertos de entrada ──   │
   │        principal, catálogo, política, hora,      │
   │        contadores de uso                         │
   │                                                  │
   │              ┌────────────────────┐              │
   │  2. decide   │   núcleo puro      │              │
   │              │   hechos → Decision│              │
   │              └────────────────────┘              │
   │                                                  │
   │  3. ejecuta el efecto ── puertos de salida ──    │
   │        resolver credencial, invocar tool,        │
   │        registrar decisión                        │
   └──────────────────────────────────────────────────┘
```

La cáscara reúne los hechos, invoca la decisión y ejecuta el efecto. Consecuencias, todas verificables:

- **El tiempo es dato de entrada.** No existe un puerto `Clock`. La hora entra en la invocación como un hecho más, igual que el principal.
- **El estado de límites es dato de entrada.** El núcleo no consulta contadores: los recibe. Decide qué techo aplica; incrementar y persistir es efecto de la cáscara.
- **Los puertos viven en la frontera de composición**, no dentro del dominio. Ver [`puertos.md`](puertos.md).
- **El núcleo se prueba sin un solo doble.** Es una función de datos a datos. Eso convierte el criterio "pureza del núcleo" de la sección 5 en algo que se comprueba mirando si los tests del dominio necesitan mocks: si los necesitan, el invariante está roto.

Esto no abandona hexagonal, lo hace más estricto. Las dependencias siguen apuntando hacia dentro; lo que cambia es que ni siquiera hay inversión de control en el núcleo, porque no hay control que invertir.

---

## 2. Los cinco contextos

Agrupados por capacidad de negocio, según 2.3.

| Contexto | La pregunta que contesta |
|---|---|
| `principals` | ¿Quién invoca? |
| `capabilities` | ¿Qué puede hacerse, y a qué tools reales corresponde? |
| `accounts` | ¿Contra qué cuenta se ejecuta? |
| `access` | ¿Se permite, y por qué? |
| `policy` | ¿Qué se ha declarado, y está bien declarado? |

Los tres primeros son las tres partes de la frase que define el dominio. `access` es la decisión. `policy` es el artefacto que la gobierna.

### 2.1 `principals` — quién invoca

Convierte lo que llega por el transporte en un principal del dominio: una identidad con atributos, comparable y seleccionable por la política.

**Vocabulario**: principal, atributo, sujeto, emisor.

**Responsabilidad**: normalizar identidades de procedencias distintas (un `sub` de OIDC, un subject de certificado, el id de una clave estática) a una forma única que el resto del sistema entiende, y exponer los atributos sobre los que la política puede discriminar.

**Lo que explícitamente no hace**: no valida criptografía ni contacta con proveedores — eso es el adaptador. No sabe nada de cuentas de ejecución. No sabe qué puede hacer el principal; solo quién es.

### 2.2 `capabilities` — qué puede hacerse

Es el contexto que hace posible el invariante 7. La política se escribe en términos de capacidades; las tools reales cambian de nombre, se reorganizan y se sustituyen sin que ninguna configuración existente se rompa.

**Vocabulario**: capacidad, descriptor de tool, mapeo, catálogo.

**Responsabilidad**: sostener el vocabulario estable de capacidades y la correspondencia entre cada tool upstream concreta y la capacidad que realiza. Es también quien produce el catálogo filtrado que el cliente MCP acaba viendo, dada una lista de capacidades concedidas.

**La dirección del mapeo importa.** Va de tool a capacidad, muchas a una. Varias tools de distintos upstreams pueden realizar la misma capacidad, y esa es la situación normal, no la excepción: es lo que permite sustituir un proveedor por otro sin tocar la política.

**Lo que explícitamente no hace**: no decide nada. Traduce.

### 2.3 `accounts` — contra qué cuenta se ejecuta

La segunda identidad. Sostiene referencias a cuentas de ejecución y las reglas de vinculación que determinan qué referencia corresponde a un caso dado.

**Vocabulario**: referencia de cuenta, vínculo, resolución.

**Responsabilidad**: modelar la identidad *de ejecución* como algo con vida propia — una cuenta puede estar deshabilitada, tener un ámbito limitado o estar vinculada a varios principales — sin tocar jamás material sensible.

**Lo que explícitamente no hace**: no contiene tokens, claves, contraseñas ni nada canjeable. Solo asas opacas. El material vive en la periferia y no cruza la frontera (invariante 6). Esta prohibición es comprobable: ver [`verificacion.md`](verificacion.md).

### 2.4 `access` — la decisión

El corazón. Recibe hechos, devuelve una decisión con motivo.

**Vocabulario**: decisión, concesión, denegación, motivo, techo.

**Responsabilidad**: evaluar. Dado un principal, una capacidad pretendida, la política compilada y los hechos del momento (hora, uso acumulado), determinar si se permite, contra qué referencia de cuenta y bajo qué límites — y adjuntar siempre el motivo.

Es donde vive el fallo cerrado: el resultado por defecto es denegar, y permitir requiere una concesión que lo justifique. No es una comprobación al final, es la estructura de la evaluación.

**Lo que explícitamente no hace**: no lee la política del disco, no resuelve identidades, no invoca tools, no registra nada. No conoce el tiempo salvo como parámetro recibido.

### 2.5 `policy` — qué se ha declarado

Autoría y validación del artefacto declarativo: parsear, validar, compilar a un modelo evaluable y producir diagnósticos utilizables.

**Vocabulario**: documento, regla, diagnóstico, compilación, referencia colgante.

**Responsabilidad**: ser la razón por la que el invariante 8 se cumple. Una configuración se puede verificar entera en local — incluidas las preguntas del tipo "¿quién puede llegar a esta capacidad?" — porque compilar y evaluar no requiere contactar con nada.

**Por qué es un contexto propio y no parte de `access`**: son capacidades distintas con vocabularios distintos. `policy` habla de documentos, reglas, posiciones dentro de un fichero y errores de autoría; `access` habla de decisiones y motivos. Un error en `policy` es "esta concesión referencia una cuenta que no existe"; un resultado de `access` es "denegado porque ninguna concesión cubre esta capacidad". Fusionarlos forzaría un modelo único compartido, que es justamente lo que la sección 3 prohíbe.

---

## 3. La regla de frontera

> **Ningún contexto importa a otro. Los contextos se encuentran únicamente en la capa de composición.**

Es deliberadamente más estricta que "ningún contexto alcanza el interior de otro". La versión débil permite que `access` importe la superficie pública de `principals`, lo cual bastaría para cumplir la letra de la sección 3 — pero abre la puerta a que el modelo de principal de un contexto se convierta de facto en el modelo compartido de todos, que es el fallo que la sección 3 describe como incorrecto.

Con la regla fuerte:

- **El blast radius es cero por construcción**, no por disciplina. Un cambio interno no puede propagarse a otro contexto porque no hay arista por la que propagarse.
- **La comprobación automática es trivial**: una única regla de "ningún paquete de contexto importa a otro paquete de contexto", sin listas de excepciones que mantener ni grafo de dependencias permitidas que discutir.
- **Cada contexto es legible en solitario**, que es exactamente lo que la sección 7 de la arquitectura pide para las sesiones de trabajo.

### 3.1 Qué pasa entonces con los tipos compartidos

`access` necesita hablar de principales y de capacidades. Sin importar `principals` ni `capabilities`, la respuesta es que **cada contexto declara los tipos que necesita, en sus propios términos**.

`access` no recibe *el* principal de `principals`. Recibe su propia vista: lo que necesita para decidir, que es un identificador y unos atributos. La traducción ocurre en composición. Lo mismo para capacidades y para referencias de cuenta.

Esto duplica declaraciones de identificadores opacos entre contextos. **Es duplicación aceptada, no deuda**, y está explícitamente cubierta por 2.5 de la arquitectura: se admite duplicación temporal antes que una abstracción prematura. Un paquete común de tipos compartidos sería precisamente el modelo único compartido que la sección 3 prohíbe, con el agravante de que todo contexto dependería de él y el blast radius volvería a ser global.

La regla práctica para el agente implementador: **si aparece la tentación de crear un paquete `shared`, `common` o `kernel`, la respuesta es no.** Si un mismo concepto se necesita en dos contextos con el mismo significado y la misma forma, probablemente los dos contextos son uno solo y la frontera está mal puesta — el arreglo es la frontera, no un paquete común.

### 3.2 La capa de composición

Es el único sitio donde los cinco contextos se ven a la vez. Conoce a todos, y ninguno la conoce a ella. Su trabajo es traducir entre vocabularios y orquestar el flujo de la sección 1.

No es un contexto: no tiene vocabulario propio ni capacidad de negocio. Es cableado. Que sea el único punto de acoplamiento total del sistema es intencionado — concentra ahí la complejidad de integración en lugar de repartirla.

---

## 4. Estructura de primer nivel

Cumple 2.2 (grita el dominio) y 2.3 (agrupa por capacidad). La estructura interna de cada contexto es decisión del agente implementador.

```
mcpizer/
├── principals/        ¿quién invoca?
├── capabilities/      ¿qué puede hacerse, y con qué tools?
├── accounts/          ¿contra qué cuenta se ejecuta?
├── access/            ¿se permite, y por qué?
├── policy/            ¿qué se ha declarado?
├── adapters/          periferia: identidad, bóvedas, transporte MCP, almacenamiento
└── runtime/           composición: traduce, orquesta, ejecuta efectos
```

Los cinco primeros son el núcleo y no importan nada de `adapters/` ni de `runtime/`. `adapters/` no importa contextos: implementa los contratos de puerto que declara `runtime/`.

Que `adapters/` tenga un nombre técnico es correcto y honesto: es periferia, y la sección 2.2 exige que la estructura grite el *dominio*. La periferia no es el dominio, y fingir lo contrario sería peor.

---

## 5. Cómo se comprueba esto

Resumen; el detalle está en [`verificacion.md`](verificacion.md).

| Propiedad | Comprobación |
|---|---|
| Frontera explicitada | Cada contexto es un paquete con un único punto de entrada declarado. El import profundo falla al resolver. |
| Ningún contexto importa a otro | Regla de análisis estático sobre el grafo de imports, sin excepciones. |
| El núcleo no importa periferia | Regla de análisis estático: los cinco contextos no alcanzan `adapters/` ni `runtime/`. |
| Pureza | Prohibición estática de reloj, aleatoriedad y E/S en el núcleo. Señal secundaria: los tests del dominio no usan dobles. |
| Blast radius | Snapshot de la superficie pública por contexto. Un cambio interno que altere el snapshot de otro contexto falla. |
| Las dos identidades no se colapsan | `principals` y `accounts` son contextos separados que no se importan. Colapsarlos exigiría fusionar paquetes, que es un cambio visible en revisión, no un descuido. |
