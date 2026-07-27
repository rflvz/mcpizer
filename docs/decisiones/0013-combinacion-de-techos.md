# 0013 — El techo más restrictivo se compara por ritmo, y empata a favor de la ventana más corta

**Estado**: Vigente

## Contexto

[`../diseno/artefacto.md`](../diseno/artefacto.md) §3 dice que cuando varias concesiones coinciden con la misma cuenta "las capacidades se unen y **gana el límite más restrictivo**", por ser la única combinación que no puede ampliar el acceso por accidente.

No dice qué es más restrictivo entre `500 llamadas por 1h` y `20 por 24h`. Comparar el número de llamadas diría que el segundo; comparar la ventana diría lo contrario.

## Decisión

**Se comparan como llamadas por unidad de tiempo.** Gana el ritmo menor. En un empate, gana la ventana más corta. La ausencia de techo es el caso más permisivo de todos, así que cualquier techo declarado le gana.

## Motivo

El ritmo es lo que un techo significa: `500/1h` permite 12 000 llamadas al día y `20/24h` permite 20. Que el primero tenga un número mayor escrito al lado es una propiedad del texto, no del acceso que concede. Comparar los números sueltos elegiría el techo que más permite y le llamaría "el más restrictivo", que es exactamente el accidente que la regla existe para impedir.

El desempate por ventana más corta sigue el mismo criterio. A igual ritmo, la ventana corta obliga a esperar antes: `1 por 1m` y `60 por 1h` conceden lo mismo a la larga, pero la primera no deja gastarlo todo de golpe.

Que la ausencia de techo pierda contra cualquier techo se deriva de lo mismo: no declarar límite es ritmo infinito.

## Consecuencias

- El modelo compilado guarda la ventana en milisegundos junto al texto original (`1h`), para poder comparar sin perder lo que el autor escribió — un diagnóstico que devuelve `3600000` en lugar de `1h` obliga a traducir mentalmente.
- La comparación es total y determinista, así que reordenar el fichero no puede cambiar qué techo gana. Es la garantía de la decisión [0005](0005-politica-solo-aditiva.md) llevada hasta aquí.
- Un techo de `0` llamadas es ritmo cero: gana siempre y deniega siempre. Es coherente —conceder cero es no conceder— y el esquema lo admite a propósito, porque es la forma de suspender una concesión sin borrarla.

## Alternativas descartadas

- **Comparar solo el número de llamadas.** Elegiría el techo más permisivo en el caso que más importa.
- **Rechazar en compilación las concesiones con techos distintos sobre la misma cuenta.** Coherente con cómo se trata la ambigüedad de cuenta, y desproporcionado: aquí no hay opacidad sobre la segunda identidad, que es lo que hacía inaceptable elegir en silencio. La cuenta es la misma; lo único en juego es cuál de dos techos aplica, y hay una respuesta que no puede ampliar el acceso.
- **Aplicar los dos techos a la vez.** Es lo más correcto y exige que el contador conozca varias ventanas por concesión, lo que complica `UsageReader` antes de que exista. Cabe más adelante sin romper nada.
