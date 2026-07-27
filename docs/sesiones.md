# La fase de sesiones

Cierra el "siguiente paso" de la sección 7 de [`arquitectura.md`](arquitectura.md): qué cubre cada sesión de trabajo, qué documentación entra en cada una y qué produce, de modo que ninguna arrastre el contexto acumulado de las anteriores.

Prerrequisito de lectura: `arquitectura.md`. Este documento no describe *cómo* implementar nada — ver §3.

---

## 1. Sesiones grandes

**Decisión: cuatro sesiones, cada una muy grande.**

La sección 7 no pide sesiones pequeñas. Pide que ninguna arrastre el contexto acumulado de las anteriores, que es otra cosa: **cuatro sesiones autocontenidas filtran menos contexto que doce, porque hay menos traspasos.** Cada traspaso es una oportunidad de que algo viaje en la cabeza de alguien en lugar de en el repositorio.

Y es la sección 1 aplicada al troceado. Si sobredeterminar el plan convierte un modelo caro en un transcriptor, trocear el trabajo en encargos de una hora hace lo mismo por otra vía: gasta la capacidad de razonamiento multipaso en recomponer un contexto que se acababa de tirar. Una sesión grande es la que permite que esa capacidad se dedique al problema.

Lo que cambia respecto a un troceado fino es dónde vive el riesgo. En una sesión larga sin supervisión intermedia, una decisión equivocada temprana se propaga durante horas antes de que nadie la vea. La respuesta a eso es §2, y no es "revisar más".

---

## 2. La autonomía la acota la verificación, no las instrucciones

Es la tesis de este documento y lo que hace viable todo lo demás.

Cuanto más grande y autónoma es una sesión, más carga soportan las comprobaciones automáticas de [`diseno/verificacion.md`](diseno/verificacion.md), porque son lo único que vigila mientras nadie mira. Un agente puede recorrer un espacio de decisión enorme con seguridad si el build falla en el instante en que se sale de las fronteras. Sin esas comprobaciones, la única forma de acotar el riesgo sería enumerar pasos — es decir, volver al transcriptor.

De ahí dos reglas que solo aparecen con sesiones grandes:

**Las barreras se levantan antes que lo que protegen.** La primera sesión no puede dejar los checks para el final: todo lo que venga después corre sin supervisión. S1 entrega guardarraíles demostrados antes que dominio, aunque eso retrase la primera línea de lógica.

**Una comprobación que nunca ha fallado no está verificada.** Cada check se acompaña de un caso que lo hace fallar. Es barato, y sin ello una sesión larga cree tener red y no la tiene — que es peor que no tenerla, porque cambia cómo se decide.

---

## 3. Contrato de sesión

Con sesiones grandes el contrato cambia de forma: deja de acotar la entrada y pasa a acotar la salida.

**Entra** — `arquitectura.md`, `diseno/` completo, `decisiones/` y el repositorio en su commit. Ninguna transcripción de sesiones anteriores. La tabla de lectura de [`diseno/README.md`](diseno/README.md) describe el mínimo por tipo de trabajo; una sesión grande carga el conjunto, que son unas mil líneas y no es un problema.

**Objetivo** — un enunciado, no una lista de pasos. La descomposición, el orden y la estructura interna son del agente. Esto no es delegación por comodidad: es la sección 1 del documento de arquitectura, y describir el *cómo* aquí desperdiciaría justo la capacidad que se quiere explotar.

**Termina cuando** — criterio **mecánico**: un comando que pasa o falla. Sin humano a media sesión, "funciona" no es un criterio, es una opinión aplazada.

**Decisiones** — corolario de la sección 1: decidir y dejar constancia en [`decisiones/`](decisiones/). Solo se escala lo que contradiga una decisión cerrada o un invariante. Con sesiones grandes esto pasa de recomendación a mecanismo central: una sesión que se detiene a preguntar cada vez que el diseño calla no llega al final.

**Si algo se bloquea** — se termina todo lo que no dependa del bloqueo y se deja constancia en el repositorio de qué queda pendiente y por qué. Nunca se deja todo a medias por igual.

---

## 4. Los tres portadores de contexto

Lo que permite arrancar una sesión en frío. Ninguno es la conversación.

1. **Las comprobaciones automáticas.** El portador fuerte: una sesión no puede violar un invariante del que nunca oyó hablar, porque el build no se lo permite. Es contexto codificado en el repositorio en vez de recordado.
2. **El registro de decisiones.** Lleva los juicios que otra sesión re-litigaría, con su motivo. Sin él, cada sesión reabre las mismas discusiones y a veces las resuelve al revés.
3. **La superficie pública de cada contexto.** Se leen superficies declaradas, no interiores.

El habilitador de fondo es la decisión [0004](decisiones/0004-sin-dependencias-entre-contextos.md), ningún contexto importa a otro: es lo que hace que el trabajo interno de una sesión no sea precondición de otra. Sin esa regla, la fase de sesiones no sería posible en esta forma — cada sesión heredaría el estado de las anteriores y la sección 7 quedaría fuera de alcance.

**Regla de defecto**: si una sesión necesita contexto conversacional de otra, no se alarga la sesión. Se escribe (registro de decisión) o se codifica (comprobación).

---

## 5. Las cuatro sesiones

### S1 — El núcleo, verificable en seco

De repositorio vacío a una herramienta que valida y explica políticas **sin infraestructura de ningún tipo**.

Cubre: el espacio de trabajo y los siete paquetes con superficie declarada · las cuatro comprobaciones automáticas con sus casos de fallo · `policy` · `access` · `principals`, `capabilities` y `accounts` · la CLI de verificación en seco.

**Termina cuando** `explain`, sobre el ejemplo de [`diseno/artefacto.md`](diseno/artefacto.md) §2, devuelve un motivo cuyo `path` resuelve a una posición real del documento; las cuatro comprobaciones pasan y cada una tiene un caso que la hace fallar; y los tests del núcleo no usan un solo doble.

Es el invariante 8 convertido en producto: se responde "¿quién puede emitir facturas?" en un portátil, sin red y sin que exista ningún despliegue. Y se convierte en el banco de pruebas de todo lo posterior, que es la razón de que vaya primero.

### S2 — La pasarela

De núcleo a servidor MCP funcionando.

Cubre: `runtime` con los siete puertos declarados, la traducción entre vocabularios y la orquestación reúne→decide→ejecuta · **una** implementación por puerto, la más simple de cada uno · el servidor MCP con `tools/list` y `tools/call`.

**Termina cuando** un cliente MCP real se conecta y ve solo lo concedido; invocar una tool no listada deniega con motivo; y un test confirma que ningún material de credencial aparece en registros ni en motivos.

Una sola implementación por puerto es deliberado: el objetivo es cerrar el camino completo, no la variación. La variación es S3.

### S3 — La periferia real

La segunda implementación de cada puerto: OIDC · git · MCP sobre HTTP en los dos lados · Vault · Redis · OpenTelemetry.

**Termina cuando** cada puerto tiene al menos dos implementaciones intercambiables por configuración, sin tocar el núcleo ni `runtime`.

Es donde el invariante 9 deja de ser una promesa. Si un contrato de puerto estaba mal planteado, aquí se rompe — y romperse aquí es el resultado bueno. No es trabajo repetitivo: OIDC frente a clave estática, o Vault frente a variables de entorno, se diferencian en ciclo de vida y en modos de fallo, no en fachada.

### S4 — Empaquetado, despliegue y operación

Cierra lo que la sección 6 de la arquitectura dejó fuera a propósito.

**Termina cuando** el artefacto desplegable se construye y arranca desde cero contra una política de ejemplo.

---

## 6. Qué no define este documento

- **Cómo implementar nada.** Sección 1: son restricciones e invariantes, no instrucciones.
- **El orden interno de cada sesión.** Es del agente, salvo la regla de §2 sobre levantar las barreras primero.
- **Estimaciones.** Una sesión termina cuando su criterio mecánico pasa. El tiempo que tarde es información, no objetivo.
- **Qué hacer si una sesión no cabe.** Si ocurre, la señal es que el criterio de terminación abarcaba dos cosas y no una; se parte por ahí, y se registra.
