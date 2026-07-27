# 0023 — El ciclo de vida de la periferia vive en un compositor de `adapters/`, no en los puertos

**Estado**: Vigente

## Contexto

Cinco de los siete puertos no declaran ciclo de vida, y en S2 no hacía falta: leer un fichero, comparar una clave, contar en un `Map` y escribir a stderr no abren nada que haya que cerrar. Solo `ToolInvoker` tiene `close()`, porque arranca procesos hijos.

Las segundas implementaciones rompen esa comodidad. Redis abre un socket. El exportador OTLP acumula un lote y lo envía por red — y `DecisionRecorder.record` devuelve **`void`** y es **síncrono**, así que no hay dónde esperar a que salga ni dónde vaciarlo antes de que el proceso muera. El descubrimiento MCP abre sesiones con los upstreams.

Es exactamente lo que [`../sesiones.md`](../sesiones.md) §5 anuncia: "si un contrato de puerto estaba mal planteado, aquí se rompe — y romperse aquí es el resultado bueno".

## Decisión

**Los puertos no cambian.** `DecisionRecorder` no gana `close()`, `UsageReader` tampoco, y `CatalogSource` tampoco.

**El ciclo de vida lo recoge un compositor**, `periphery()` en [`../../adapters/src/periphery.ts`](../../adapters/src/periphery.ts), que devuelve los puertos y **un solo `close()`** que cierra lo que haya que cerrar. Los adaptadores que necesitan cerrarse exponen `close()` **fuera** del contrato; los que no, no fingen tenerlo.

## Motivo

**Por qué no ampliar el puerto.** El criterio de terminación de S3 dice "sin tocar el núcleo ni `runtime`", y `ports.ts` es `runtime`. Pero el motivo de fondo es mejor que la obediencia: un `close()` en `DecisionRecorder` obligaría a las **dos** implementaciones a tenerlo, y la de stderr no cierra nada. Un método que la mitad de las implementaciones deja vacío es una abstracción que no describe a sus implementaciones — lo que la sección 2.5 de la arquitectura llama indirección con nombre.

**Y hay un motivo más fuerte, de dirección.** El ciclo de vida no es una preocupación del **puerto**, que es un contrato sobre qué hechos se reúnen y qué efectos se ejecutan. Es una preocupación de **quién construyó los adaptadores**, que es el único que sabe cuáles abrió. Ponerlo en el contrato repartiría entre siete interfaces una responsabilidad que tiene un solo dueño.

**Por qué en `adapters/` y no en la CLI.** `adapters/` no puede importar `runtime/` —sería un ciclo—, así que el compositor devuelve un objeto estructural y la CLI lo asigna a `GatewayPorts` con `satisfies`. Eso mantiene la comprobación de conformidad donde S2 la puso y deja el delta de la cáscara en una llamada.

**Que el vaciado del búfer OTLP dependa de que alguien llame a `close()`** es una obligación real, y es del compositor. `mcpizer serve` lo hace cuando el cliente se va. Un proceso que muere de un `SIGKILL` pierde el último lote, y eso es cierto de cualquier exportador por lotes, incluido el SDK oficial.

## Consecuencias

- `periphery()` es hoy el único constructor de periferia completa. Quien monte los puertos a mano —los fixtures de violación lo hacen— se encarga de cerrarlos, y por eso usan adaptadores que no abren nada.
- El orden de cierre importa y está fijado: primero el invocador, después el almacén, y **la auditoría la última**, para que lo que ocurra mientras se cierra también quede registrado.
- `CatalogSource` es la excepción de forma: se construye antes que el resto —hace falta para compilar— así que se cierra aparte, en la CLI, junto al compositor.
- Si algún día un tercer adaptador necesitara algo más que `close()` —salud, reconexión, reintento—, esto es lo que hay que revisar. La señal sería que el compositor empezara a tener lógica en vez de cableado.

## Alternativas descartadas

- **Añadir `close(): Promise<void>` a los puertos que lo necesitan.** Cambia `ports.ts`, contradice el criterio de S3, y obliga a implementaciones que no abren nada a declarar un método vacío.
- **Un puerto `Lifecycle` aparte que los adaptadores implementen opcionalmente.** Una frontera nueva para una preocupación que no tiene variación: todos los que la necesitan hacen lo mismo. Es la abstracción anticipada que [`../diseno/puertos.md`](../diseno/puertos.md) §3 declina en otros cuatro casos.
- **Vaciar el búfer de OTLP en cada `record`.** Convierte una llamada síncrona en una petición HTTP por decisión. Ni es OTLP ni aguanta.
- **No cerrar nada y confiar en que el proceso muera.** Pierde el último lote de auditoría siempre, no solo ante un `SIGKILL`. Que la auditoría falle en silencio es un fallo de seguridad.
