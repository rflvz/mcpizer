# mcpizer — Arquitectura

Documento complementario al plan de proyecto. Fija el enfoque arquitectónico y los criterios bajo los que se evaluará cualquier implementación.

Estado: enfoque cerrado. El diseño detallado que la sección 6 dejó abierto está en [`diseno/`](diseno/), y las cuatro sesiones de [`sesiones.md`](sesiones.md) han terminado. Nada de lo que sigue ha cambiado por ello: este documento es el enfoque, no el estado del trabajo.

---

## 0. Qué es y qué no es este documento

**Es** la definición del enfoque arquitectónico: qué estilo se sigue, cómo se organiza el código, qué propiedades debe cumplir siempre el resultado y cómo se comprueba que las cumple.

**No es** diseño detallado. No contiene modelo de datos, contratos de interfaz, firmas, estructura de carpetas definitiva ni código. Esa omisión es intencionada y está justificada en la sección 1.

**Para qué sirve**: es el documento base que se entrega a un flujo agéntico de desarrollo. Todo lo que aquí se declara es vinculante; todo lo que aquí no aparece es decisión del agente, sujeta a los criterios de verificación de la sección 5.

---

## 1. Principio rector: especificación de restricciones, no de instrucciones

La documentación previa a un flujo agéntico puede escribirse de dos maneras. Una enumera pasos y detalles hasta que no queda nada por decidir. La otra fija las fronteras, los invariantes y la forma de comprobarlos, y deja el camino abierto.

Este proyecto usa la segunda, por una razón concreta: definir el detalle al milímetro consume la capacidad de razonamiento multipaso del agente en ejecutar algo ya resuelto. Un plan sobredeterminado convierte un modelo caro en un transcriptor.

De ahí que este documento admita solo tres tipos de contenido:

1. **Decisiones cerradas** — no se renegocian durante la implementación.
2. **Invariantes** — propiedades que el resultado debe cumplir siempre, sea cual sea el camino.
3. **Criterios de verificación** — cómo se comprueba que un invariante se cumple.

Y excluye explícitamente: instrucciones paso a paso, nombres de ficheros y símbolos, contratos concretos, y cualquier decisión que el agente pueda tomar mejor con el código delante.

**Corolario operativo**: si durante la implementación surge una pregunta cuya respuesta no está aquí, la respuesta por defecto no es "preguntar", es "decidir y dejar constancia de la decisión". Solo se escala lo que contradiga una decisión cerrada o un invariante.

---

## 2. Estilo arquitectónico

### 2.1 Hexagonal (puertos y adaptadores) — estructura macro

**Decisión cerrada.**

El dominio de mcpizer es, literalmente, una decisión: dado un principal y una invocación, qué tools ve, contra qué cuenta se ejecuta y bajo qué límites. Es lógica pura, sin estado propio y sin dependencia de ninguna tecnología. Todo lo demás — proveedores de identidad, bóvedas, transporte MCP, plataformas de despliegue, almacenamiento — es periferia sustituible.

Esa asimetría es exactamente la que hexagonal está diseñada para explotar. No se elige por estilo, se elige porque el proyecto ya tiene esa forma.

### 2.2 Screaming architecture — organización visible

**Decisión cerrada.**

La estructura de primer nivel debe hablar del problema, no de la tecnología. Quien abra el repositorio tiene que entender en segundos que esto trata sobre quién puede invocar qué y contra qué cuenta.

Queda descartada la organización por tipo técnico (controladores, servicios, repositorios, modelos). No aporta información y esconde el dominio detrás de una taxonomía de framework.

### 2.3 Vertical slicing en el dominio — agrupación por capacidad

**Decisión cerrada.**

Dentro del núcleo, el código se agrupa por capacidad de negocio, no por capa ni por tipo de artefacto. Todo lo que concierne a una capacidad vive junto.

Es la consecuencia natural de 2.2: la estructura solo puede gritar el dominio si el criterio de agrupación es el dominio.

### 2.4 Clean Code — transversal, sin dogma

**Invariante, no ritual.**

Se aplican los principios de legibilidad, nombres honestos, funciones con un propósito y ausencia de duplicación significativa. No se aplican como reglas mecánicas: un límite de líneas por función o una métrica de complejidad no son objetivos, son señales.

Criterio práctico: si cumplir un principio de Clean Code hace el código más difícil de entender, el principio se está aplicando mal.

### 2.5 Lo que se descarta y por qué

- **Clean Architecture completa de cuatro capas.** Aporta ceremonia desproporcionada para el tamaño de este dominio. La separación que sí importa — núcleo frente a periferia — ya la da hexagonal; el resto sería indirección con nombre.
- **Organización por tipo técnico.** Ver 2.2.
- **Puertos sin variación real prevista.** Un puerto con una única implementación de por vida no es un puerto, es un coste. Solo se abre frontera donde se sabe que habrá más de una implementación.
- **Abstracciones anticipadas.** Se admite duplicación temporal antes que una abstracción prematura basada en una sola aparición del patrón.

---

## 3. Bounded contexts

El dominio se organiza en contextos delimitados. **Este documento no fija la lista de contextos ni las reglas de frontera concretas**: identificarlos y delimitarlos es parte del trabajo de diseño, y hacerlo con el código delante da mejor resultado que hacerlo aquí a ciegas.

Lo que sí es vinculante es que las fronteras existan y estén explicitadas de forma efectiva. En concreto:

- Cada contexto declara de manera explícita y localizable qué expone al exterior. Lo no declarado es interno.
- La declaración de frontera no es un comentario ni una convención de nombres: tiene que ser algo comprobable.
- Ningún contexto alcanza el interior de otro. La comunicación pasa siempre por la superficie declarada.
- El vocabulario es propio de cada contexto. Un mismo término puede significar cosas distintas en dos contextos, y eso es correcto; lo incorrecto es forzar un modelo único compartido.

**Blast radius.** Un cambio dentro de un contexto no debe obligar a tocar los demás. Si al modificar algo interno se propaga la necesidad de cambios fuera, la frontera está mal puesta, y el arreglo es la frontera, no el cambio.

Este es el punto donde más rinde la verificación explícita. Se trata como criterio de aceptación, no como recomendación.

---

## 4. Invariantes arquitectónicos

Propiedades que deben cumplirse siempre, con independencia del camino de implementación.

1. **El núcleo no conoce la periferia.** El dominio no importa nada de infraestructura, ni directa ni transitivamente. La dependencia apunta siempre hacia dentro.
2. **El núcleo es determinista y puro.** Mismo principal e invocación, misma decisión. Sin reloj, sin red, sin aleatoriedad, sin E/S.
3. **Fallo cerrado.** Lo que no está declarado no se expone. Ausencia de configuración significa denegar, nunca permitir.
4. **Toda decisión lleva motivo.** Una denegación sin explicación es un fallo de diseño. Es la propiedad que hace posible la verificación en seco y el bucle de corrección del agente que configura el sistema.
5. **Separación de las dos identidades.** Quién invoca y con qué credencial se actúa son conceptos distintos en todo momento. Nada en el diseño puede colapsarlos.
6. **El núcleo nunca ve credenciales.** Maneja referencias a cuentas; el material sensible vive en la periferia y no cruza la frontera.
7. **La política se expresa en términos de capacidades, no de nombres concretos de tools.** Renombrar o reorganizar tools no puede romper configuraciones existentes.
8. **La configuración es verificable sin desplegar.** Toda configuración válida puede evaluarse por completo en local, sin contactar con ningún sistema externo.
9. **Los puertos se justifican.** Abrir una frontera hacia la periferia requiere variación real conocida, no hipotética.

---

## 5. Criterios de verificación

Cómo se comprueba que lo anterior se cumple. Estos criterios son la interfaz de aceptación del trabajo agéntico: se ejecutan y se responden, no se opinan.

| Qué se verifica | Cómo |
|---|---|
| Dirección de dependencias | Comprobación automática de que el núcleo no depende de periferia |
| Pureza del núcleo | El dominio se ejecuta sin dobles de infraestructura ni entorno |
| Fronteras entre contextos | Comprobación automática de que ningún contexto alcanza el interior de otro |
| Frontera explicitada | Cada contexto tiene una superficie pública declarada y localizable; su ausencia falla |
| Blast radius | Un cambio interno en un contexto no altera la superficie pública de ningún otro |
| Fallo cerrado | Ninguna configuración válida produce acceso a algo no declarado |
| Explicabilidad | Toda denegación produce motivo; una denegación sin motivo falla |
| Justificación de puertos | Cada puerto tiene al menos dos implementaciones previstas y documentadas |
| Legibilidad estructural | La estructura de primer nivel se lee como el dominio, no como el framework |

Los cuatro primeros deberían ser automáticos desde el principio, y su coste es bajo. Los demás pueden empezar como revisión y automatizarse después.

---

## 6. Fuera del alcance de este documento

Se deja abierto de forma deliberada:

- **Lenguaje y base MCP.** Condiciona nombres y herramientas, no la estructura. Nada de lo anterior cambia según la respuesta.
- **Lista concreta de contextos y sus fronteras.** Ver sección 3.
- **Contratos de los puertos, modelo de datos, formato del artefacto declarativo.**
- **Estructura de carpetas definitiva.** Debe cumplir 2.2 y 2.3; el resto es del agente.
- **Estrategia de pruebas, empaquetado y despliegue.**

---

## 7. Siguiente paso

Definir la **fase de sesiones**: qué cubre cada sesión de trabajo, qué documentación entra en cada una y qué produce, de modo que ninguna arrastre el contexto acumulado de las anteriores.

Este documento está pensado para ser el punto de partida de esa conversación, y para viajar completo a cada sesión que necesite conocer la arquitectura, sin que haga falta reconstruirla.
