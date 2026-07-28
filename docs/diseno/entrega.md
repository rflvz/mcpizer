# Entrega: pruebas, empaquetado, despliegue y operación

Cierra el quinto guion de la sección 6 de [`../arquitectura.md`](../arquitectura.md) — *"estrategia de pruebas, empaquetado y despliegue"* — y lo que S4 le añadió al enunciarse como "empaquetado, despliegue y **operación**".

Prerrequisito de lectura: `../arquitectura.md`. Se apoya en [`verificacion.md`](verificacion.md) para todo lo que ya era comprobación automática, y no lo repite.

**Sigue vigente la regla de la sección 1**: esto fija restricciones e invariantes, no instrucciones. No hay recetas de despliegue, ni manifiestos, ni un `Dockerfile` pegado dentro. Lo vinculante es **qué tiene que cumplir el artefacto y cómo se comprueba**; el cómo concreto vive en el repositorio, ejecutable.

---

## 1. Estrategia de pruebas

La sección 2.4 de la arquitectura dice que las métricas son señales y no objetivos, y [`verificacion.md`](verificacion.md) §5 descarta explícitamente la cobertura como número. Lo que sí se fija es **qué se prueba con qué**, y por qué cada nivel existe.

| Nivel | Qué prueba | Qué lo caracteriza |
|---|---|---|
| Unidad del núcleo | Cada contexto, por su superficie declarada | **Sin un solo doble.** Si probarlo necesita simular algo, el núcleo ha dejado de ser una función |
| Propiedad | Fallo cerrado y explicabilidad, sobre artefactos generados | Universales sobre *toda* configuración válida, no sobre los ejemplos que a alguien se le ocurrieron |
| Adaptador | Cada implementación de puerto, contra un servidor que habla su protocolo | Servidores de fixture, no dobles: OIDC firma de verdad, Redis responde RESP, Vault contesta su API |
| Aceptación | Los criterios de terminación de las cuatro sesiones | Recorren el producto entero por su borde exterior, como lo haría un cliente |
| Arquitectura | Los nueve criterios de la sección 5 | Reglas sobre el grafo de imports, la estructura y los manifiestos |

Tres reglas gobiernan los cinco niveles, y son las que de verdad hay que retener:

**1. Un doble dentro del núcleo es una señal de fallo; un servidor de fixture en la periferia, no.** La diferencia no es de tecnología, es de lado. Un doble sustituye algo *dentro* de lo que se está probando y hace que la prueba mida el andamiaje. Un servidor de fixture es el **otro extremo del cable**: habla el protocolo real, y sin él no habría a quién llamar. Por eso el núcleo se prueba sin ninguno y la periferia se prueba contra varios.

**2. Toda comprobación tiene un caso que la hace fallar.** Es la regla de [`../sesiones.md`](../sesiones.md) §2 y no admite excepción: sin ella, una sesión larga cree tener red y no la tiene, que es peor que no tenerla porque cambia cómo se decide. El caso de fallo ejecuta **la misma** comprobación, no una imitación; si necesitara andamiaje propio, no demostraría nada sobre la comprobación de al lado.

**3. Nada se prueba dos veces a distinto nivel.** El criterio de aceptación de una sesión no reimplementa las comprobaciones de la anterior: las hereda porque siguen corriendo.

Y un límite que no se mueve: **la verificación en seco no toca la red**. Comprueba integridad referencial, no alcanzabilidad ([`artefacto.md`](artefacto.md) §1). El único sitio del repositorio que arranca procesos y abre sockets es el arnés de aceptación, nunca `validate`.

---

## 2. Qué es el artefacto desplegable

**Un directorio autocontenido**: el programa compilado y el cierre de sus dependencias de producción. Con eso y un Node 22 hay pasarela — no hace falta el repositorio, ni el gestor de paquetes, ni una instalación previa, ni red ([0030](../decisiones/0030-el-artefacto-desplegable-es-el-cierre-de-runtime.md)).

Tres propiedades son vinculantes, y las tres se comprueban:

- **No lleva fuentes.** Lo que viaja es lo compilado.
- **No lleva el taller.** Ni compilador, ni linter, ni ejecutor de tests. Lo que no viaja no hay que parchearlo, y no amplía la superficie de nadie.
- **Lleva su propio cierre de dependencias**, gobernado por el fichero de bloqueo. Lo que se despliega es exactamente lo que se verificó.

Lo que **no** es, y por qué importa: no es un fichero único producido por un empaquetador. Aplanar los siete paquetes destruiría la frontera entre contextos, que en este repositorio no la sostiene una convención sino el gestor de módulos ([`verificacion.md`](verificacion.md) §1). Verificar en el árbol de trabajo una propiedad que el artefacto desplegado no tiene sería verificar otra cosa.

La imagen de contenedor es una **envoltura** de ese directorio, no otra forma de construirlo ([0032](../decisiones/0032-la-imagen-es-una-envoltura.md)). Si construyera el producto por su cuenta habría dos empaquetados y solo uno comprobado.

---

## 3. El contrato de operación

Esto es lo que un despliegue puede dar por cierto. Es la parte vinculante del documento: cualquier plataforma que lo respete sirve, y por eso aquí no hay manifiestos de ninguna en concreto.

### 3.1 Cómo arranca

**Un fallo de arranque es una salida con código, nunca un proceso vivo y vacío.** Artefacto ilegible, emisor sin con qué autenticar, puerto ocupado: el proceso no llega a escuchar. Una política vacía sería sintácticamente válida y lo denegaría todo, que es seguro e indistinguible de un fallo de infraestructura ([`puertos.md`](puertos.md) §2.2).

De ahí una consecuencia operativa que conviene no "arreglar": **reiniciar en bucle es el comportamiento correcto** ante una política o una bóveda ausentes.

Y una exigencia que es fácil pasar por alto: **un arranque que falla a medias tiene que terminar**. El modo en que esto se rompe no es que el código de salida sea el equivocado — es que el proceso lo fija y no muere, porque lo que abrió antes de fallar mantiene vivo el bucle de eventos. Con descubrimiento contra varios upstreams es el caso normal: uno responde, otro no, y el hijo del primero sobrevive al fallo del segundo. El operador ve el mensaje correcto y el contenedor no se reinicia nunca.

Por eso **todo lo que puede rechazarse sin abrir nada se rechaza antes**: una bandera mal escrita comprobada después del descubrimiento produce exactamente ese proceso zombi, y es lo más barato de detectar que existe.

Toda la configuración entra por dos vías, y no hay una tercera ([0022](../decisiones/0022-donde-se-elige-la-implementacion-de-cada-puerto.md)): el **artefacto de política** decide qué implementación atiende a cada emisor, upstream y cuenta; las **banderas de arranque** deciden los tres hechos que son del despliegue y no de la política —de dónde se carga el artefacto, dónde viven los contadores y adónde va la auditoría—. No hay fichero de configuración del despliegue, y no debe haberlo.

### 3.2 Cómo para

**SIGTERM y SIGINT se atienden**: deja de aceptar, cierra clientes, sesiones upstream, contadores y auditoría —en ese orden, y la auditoría la última para que lo ocurrido durante el cierre también quede registrado ([0023](../decisiones/0023-el-ciclo-de-vida-vive-en-el-compositor.md))— y **sale con 0**.

Salir con 0 y no morir *por* la señal es la diferencia observable entre "me pidieron parar y paré" y "me mataron", y es lo que garantiza que el último lote de auditoría llegó a su destino.

**Se atiende desde antes de abrir el primer recurso.** La ventana entre "empieza el arranque" y "hay servidor que parar" dura, con descubrimiento, lo que tarde el upstream más lento; una señal ahí sin manejador mata el proceso por disposición por defecto y deja vivos los hijos ya arrancados.

**No hay temporizador de salida forzada** ([0034](../decisiones/0034-la-parada-ordenada-la-conecta-la-cascara.md)). Un proceso que no termina tiene un asa que nadie cerró, y forzar la salida convertiría esa fuga en algo invisible. El plazo lo pone el orquestador, que ya tiene uno. Y una **segunda** señal encuentra la disposición por defecto: quien quiera insistir puede hacerlo sin llegar a `SIGKILL`.

Un detalle que decide si todo lo anterior sirve: cerrar el servidor tiene que cerrar **todas** las conexiones, no solo las ociosas. Basta un socket aceptado que nunca pidió nada —una sonda TCP, un escaneo de puertos, un cliente que abre y calla— para que un cierre por lo demás correcto no complete jamás.

### 3.3 Qué se puede preguntar desde fuera

Con transporte HTTP hay una **sonda sin credencial**. Es lo único que se atiende sin ella, porque quien la interroga es un orquestador anónimo, y de ahí la regla que la gobierna: **todo lo que salga por ahí es público**.

Sale el estado, la versión del proceso y la versión del artefacto de política —una huella del contenido, o el sha en git—, que es lo que un operador necesita para saber si el proceso ya recogió el cambio.

No sale el **origen** del artefacto: es una ruta del sistema de ficheros o una URL de repositorio, y una URL de repositorio es el sitio exacto donde alguien acaba embebiendo un token. Y no se **enumera** nada —ni capacidades, ni upstreams, ni cuentas—: anunciar por la sonda lo que la autorización no anuncia sería abrir por otra puerta lo que el invariante 3 cierra por la principal.

**Solo se lee.** Es el único punto del servidor al que se llega sin credencial, así que contestar a cualquier verbo sería superficie que nadie ha diseñado.

Y dice **vivo**, no *listo*: no consulta la bóveda, ni el almacén de contadores, ni los upstreams. No es un descuido — ninguno de los tres se contacta al arrancar, y todos fallan cerrado en la invocación. Una sonda que preguntara hacia fuera contestaría "enfermo" a un proceso que está haciendo exactamente lo que debe, que es denegar mientras la infraestructura no responde.

Con transporte stdio no hay sonda, y no debe haberla: el cliente **es** quien arrancó el proceso, y su salud es que el proceso siga vivo.

### 3.4 Dónde termina el proceso y dónde empieza la plataforma

- **TLS lo termina el despliegue.** El proceso habla en claro y escucha por defecto en la interfaz de bucle; abrirlo a la red exige decirlo ([0033](../decisiones/0033-tls-fuera-cors-ninguno-techo-dentro.md)).
- **Autorización en el borde, nunca.** Un proxy que rechace por su cuenta convierte una denegación explicable —con su código y su sitio en el artefacto— en un 401 mudo, y rompe el bucle de corrección del invariante 4. Es la única cosa que un borde exterior tiene prohibido hacer.
- **El techo de tamaño de petición sí es del proceso.** Sin él, cualquiera que alcance el puerto agota la memoria antes de que nadie haya decidido nada: la denegación llega después de haber leído lo que se envió.
- **Nada canjeable se hornea en el artefacto ni en la imagen.** La política solo lleva referencias, que es la razón declarada de que pueda vivir en git y revisarse por PR ([`artefacto.md`](artefacto.md) §5). Los valores los inyecta el despliegue.

### 3.5 Qué se observa

**stdout es el protocolo** cuando el transporte es stdio, así que el registro de decisiones va a **stderr** ([0019](../decisiones/0019-el-registro-va-a-stderr.md)). Un despliegue tiene que recoger los dos descriptores.

Se registran **permisos y denegaciones**. Ningún filtro de operación —nivel, muestreo, "solo errores"— puede suprimir los permisos: sería perder justo el caso que más importa auditar, quién usó qué cuenta.

Un almacén de contadores caído **deniega**: uso desconocido es techo agotado, nunca cero ([`puertos.md`](puertos.md) §2.4). Es el comportamiento correcto y no se "arregla" con un repliegue a memoria — que sería ejecutar sin techo justo cuando no se sabe cuánto se ha usado.

Y los fallos del upstream llegan al cliente **distinguibles** de las denegaciones de la pasarela. Confundir "denegado por política" con "el proveedor está caído" haría inútil el bucle de corrección.

---

## 4. Cómo se comprueba todo esto

El criterio de terminación de S4 ([`../sesiones.md`](../sesiones.md) §5) es *"el artefacto desplegable se construye y arranca desde cero contra una política de ejemplo"*. La frase tiene tres trampas, y la comprobación existe para cerrarlas:

| La palabra | Cómo se queda en teatro | Qué lo impide |
|---|---|---|
| **se construye** | El arnés construye a su manera y comprueba su propio artefacto | Se ejecuta el mismo guion que se ejecuta a mano y que invoca la imagen. Un solo empaquetado |
| **desde cero** | Se apoya sin querer en el árbol de trabajo | El proceso arranca **fuera** del repositorio, con el entorno podado. Y un artefacto sin su cierre de dependencias —que *parece* un artefacto— solo se cae al arrancarlo |
| **arranca** | El proceso sigue vivo y nadie le pregunta nada | Un cliente MCP de verdad, por los dos transportes: ve exactamente lo concedido, recibe motivo y sitio al ser denegado, y una concesión llega hasta el upstream con su credencial |

Y lo que S4 añade de operación lleva sus casos de fallo, porque una comprobación que nunca ha fallado no está verificada:

- Un proceso que **no atiende** SIGTERM muere por la señal, no con código.
- Uno que **sí lo atiende y no suelta** lo que tenía abierto no termina nunca — el descuido que parece corrección.
- Un socket **conectado y mudo** no cuelga el cierre. Cerrar solo las conexiones ociosas lo dejaría esperando para siempre, y es lo que hace cualquier sonda TCP.
- Un **arranque a medias** —un upstream responde, el otro no— termina con código, en vez de quedarse vivo con el hijo del primero.
- Una **bandera mal escrita** sale con código de uso *antes* de abrir nada.
- Dos manifiestos con versiones distintas **no producen artefacto**.
- Un techo de petición que rechazara todo pasaría la comprobación de que rechaza lo grande; por eso hay otra de que acepta lo que cabe.

Todo esto corre dentro del comando de verificación, **sin Docker, sin red y sin servicios levantados**. La imagen se construye y se arranca aparte, en CI, porque necesita un demonio de contenedores y el criterio no puede depender de él.

---

## 5. Qué sigue abierto

De lo que el diseño había previsto, **nada**. El generador del catálogo declarado existe ([0039](../decisiones/0039-el-generador-del-catalogo-declarado.md)) y las cinco implementaciones de puerto que faltaban están escritas, cada una con su servidor de fixture hablando el protocolo real ([0040](../decisiones/0040-se-escriben-las-implementaciones-previstas.md)). [`puertos.md`](puertos.md) §4 ya no tiene nada en la columna de "previsto y sin escribir".

Eso no quiere decir que no quede trabajo. Quiere decir que el que queda ya no está prometido por ningún documento, y conviene nombrar lo que se sabe que falta:

- **Ningún adaptador tiene todavía un usuario.** No hay despliegue. Un adaptador sin usuario es un adaptador cuyo primer error de verdad lo encuentra alguien que confiaba en él, y por eso cada uno se prueba contra un servidor que habla su protocolo en vez de contra un doble. Si alguno no encuentra usuario en un tiempo razonable, lo correcto es **retirarlo**, no dejarlo envejecer.
- **La imagen se construye y no se publica.** CI la construye y la arranca en cada PR, pero no hay registro donde dejarla, porque no hay ninguno. Cuando lo haya, es una decisión de distribución y no de diseño.
- **La sonda dice vivo, no listo.** Es deliberado y está razonado en §3.3; si algún día hace falta distinguirlas, lo publicable es un estado, nunca la dirección de nada.
- **Un puerto nuevo sigue exigiendo lo mismo que exigía**: variación real conocida y dos implementaciones nombradas. Que las siete fronteras hayan aguantado hasta cuatro implementaciones sin cambiar de contrato es un argumento para no abrir la octava a la ligera.
