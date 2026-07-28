# Diseño detallado

Cierra lo que la sección 6 de [`../arquitectura.md`](../arquitectura.md) dejó deliberadamente abierto: la lista concreta de contextos y sus fronteras, los contratos de los puertos, el modelo de datos y el formato del artefacto declarativo.

**Sigue vigente la regla de la sección 1 de la arquitectura.** Estos documentos fijan restricciones e invariantes, no instrucciones. No hay código, ni firmas, ni estructura interna de los contextos. Donde se muestra una forma, fija *qué información existe y cuál está prohibida*, no cómo se escribe. Lo que no aparezca aquí lo decide el agente implementador — y, según el corolario de la sección 1, lo decide y deja constancia en [`../decisiones/`](../decisiones/) en lugar de preguntar.

---

## Regla de lectura

El objetivo de la sección 7 de la arquitectura es que ninguna sesión arrastre el contexto acumulado de las anteriores. Por eso el diseño está partido: **cada documento se lee con `../arquitectura.md` y nada más.**

Esta tabla es el **mínimo** por tipo de trabajo, no un techo. Las sesiones definidas en [`../sesiones.md`](../sesiones.md) son grandes y cargan el conjunto; la tabla sirve para saber qué es imprescindible y qué es contexto de apoyo.

| Si la sesión va a… | Lleva |
|---|---|
| Montar el esqueleto, el workspace o la CI | `contextos.md` + `verificacion.md` |
| Implementar un contexto del núcleo | `contextos.md` + `modelo.md` |
| Implementar un adaptador | `puertos.md` |
| Trabajar en la política, el esquema o la CLI de verificación | `artefacto.md` + `modelo.md` |
| Cablear la composición | `contextos.md` + `puertos.md` |
| Empaquetar, publicar, desplegar u operar | `entrega.md` + `puertos.md` |
| Revisar si algo cumple la arquitectura | `verificacion.md` |

Ninguna sesión necesita los seis. Si una parece necesitarlos, conviene sospechar del troceado de la sesión antes que del documento.

---

## Los documentos

| Documento | Qué fija |
|---|---|
| [`contextos.md`](contextos.md) | Los cinco contextos, sus vocabularios y la regla de frontera. Incluye la resolución de la tensión entre los invariantes 1 y 2: núcleo funcional, cáscara imperativa. **Empieza por aquí.** |
| [`modelo.md`](modelo.md) | Qué información contiene cada concepto y —lo vinculante— cuál tiene prohibida. Forma de `Decision` y `Reason`. |
| [`puertos.md`](puertos.md) | Contrato de cada puerto, sus ≥2 implementaciones previstas, y los puertos declinados con su motivo. |
| [`artefacto.md`](artefacto.md) | Formato del artefacto declarativo, con ejemplo comentado, y la superficie de verificación en seco. |
| [`verificacion.md`](verificacion.md) | Cómo cada criterio de la sección 5 se convierte en una comprobación que falla el build. |
| [`entrega.md`](entrega.md) | Estrategia de pruebas, qué es el artefacto desplegable, por qué caminos llega a quien lo usa, y el contrato de operación: cómo arranca, cómo para y qué se le puede preguntar. |

---

## Las tres decisiones que gobiernan el resto

Si solo se retiene una cosa de todo el diseño, que sean estas. Todo lo demás se deriva.

**1. El núcleo no llama a nada; es una función.** ([`contextos.md`](contextos.md) §1)
Es la única forma de que los invariantes 1 y 2 se cumplan a la vez. De aquí salen: que el tiempo y los contadores sean datos de entrada, que no exista un puerto `Clock`, que los puertos vivan en composición y no en el dominio, y que el núcleo se pruebe sin un solo doble.

**2. Ningún contexto importa a otro.** ([`contextos.md`](contextos.md) §3)
Más estricto que lo que pide la sección 3, a propósito. Hace el blast radius cero por construcción en vez de por disciplina, y reduce la comprobación automática a una regla sin excepciones. El precio es duplicar identificadores opacos entre contextos, que la sección 2.5 admite explícitamente. Corolario: no se crea ningún paquete común.

**3. Las dos identidades están en contextos separados.** ([`contextos.md`](contextos.md) §2, [`modelo.md`](modelo.md) §1)
`principals` y `accounts` no se importan y no comparten tipo. Colapsarlos exigiría fusionar paquetes — un cambio visible en revisión, no un descuido. Es el invariante 5 convertido en estructura.

---

## Qué sigue abierto

Deliberadamente, y por los mismos motivos de la sección 1 de la arquitectura:

- Estructura **interna** de cada contexto.
- Forma sintáctica concreta de tipos y funciones.

La estrategia de pruebas, el empaquetado y el despliegue ya no están abiertos: los cierra [`entrega.md`](entrega.md), que era el alcance de la sesión S4, y §2.1 le añadió después los tres caminos por los que el producto llega a quien lo usa. [`entrega.md`](entrega.md) §5 enumera lo que se sabe que falta y ya no promete ningún documento — que no es lo mismo que estar abierto.

La fase de sesiones, que era el "siguiente paso" de la sección 7 de la arquitectura, ya está definida en [`../sesiones.md`](../sesiones.md).
