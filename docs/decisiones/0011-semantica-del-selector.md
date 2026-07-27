# 0011 — El selector es una conjunción de igualdades sobre atributos de un solo valor

**Estado**: Vigente

## Contexto

La decisión [0005](0005-politica-solo-aditiva.md) exige que dos concesiones que cubren la misma capacidad **para el mismo principal** con cuentas distintas fallen en compilación. Eso obliga a decidir cuándo dos selectores pueden casar con el mismo principal, y esa pregunta no tiene respuesta sin fijar antes qué es un atributo.

El ejemplo de [`../diseno/artefacto.md`](../diseno/artefacto.md) §2 la deja abierta: declara `team: claim:groups`, y `groups` en OIDC suele ser una lista.

## Decisión

**Los atributos de un principal son cadenas de un solo valor.** Un selector es una conjunción de igualdades: el principal encaja si las cumple todas. Dos selectores son **disjuntos si y solo si** comparten una clave con valores distintos; en cualquier otro caso se tratan como solapados.

Normalizar un claim multivaluado a un atributo es responsabilidad de `principals`, y se resuelve cuando exista un adaptador OIDC real (S3).

## Motivo

Lo que está en juego es si el análisis de ambigüedad es **exacto** o **conservador**, y la respuesta depende enteramente de esto.

Con atributos de un solo valor, `{team: ventas}` y `{team: soporte}` no pueden casar con el mismo principal, así que dos concesiones que se diferencien en eso nunca son ambiguas. El análisis es exacto: señala justo los pares que de verdad dejarían la segunda identidad indeterminada.

Con atributos multivaluados, `{team: ventas}` y `{team: soporte}` **sí** pueden casar con el mismo principal —alguien en los dos grupos—, así que no existiría ninguna forma de demostrar disyunción. Toda pareja de concesiones del mismo emisor que compartiera una capacidad con cuentas distintas sería ambigua, y el mecanismo de escape que [0005](0005-politica-solo-aditiva.md) ofrece —"la excepción se expresa estrechando el selector"— dejaría de funcionar, porque estrechar no separa. La regla pasaría de proteger contra una opacidad real a impedir configuraciones legítimas.

Elegir un solo valor es además lo único que S1 puede observar: sin adaptador OIDC, los atributos vienen de la CLI o de los literales de un emisor `static-key`, y en los dos casos son escalares. Fijar ahora la semántica multivaluada sería legislar sobre un caso que nadie ha visto todavía.

## Consecuencias

- Un claim que llega como lista tendrá que reducirse a un valor al normalizarlo. La forma de esa reducción —el primer valor, uno declarado explícitamente, o expandir el principal a varios— es trabajo de S3, con el adaptador delante.
- Si S3 concluye que los atributos deben ser conjuntos, esta decisión se sustituye por otra y el análisis de ambigüedad pasa a ser conservador. Se registra entonces, no se edita esta.
- `principals` descarta los atributos que el emisor no declara, y la compilación rechaza un selector sobre un atributo no declarado. Las dos cosas apuntan a lo mismo: la política no puede discriminar sobre algo que no esté escrito en el artefacto.

## Alternativas descartadas

- **Atributos como conjuntos, con solape conservador.** Es probablemente lo correcto el día que exista OIDC de verdad, y por eso queda anotado como el camino de sustitución. Hoy convertiría el error de ambigüedad en ruido constante sin haber visto un solo caso real.
- **Declarar la aridad en el artefacto** (`team: { claim: groups, multi: true }`). Resuelve las dos a la vez, y añade superficie de esquema para un caso que ningún adaptador produce todavía. Cabe añadirla después sin romper nada, que es la razón para no añadirla ahora.
