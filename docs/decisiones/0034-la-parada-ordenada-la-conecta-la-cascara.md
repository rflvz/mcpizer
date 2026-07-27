# 0034 — La parada ordenada la conecta la cáscara, y no se abre puerto de señales, de salud ni de configuración

**Estado**: Vigente

## Contexto

Operar un proceso de larga vida trae tres preocupaciones que ningún documento de diseño había fijado: quién le manda parar y qué hace entonces, cómo sabe un orquestador que está sano, y de dónde salen los parámetros del despliegue.

La decisión [0027](0027-la-credencial-del-cliente-llega-por-peticion.md) dejó el hueco explícito: *"Con `--http` el proceso no termina cuando un cliente se va. Termina cuando se le manda terminar"* — sin decir quién manda ni qué ocurre después. Y [`../diseno/puertos.md`](../diseno/puertos.md) §3 no declina ningún puerto de configuración ni de salud, así que el silencio no era una respuesta.

Las tres son exactamente el tipo de abstracción que un implementador añade por reflejo, que es la razón declarada por la que declinar también hay que registrarlo.

## Decisión

**SIGTERM y SIGINT los atiende la cáscara**, en `serve`: deja de aceptar, y a partir de ahí recorre el cierre que ya existía —clientes, sesiones upstream, contadores y auditoría, en ese orden ([0023](0023-el-ciclo-de-vida-vive-en-el-compositor.md))— y sale con **0**.

**Se arma antes de abrir el primer recurso**, y una parada pedida durante el arranque se atiende en cuanto hay algo que parar.

**No hay temporizador que fuerce la salida**, y los manejadores son de un solo uso: la **segunda** señal encuentra la disposición por defecto.

**No se abre ningún puerto nuevo**: ni `SignalSource`, ni `HealthCheck`, ni `Config`. La sonda de salud es una ruta del adaptador HTTP, y su contenido lo compone la cáscara.

## Motivo

**Por qué la cáscara y no un puerto.** El invariante 9 exige variación real conocida para abrir una frontera, y aquí no la hay: las señales POSIX son una sola cosa, la sonda es una sola cosa, y la configuración ya tiene sitio decidido ([0022](0022-donde-se-elige-la-implementacion-de-cada-puerto.md)) — el artefacto para lo que es política, banderas de `serve` para lo que es despliegue. Un puerto con una única implementación de por vida no es un puerto, es un coste.

**Por qué el manejador se arma antes de abrir nada.** La ventana entre "empieza el arranque" y "hay servidor que parar" no es corta: con `--discover` dura lo que tarde el upstream más lento. Una señal ahí caería en la disposición por defecto de Node, y el proceso moriría dejando vivos los hijos que el descubrimiento ya había arrancado — que es peor que no atender la señal en absoluto, porque parece que se ha parado.

**Por qué no hay temporizador de salida forzada.** Es la tentación evidente: mandar `process.exit()` a los cinco segundos "por si acaso". Pero un proceso que no termina solo tiene un asa abierta que nadie cerró, y forzar la salida convierte esa fuga en algo que ya no se puede ver. La comprobación de S4 espera a que el proceso termine por sí mismo, y el caso de fallo de al lado —un proceso que atiende la señal y no suelta lo que tenía abierto— demuestra que esperar es lo que hace que la fuga se note. Quien pone el plazo es el orquestador, que ya tiene uno y ya sabe recurrir a SIGKILL.

**Y por qué eso no deja al operador sin salida.** Los manejadores se registran de un solo uso, así que la segunda señal ya no encuentra ninguno y vale la disposición por defecto. Insistir funciona, sin necesidad de `SIGKILL` y sin que el programa tenga que decidir por su cuenta cuándo rendirse.

**Por qué salir con 0 y no morir por la señal.** Morir *por* SIGTERM es indistinguible de una caída, y pierde el último lote de auditoría que la decisión [0023](0023-el-ciclo-de-vida-vive-en-el-compositor.md) se preocupó de vaciar. Un código propio es la diferencia entre "me pidieron parar y paré" y "me mataron".

**Por qué la sonda la compone la cáscara.** El adaptador HTTP no sabe qué información existe ni cuál de ella es publicable; la cáscara sí. Y la regla es dura porque quien interroga la sonda es un orquestador anónimo: sale el estado, la versión del proceso y la versión del artefacto de política —una huella del contenido, o el sha en git—, que es lo que un operador necesita para saber si el proceso ya recogió el cambio. **No sale `origin`**: es una ruta del sistema de ficheros o una URL de repositorio, y una URL de repositorio es el sitio exacto donde alguien acaba embebiendo un token.

**Y no enumera nada.** Ni capacidades, ni upstreams, ni cuentas. Anunciar por la sonda lo que la autorización no anuncia sería abrir por otra puerta lo que el invariante 3 cierra por la principal.

## Consecuencias

- Por stdio no hay sonda: el cliente **es** quien arrancó el proceso, y su salud es que el proceso siga vivo. La señal sí se atiende igual, porque en un contenedor la pasarela por stdio también es un proceso al que alguien manda parar.
- La sonda solo existe si quien arranca la compone. Un servidor HTTP montado sin ella no la expone, que es lo correcto cuando nadie sondea.
- Un fallo de arranque —artefacto ilegible, emisor sin fontanería, puerto ocupado— sigue siendo salida con código, nunca un proceso vivo y vacío ([`../diseno/puertos.md`](../diseno/puertos.md) §2.2). La sonda no puede contestar "sano" porque el proceso no llega a escuchar. Reiniciar en bucle es el comportamiento correcto.
- Si algún día un adaptador necesitara declarar su propia salud —un Redis caído, una bóveda inalcanzable—, esto es lo que hay que revisar. La señal sería que la sonda empezara a necesitar preguntar hacia fuera en vez de contestar lo que ya sabe.

## Alternativas descartadas

- **Un puerto `SignalSource` para poder falsear las señales en los tests.** No hace falta falsearlas: el caso de fallo manda una señal de verdad a un proceso de verdad. Y un puerto sin variación es indirección con nombre.
- **Un puerto `HealthCheck` que cada adaptador implemente.** Obligaría a los siete a declarar salud, y cinco de ellos no tienen ninguna que declarar. Es el mismo argumento con que la decisión [0023](0023-el-ciclo-de-vida-vive-en-el-compositor.md) rechazó `close()` en los puertos.
- **Un puerto `Config` o un fichero de configuración del despliegue.** Duplicaría lo que el artefacto ya declara y abriría dos sitios donde mirar cuando algo no cuadra. La decisión [0022](0022-donde-se-elige-la-implementacion-de-cada-puerto.md) ya fijó el contorno.
- **Una sonda de *readiness* separada de la de *liveness*.** La que hay es de vida: dice que el proceso está en pie y con qué política, no que la bóveda o el almacén respondan. Y eso es deliberado — ninguno de los dos se contacta al arrancar, y los dos fallan cerrado en la invocación, así que una sonda que preguntara hacia fuera declararía enfermo a un proceso que está haciendo exactamente lo que debe: denegar mientras la infraestructura no responde. Si algún día hace falta distinguirlas, lo publicable es un estado —`usage: degradado`—, nunca la dirección de nada.
- **Exponer métricas en la misma ruta.** La auditoría ya tiene su puerto y su camino. Una superficie de métricas es una frontera nueva sin variación conocida, y además es donde acaban filtrándose los nombres de cuentas y capacidades.
