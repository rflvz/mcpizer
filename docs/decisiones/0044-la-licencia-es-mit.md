# 0044 — La licencia es MIT, y el aviso viaja dentro de cada paquete

**Estado**: Vigente. Cierra [0042](0042-la-licencia-la-elige-el-dueno.md).

## Contexto

La decisión [0042](0042-la-licencia-la-elige-el-dueno.md) dejó el repositorio listo para publicar salvo por una cosa, y explicó por qué esa cosa no la cerraba una sesión: una licencia es una cesión de derechos del dueño a terceros, no se deriva de ningún invariante, y no se puede revertir sobre lo ya distribuido. Era la única de las cuarenta y tres decisiones del registro que se escaló en vez de tomarse.

El dueño del repositorio la ha elegido: **MIT**.

## Decisión

**MIT**, declarada en los siete manifiestos y en el del taller, con el texto en `LICENSE`.

Y el aviso **viaja dentro de cada paquete publicado**: los siete llevan su propio `LICENSE` al lado del manifiesto, no solo la raíz del repositorio.

## Motivo

**Por qué MIT no necesita defensa técnica y sí registro.** Es la elección del dueño, que es exactamente lo que 0042 reservó para él; no hay nada que justificar aquí en términos de diseño. Lo que sí importa dejar escrito es que se tomó, cuándo, y que fue de quien tenía que ser — porque el efecto de esta decisión sobre quién puede integrar mcpizer y en qué es mayor que el de casi cualquier otra del registro, y dentro de un año nadie va a poder deducirlo del código.

**Por qué el fichero se copia siete veces en vez de vivir solo en la raíz.** Lo que recibe quien instala es un tarball, y lo que el tarball no lleve no existe para él ([0043](0043-lo-instalado-se-comprueba-con-el-npm-real.md)). MIT pide que el aviso se incluya en las copias; un `"license": "MIT"` sin el texto declara los términos y no los acompaña. Siete copias de veintiuna líneas es el precio, y es el mismo trato que el resto del repositorio da a la frontera entre contextos: se paga la duplicación cuando la alternativa es que algo funcione por vecindad.

**Por qué la negativa de publicar mira las dos cosas.** El campo se olvida al añadir un paquete octavo; el fichero se olvida igual, y además desaparece sin ruido cuando alguien reorganiza directorios. Que npm incluya `LICENSE` aunque `files` solo nombre `dist` es comportamiento de npm, no una propiedad de este repositorio, así que se comprueba sobre el tarball que `pnpm pack` produce de verdad en vez de confiarse.

**Y por qué la comprobación gana dos casos de fallo en lugar de perder uno.** Mientras no había licencia, la negativa la ejercitaba el propio árbol real: `publicables()` fallaba sola, y el test lo afirmaba filtrando las quejas de `license`. Elegida la licencia, ese filtro dejaría de excluir nada y la negativa se quedaría sin nadie que la hiciera fallar — una comprobación que nunca ha fallado no está verificada ([`../sesiones.md`](../sesiones.md) §2). Los dos descuidos nuevos del fixture ocupan ese sitio, y la afirmación sobre este repositorio pasa a ser la fuerte: no falta **nada**.

## Consecuencias

- `node deployment/publish.js` ya no imprime negativas. En seco, lista los siete paquetes que subiría; con `--publish`, los sube. **Publicar sigue sin haberse hecho**: es el paso irreversible, y darlo es del dueño igual que lo era elegir la licencia.
- Las negativas de publicar pasan de cinco a seis, y el fixture de `publicado-roto` de cuatro descuidos a seis.
- Añadir un paquete octavo a `PUBLICABLES` obliga a darle manifiesto **y** fichero. Lo atrapa la negativa, antes de subir nada.
- Cambiar de licencia más adelante es posible para versiones futuras y no para las publicadas. Es la propiedad de 0042 que no desaparece por haber elegido: solo deja de bloquear.

## Alternativas descartadas

- **Declarar `license` y no copiar el fichero.** Es lo más común en monorepos publicados, y deja al que instala con los términos nombrados y sin el texto que esos términos obligan a incluir. Cuesta veintiuna líneas por paquete arreglarlo.
- **Un enlace simbólico a la raíz en vez de siete copias.** Un tarball con un enlace dentro depende de que el cliente lo resuelva al desempaquetar, y el escritor de tar del fixture ni siquiera los admite ([0043](0043-lo-instalado-se-comprueba-con-el-npm-real.md)). Se ahorra duplicación en el árbol de trabajo a cambio de un modo de fallo en lo distribuido.
- **Generar las siete copias en el empaquetado.** Añade un paso propio entre `pnpm pack` y lo que se publica, que es justo lo que 0041 y 0030 evitan: quien empaqueta es pnpm, y lo que se comprueba es lo que produce.
