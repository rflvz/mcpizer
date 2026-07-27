# 0021 — S2 no añade descubrimiento MCP al `CatalogSource`

**Estado**: Vigente

## Contexto

[`../sesiones.md`](../sesiones.md) §5 encarga a S2 "una implementación por puerto, la más simple de cada uno", y deja la variación para S3. Pero `CatalogSource` ya tiene la suya desde S1 —el catálogo declarado, por la decisión [0010](0010-dos-puertos-en-s1.md)—, así que la instrucción no dice qué hacer con él.

Y hay una tentación concreta: `ToolInvoker` obliga a escribir un cliente MCP por stdio de todas formas. Preguntarle `tools/list` al upstream, teniendo ya la sesión abierta, son diez líneas.

## Decisión

**El catálogo declarado se queda como única implementación.** El descubrimiento por MCP —stdio y HTTP— es S3.

## Motivo

Que sea barato no lo convierte en el alcance de esta sesión. Diez líneas de descubrimiento traen consigo las preguntas que las acompañan: cuándo se refresca el catálogo, qué pasa si un upstream está caído al arrancar, qué se sirve mientras tanto. `puertos.md` §2.3 ya avisa de que "un upstream caído no puede degradarse a 'sin tools': eso permitiría que una caída pasara silenciosamente por una revocación", y contestar eso bien es trabajo de verdad, no un añadido.

Hay además una razón de fondo. El catálogo declarado **no es un sustituto pobre** del descubrimiento: `puertos.md` §2.3 dice que "no es un doble de test, es lo que hace posible el invariante 8". Una pasarela que sirve descriptores versionados junto a la política es una pasarela honesta, no una a medias — sirve exactamente lo que la verificación en seco prometió que serviría, que es la propiedad que hace que `explain` valga para algo.

Que la primera implementación de este puerto se escribiera antes que las de los demás es un accidente del troceado, y no un motivo para adelantarle la segunda.

## Consecuencias

- Los esquemas de entrada que el cliente ve salen del fichero de catálogo, no del upstream. Si divergen, la pasarela sirve lo declarado; `validate` detecta en seco los mapeos a tools que ya no existen, que es la mitad que importa.
- El catálogo hay que generarlo y versionarlo. `puertos.md` §2.3 ya lo daba por hecho — "generable desde los upstreams reales y versionable junto a la política" — y esa herramienta no existe todavía. Queda pendiente y anotado aquí, porque es lo que hará cómodo el flujo cuando el descubrimiento llegue.
- S3 hereda la frontera intacta y con un consumidor real ejercitándola, que es la posición desde la que se sabe si un contrato estaba bien planteado.

## Alternativas descartadas

- **Añadir el descubrimiento por stdio ahora.** Casi gratis en código y adelanta el alcance de S3, incluidas sus preguntas difíciles. Si se contestaran mal por ser un añadido, el fallo aparecería como una revocación silenciosa.
- **Sustituir el catálogo declarado por descubrimiento.** Rompería el invariante 8: validar el mapeo exigiría levantar los upstreams, y la verificación en seco dejaría de ser en seco.
