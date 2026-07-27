# 0012 — `path` es un puntero RFC 6901, y `policy` sabe llevarlo a línea y columna

**Estado**: Vigente

## Contexto

[`../diseno/modelo.md`](../diseno/modelo.md) §4.1 dice que `path` "apunta al lugar del artefacto declarativo que produjo el resultado", y el criterio de terminación de S1 exige que ese `path` "resuelva a una posición real del documento".

Eso admite dos lecturas. Una: un puntero que navega la estructura del documento y aterriza en algo que existe. Otra: una línea y una columna. Cada una sirve para una cosa distinta —la primera para comparar y consultar, la segunda para abrir el editor en el sitio— y elegir solo una deja coja la otra mitad.

Hay además una restricción de forma: `access` produce motivos con `path` y **no puede importar `policy`** (decisión [0004](0004-sin-dependencias-entre-contextos.md)).

## Decisión

**`path` es un puntero RFC 6901** (`/grants/2/using`). Viaja como cadena opaca por todos los contextos. **`policy` expone el resolutor** que lo convierte en línea, columna y desplazamiento sobre el documento original.

## Motivo

Satisface las dos lecturas sin duplicar información. El puntero navega el documento —se puede comparar, indexar y usar como clave— y quien tenga el documento delante puede pedirle la posición. Una línea y una columna sueltas no permiten lo primero; un puntero suelto no permite lo segundo.

Y encaja con la regla de frontera sin esfuerzo: una cadena la puede declarar cada contexto en sus propios términos. `access` sabe que el motivo lleva un `path`, no sabe qué significa, y no lo necesita para decidir. La composición y la CLI, que sí tienen el documento, lo resuelven. Si `path` fuera un tipo estructurado de `policy`, `access` tendría que importarlo, y esa arista está prohibida.

RFC 6901 en lugar de una notación propia porque ya es el vocabulario del ecosistema: es lo que devuelven los validadores de JSON Schema al señalar dónde falla algo, así que los diagnósticos estructurales y los semánticos hablan el mismo idioma sin traducción.

## Consecuencias

- Resolver exige conservar el documento parseado, no solo el modelo compilado. `policy` devuelve las dos cosas.
- Una denegación señala una **ausencia**, y una ausencia también tiene sitio: "ninguna concesión cubre esto" apunta a `/grants`, y "la capacidad no está declarada" a `/capabilities`. Por eso la política compilada lleva punteros de sección además de los de cada elemento.
- La propiedad "todo `path` resuelve" se comprueba sobre artefactos generados, no solo sobre el ejemplo. Un `path` que no resuelve satisface el tipo y no sirve para nada.
- Un puntero que no apunta a nada devuelve ausencia de posición, nunca una posición inventada. Señalar el sitio equivocado es peor que no señalar ninguno.

## Alternativas descartadas

- **Línea y columna directamente en `Reason`.** Más simple para la CLI y peor para todo lo demás: dos motivos del mismo sitio no se pueden comparar, y el modelo compilado quedaría atado al texto exacto del que salió.
- **Una notación propia tipo `grants[2].using`.** Se lee algo mejor y obliga a escribir un analizador propio y a traducir la salida del validador de esquema.
- **Un tipo estructurado compartido entre contextos.** Es el paquete común que la decisión [0004](0004-sin-dependencias-entre-contextos.md) prohíbe, en su forma más razonable y por tanto más peligrosa.
