# 0010 — S1 declara dos puertos, no siete

**Estado**: Vigente

## Contexto

[`../diseno/puertos.md`](../diseno/puertos.md) describe siete puertos, y [`../sesiones.md`](../sesiones.md) §5 asigna a S2 "`runtime` con los siete puertos declarados". Pero la CLI de verificación en seco, que es de S1, necesita leer dos cosas de disco: el artefacto y el catálogo declarado.

O S1 declara esos dos puertos, o los lee por su cuenta y deja `adapters/` como un paquete vacío.

## Decisión

**S1 declara `PolicySource` y `CatalogSource` en `runtime/` y los implementa en `adapters/` sobre fichero local y catálogo declarado.** Los otros cinco quedan para S2.

## Motivo

Los dos están ya justificados para este caso de uso concreto en el propio documento de puertos. La variación real de `PolicySource` cita literalmente "fichero en desarrollo y **en la CLI de verificación**" (§2.2), y del catálogo estático dice que "no es un doble de test: es lo que hace posible el invariante 8, porque permite verificar una configuración entera sin levantar ningún upstream" (§2.3).

Los dos tienen tres implementaciones previstas y documentadas, así que el invariante 9 se respeta sin forzar nada: no se abre una frontera para este hito, se implementa la primera de una frontera que ya estaba justificada.

Y da a `adapters/` contenido honesto desde el primer commit. Un paquete declarado y vacío durante toda una sesión es una promesa, no una estructura: nadie sabe si el contrato aguanta hasta que algo lo implementa.

Declarar los siete ahora sería lo contrario: fijar contratos —resolución de credenciales, invocación de tools, contadores de uso— sin nada que los ejercite, que es exactamente la abstracción anticipada que la sección 2.5 de la arquitectura prohíbe. S2 los diseñará con la pasarela delante, que es cuando se sabe si están bien planteados.

## Consecuencias

- **`adapters/` no importa `runtime/`, y por tanto no importa los contratos que implementa.** Sería un ciclo entre paquetes, y las referencias de proyecto de TypeScript no lo admiten. La conformidad se comprueba donde se cablea: en `runtime/`, al asignar el adaptador a una variable del tipo del puerto. El tipado estructural hace que eso sea una comprobación real, no un gesto.
- S2 hereda dos puertos ya escritos. Si al abrir los otros cinco alguno de estos dos resulta mal planteado, es el momento de cambiarlo — y romperse ahí es el resultado bueno.
- `PolicySource` entrega bytes y no parsea, según su contrato. `CatalogSource` sí devuelve descriptores, así que el adaptador del catálogo declarado interpreta su propio fichero: es el trabajo de un adaptador, y mantiene el parseo del *artefacto* dentro de `policy`.

## Alternativas descartadas

- **Ningún puerto; la CLI lee el fichero con `node:fs`.** Menos maquinaria y respeta al pie de la letra el reparto de [`../sesiones.md`](../sesiones.md) §5. Descartada porque deja `adapters/` vacío y porque, cuando S2 introdujera `PolicySource`, habría que reescribir la CLI para usarlo — trabajo que esta decisión ahorra sin adelantar ningún diseño.
- **Los siete puertos declarados en S1.** Cierra el diseño antes, pero fija contratos sin implementación que los pruebe e invade el alcance explícito de S2.
