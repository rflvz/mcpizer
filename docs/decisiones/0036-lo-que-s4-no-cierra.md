# 0036 — Lo que S4 no cierra, y por qué

**Estado**: **Sustituida en parte** por [0039](0039-el-generador-del-catalogo-declarado.md) y [0040](0040-se-escriben-las-implementaciones-previstas.md). Las dos deudas que esta decisión dejaba abiertas —el generador del catálogo declarado y las implementaciones de puerto previstas— están escritas. Sigue vigente lo que dice sobre la decisión [0029](0029-discovery-y-audience-salen-del-documento.md), que se revisó y no aplicaba.

Se conserva sin editar el cuerpo, porque saber qué se creyó y por qué dejó de creerse vale más que un fichero limpio. Lo que cambió no fue el razonamiento: fue que se pidió cerrar el producto entero, y eso es una decisión de producto que este registro no puede tomar por su cuenta.

## Contexto

[`../sesiones.md`](../sesiones.md) §3 obliga a dejar constancia **en el repositorio** de lo que queda pendiente y por qué, en vez de que viaje en la cabeza de nadie. S4 es la última sesión definida, así que esta es la última oportunidad de que ese registro exista.

Tres deudas apuntaban a S4 con nombre y apellidos. Una se cierra ([0033](0033-tls-fuera-cors-ninguno-techo-dentro.md)); las otras dos se revisan aquí y se dejan abiertas a propósito.

## Decisión

**El generador del catálogo declarado sigue sin escribirse.** Las decisiones [0021](0021-el-catalogo-declarado-basta-en-s2.md) y [0025](0025-el-descubrimiento-mcp-no-autentica.md) lo dan por pendiente, y sigue pendiente después de S4.

**El enganche de periferia dentro del artefacto no se reestructura.** La decisión [0029](0029-discovery-y-audience-salen-del-documento.md) condicionaba la revisión a que apareciera una tercera ocasión: se ha revisado y siguen siendo dos, `discovery` y `audience`. No aplica.

## Motivo

**Por qué el generador no entra.** El criterio de terminación de S4 no lo necesita, y el argumento de "ya es barato" no basta por sí solo: un comando que produce un fichero que hoy nadie produce automáticamente es superficie sin consumidor, que es lo que la sección 2.5 de la arquitectura llama abstracción anticipada. El sitio donde de verdad se echará de menos es un despliegue con muchos upstreams y catálogo versionado, y ese despliegue todavía no existe. Cuando exista, se sabrá si el comando debe emitir el catálogo entero, solo un upstream, o el diff contra el versionado — tres diseños distintos que hoy solo se pueden adivinar.

Lo que S4 sí hace es dejar el hueco descrito donde toca: [`../diseno/entrega.md`](../diseno/entrega.md) explica que el catálogo declarado es lo que permite arrancar sin red, y que hoy se escribe a mano.

**Por qué se revisa 0029 y se deja.** Porque la decisión lo pedía explícitamente y no hacerlo dejaría una condición de reapertura sin comprobar, que con el tiempo se lee como que sí se comprobó.

## Consecuencias

- Quien retome el generador tiene los tres diseños posibles enunciados arriba y la condición que decide entre ellos.
- `docs/sesiones.md` define cuatro sesiones y las cuatro han terminado. Lo que quede después no tiene sesión asignada, y esta decisión es el sitio donde mirar antes de inventar una quinta.
- Ninguna de las dos deudas bloquea nada: la pasarela arranca, decide y se despliega sin ellas.

## Alternativas descartadas

- **Escribir el generador "ya que es barato".** El coste de escribirlo no es el argumento; el de mantener un comando cuyo contrato se decidió sin caso de uso, sí.
- **Definir una sesión S5 con lo que queda.** [`../sesiones.md`](../sesiones.md) §1 fija cuatro sesiones, y lo que queda no llena una: son dos deudas pequeñas y bien acotadas. Inventar una sesión para ellas sería troceado por inercia.
- **No registrar nada, porque nada está bloqueado.** La regla de §3 no habla de bloqueos: habla de que lo pendiente esté escrito. Un repositorio que no dice qué dejó fuera obliga al siguiente a deducirlo.
