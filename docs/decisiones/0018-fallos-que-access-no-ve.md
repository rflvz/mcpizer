# 0018 — Los fallos que `access` no ve envuelven la decisión; no amplían `ReasonCode`

**Estado**: Vigente

## Contexto

`tools/call` puede acabar mal de más maneras de las que el núcleo conoce. No autenticar, un nombre de tool que no existe, una bóveda que no responde, un upstream caído: ninguna de las cuatro es una decisión de política, y las cuatro tienen que llegarle al cliente.

La salida cómoda es añadirlas a `ReasonCode`. Es un vocabulario de motivos, y estos son motivos.

## Decisión

**`ReasonCode` no crece.** La pasarela devuelve una unión propia —`CallOutcome`— con un caso `denied` que **contiene** la `Decision` del núcleo, y un caso por cada fallo de borde.

## Motivo

[`../diseno/modelo.md`](../diseno/modelo.md) §4.1 dice que el vocabulario es cerrado, y qué compra ese cierre: "un consumidor puede ramificar exhaustivamente sobre los motivos y saber que no le va a llegar uno que no contempla". Un vocabulario que crece cada vez que aparece un modo de fallo nuevo en la periferia no es cerrado; es abierto con pasos pequeños. Y perdería la propiedad justo cuando más vale, porque quien ramifica sobre motivos suele ser el código que decide si reintentar.

Hay una razón más fuerte, de significado. Cada `ReasonCode` señala **un sitio del artefacto**, y esa es la mitad que hace útil al motivo: `path` convierte "denegado" en "denegado, y el sitio a tocar es este". Un upstream caído no tiene sitio en el artefacto. Meterlo en el mismo tipo obligaría a inventar un `path` o a hacerlo opcional, y hacerlo opcional debilitaría la garantía para todos los demás.

La estratificación además es lo que [`../diseno/puertos.md`](../diseno/puertos.md) §2.6 exige explícitamente: "los fallos del upstream se propagan al cliente **distinguibles** de las denegaciones de mcpizer; confundir 'denegado por política' con 'el proveedor está caído' haría inútil el bucle de corrección del invariante 4". Con casos separados en el tipo, confundirlos no compila.

No es una forma nueva: `Explanation` ya envuelve así en la verificación en seco, donde la resolución del principal puede fallar antes de que haya nada que decidir.

## Consecuencias

- El caso `unknown-tool` no llega a `access`. Es correcto y conviene verlo: sin capacidad no hay nada que decidir, y fabricar una capacidad falsa para obtener un motivo sería exactamente lo que esta decisión evita.
- Cada caso se traduce a un texto distinto para el cliente, y todos dicen dónde mirar. Los de política señalan el artefacto; los de periferia, qué pieza falló.
- Añadir un modo de fallo de borde en S3 —una bóveda que caduca, un emisor que no responde— es un caso más en `CallOutcome` y no toca el núcleo ni sus tests de propiedad.

## Alternativas descartadas

- **Ampliar `ReasonCode` con los cuatro casos.** Un tipo menos, y el vocabulario cerrado deja de serlo. Además obliga a que `path` sea opcional o mentiroso.
- **Un `Reason` con `code` libre para la periferia.** Peor que lo anterior: mantiene el tipo y tira la propiedad sin dejar rastro en la firma.
- **Excepciones para lo que no es decisión.** Separa bien las dos familias y hace que el camino de error deje de estar en el tipo de retorno, así que el compilador ya no obliga a contemplarlo. La denegación es un resultado normal de esta función, no un imprevisto.
