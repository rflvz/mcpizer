# 0043 — Lo publicado se comprueba instalándolo con el `npm` real, contra un registro de fixture

**Estado**: Vigente

## Contexto

El criterio de esta sesión es *"lo que se publica se instala y arranca"*, y tiene la misma trampa que tuvo el de S4: se puede dar por bueno mirando ficheros. Un tarball existe, un manifiesto declara lo que hay que declarar, y nada de eso dice si el producto se instala.

Y hay una restricción que no se mueve: `pnpm verify` no toca la red ([`../diseno/entrega.md`](../diseno/entrega.md) §4). Un registro npm de verdad está en la red por definición.

## Decisión

**Se instala de verdad, con el cliente de `npm` real, contra un registro de fixture que habla su protocolo.** El registro sirve dos cosas de procedencia distinta, y la distinción es la decisión:

- **Los siete paquetes propios**, tal y como los produce `pnpm pack` — el mismo camino que recorre `pnpm publish`.
- **El cierre de dependencias**, empaquetado desde el almacén que fijó el fichero de bloqueo, por un escritor de tar de veinte líneas que vive en el fixture.

Después, el binario instalado se ejecuta **por su nombre**, fuera del repositorio y con el entorno podado: valida, explica, y atiende a un cliente MCP de verdad. Y `npx mcpizer`, que es un camino distinto, se ejecuta también.

## Motivo

**Por qué un registro de fixture y no un doble.** Es la regla de [`../diseno/entrega.md`](../diseno/entrega.md) §1: un doble sustituye algo *dentro* de lo que se prueba; un servidor de fixture es el otro extremo del cable. Aquí lo que hay que saber no es si nuestro guion llama a nuestra función, sino si **el `npm` que teclea quien instala** entiende lo que se le va a subir. Eso solo lo contesta el `npm` de verdad, y para que conteste hace falta algo que hable su protocolo.

**Por qué los siete tarballs los hace `pnpm pack` y los demás no.** La distinción parece un detalle y es lo que hace que la comprobación signifique algo. `pnpm pack` es quien sustituye `workspace:*` por la versión real y quien aplica `files`; los dos son sitios donde el publicado se rompe. Si el tarball de lo que se publica lo escribiera el fixture, la comprobación mediría **nuestra** idea de qué entra en un paquete, y un `files` mal declarado pasaría sin ruido. Las dependencias de terceros no están bajo prueba: ya están en disco tal y como las publicó su autor, y por eso ahí sí vale un tar escrito a mano.

**Por qué se ejecuta el binario por su nombre.** `node <ruta>/main.js` se salta el shebang y el enlace que npm dejó, que son justo las dos cosas que solo existen después de instalar.

**Y por qué esto encuentra algo que ninguna otra comprobación puede encontrar.** Una dependencia de producción declarada como `dev` no rompe nada en el árbol de trabajo, produce un tarball impecable y se publica sin una queja. El registro tampoco protesta: npm instala lo que los manifiestos piden, y eso no lo pide nadie. El primero que se entera es quien instaló. Aquí es un caso de fallo que corre en cada `pnpm verify`.

## Consecuencias

- El espejo se construye desde `node_modules/.pnpm`, así que la comprobación afirma algo bastante fuerte: **se instala lo que el fichero de bloqueo fijó**. Lo que no esté ahí no se resuelve por casualidad, porque no hay ningún otro sitio de donde sacarlo.
- Empaquetar casi cien dependencias cuesta unos segundos por ejecución. Es el precio de no tener red, y es el mismo trato que el resto de la periferia: un proveedor OIDC que firma de verdad también cuesta más que un doble.
- El escritor de tar es código de fixture que hay que mantener. Se acota a lo mínimo —ustar, ficheros regulares, sin enlaces— y falla ruidosamente ante una ruta que no cabe, en vez de truncarla: un tarball al que le falta un fichero en silencio sería peor que no tener la comprobación.
- Si algún día hay un registro de verdad, esto no se sustituye. Publicar seguiría sin poder comprobarse antes de publicar.

## Alternativas descartadas

- **Comprobar los manifiestos y no instalar.** Es lo que hace `publicables()`, y es necesario pero no suficiente: los cuatro descuidos que ve son los que se ven mirando. El quinto no.
- **Instalar contra el registro público de npm en CI.** Mete red en el comando de verificación, ata el resultado a la disponibilidad de un tercero, y no puede probar lo que **todavía no está publicado**, que es exactamente lo que hay que probar.
- **Levantar un registro de verdad —Verdaccio o similar— como servicio.** Una dependencia de desarrollo grande y un servicio que levantar, para contestar lo mismo. La regla del repositorio es que la verificación corra sin servicios levantados.
- **Empaquetar el cierre con `npm pack` por dependencia.** Casi cien procesos por ejecución. La misma respuesta, mucho más lenta.
