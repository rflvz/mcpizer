# 0014 — En seco, el uso por defecto es cero, y el listado no lo consulta

**Estado**: Vigente

## Contexto

[`../diseno/puertos.md`](../diseno/puertos.md) §2.4 dice que si el almacén de contadores no responde, **el uso desconocido se trata como techo agotado**, no como cero. Es fallo cerrado y no se discute.

Pero la verificación en seco no tiene almacén de contadores, y nunca lo va a tener: es su propia definición. Si "sin almacén" significara "desconocido", `explain` denegaría siempre que hubiera un techo declarado, y la herramienta no serviría para nada.

Hay además una segunda pregunta, de [`../diseno/modelo.md`](../diseno/modelo.md) §5: el listado de tools no carga contadores, "porque los límites solo tienen sentido cuando hay algo que consumir".

## Decisión

**El uso tiene tres estados, no dos**: consultado con un valor, desconocido, y no consultado.

- **No consultado** — el listado. Los techos no se evalúan.
- **Desconocido** — el almacén falló. Techo agotado.
- **Consultado** — un número.

En la CLI, `explain` usa cero por defecto, `--usage <n>` fija el valor, `--usage unknown` fuerza el caso de fallo y `--usage none` el del listado.

## Motivo

Colapsar "no lo he preguntado" con "lo pregunté y no me contestaron" es lo que hace que la regla de fallo cerrado sea o inútil o insufrible, según hacia dónde se colapse. Son hechos distintos y llegan por caminos distintos: uno es una decisión del que pregunta, el otro es un fallo del que responde.

Con los tres estados, cada uno hace lo suyo sin debilitar a los demás. El listado ignora techos, que es lo que [`../diseno/modelo.md`](../diseno/modelo.md) §5 pide. El fallo del almacén deniega, que es el invariante 3. Y la verificación en seco dice explícitamente qué uso supone, que es lo honesto: no está fingiendo conocer un contador, está preguntando "¿qué pasaría con este uso?".

Que el defecto de `explain` sea cero, y no "no consultado", es deliberado: hace visible el techo en la respuesta y permite llegar a `limit_exhausted` subiendo un número, sin montar nada. La regla de fallo cerrado sigue siendo ejercitable a mano, y hay un test que la ejercita — una comprobación que nunca ha fallado no está verificada.

## Consecuencias

- La consecuencia que [`../diseno/modelo.md`](../diseno/modelo.md) §5 pide aceptar de forma consciente sigue en pie: que una tool sea visible no garantiza que la siguiente llamada se permita. El listado no mira techos.
- `diff` compara con uso no consultado. Comparar dos versiones del artefacto es una pregunta sobre lo declarado, y meter contadores volátiles haría que el resultado dependiera de cuándo se ejecuta.
- Sin techo declarado, un uso desconocido no deniega: no hay nada que agotar. La regla habla de techos, no de contadores.

## Alternativas descartadas

- **Dos estados, con "sin almacén" = desconocido.** Fiel a la letra del puerto y deja `explain` denegando siempre que haya techo. La herramienta que existe para explicar dejaría de explicar.
- **Dos estados, con "sin almacén" = cero.** Cómodo en seco y peligroso en ejecución: un almacén caído se leería como contador a cero, y una caída pasaría por permiso. Es justo lo que el puerto prohíbe.
- **Exigir siempre `--usage`.** Explícito y molesto: obliga a escribir el caso aburrido en cada pregunta, y quien pregunta por una capacidad casi nunca está preguntando por su techo.
