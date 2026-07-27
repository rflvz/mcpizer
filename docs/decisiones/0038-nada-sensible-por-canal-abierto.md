# 0038 — Ni el artefacto ni el secreto de un cliente viajan por un canal que alguien pueda leer o reescribir

**Estado**: Vigente

## Contexto

Dos de las implementaciones nuevas traen una URL que alguien escribe en la configuración: el `PolicySource` sobre HTTP y las referencias `oauth+<url>`. En las dos, aceptar `http://` sin más sería lo cómodo, y en las dos el precio se paga en un sitio que no se ve.

## Decisión

**Los dos exigen `https://`**, con una única excepción: la interfaz de bucle, donde no hay camino que interceptar.

Un `http://` a cualquier otro sitio **no arranca**, y el mensaje dice por qué en vez de limitarse a decir que no.

## Motivo

**El artefacto es lo que decide quién puede hacer qué.** Traerlo por un canal que cualquiera en el camino puede reescribir no es un riesgo de confidencialidad: es entregarle la autorización a quien esté en medio. Un atacante que pueda modificar la respuesta se concede a sí mismo lo que quiera, y la pasarela lo aplicará sin que nada suene — porque el artefacto que recibió era sintácticamente correcto.

**Por el segundo canal viaja el secreto de un cliente OAuth.** Quien lo lea puede acuñar tokens en su nombre indefinidamente, y eso no aparece en ningún registro de este sistema porque ocurre fuera.

**Por qué un error y no un aviso.** Este repositorio ya tiene escrito que un criterio que solo avisa no es un criterio ([`../diseno/verificacion.md`](../diseno/verificacion.md) §4). Un aviso al arrancar lo lee quien está mirando la consola el primer día; el proceso que lleva ocho meses corriendo no lo lee nadie. Y el fallo cerrado del invariante 3 aplica igual aquí: ante una configuración que no se puede sostener, denegar.

**Por qué la interfaz de bucle sí.** Porque no hay camino: los bytes no salen de la máquina. Es la misma regla que usan los navegadores para los contextos seguros, y es lo que permite además que el arnés ejercite estos adaptadores sin montar una autoridad certificadora — sin la excepción, la alternativa habría sido no probarlos, que es peor.

## Consecuencias

- Un `ConfigMap` de Kubernetes se sigue montando como **fichero**, que es como se monta de verdad, y para eso ya está `policy-file`. La vía HTTP es para un servidor de configuración o un almacén de objetos, que hablan `https` de serie.
- La versión del artefacto traído por HTTP es la huella del contenido y no lo que declare el servidor. Un `ETag` que no cambia mientras el cuerpo sí lo hace convertiría un cambio de autorización en algo invisible; y confiar en una cabecera del mismo origen del que se desconfía no tendría sentido.
- Se pide sin caché, por lo mismo: una política vieja servida por un proxy intermedio es una decisión de autorización vieja.
- Los parámetros de una referencia `oauth+` se leen **sin** la convención de los formularios. `URLSearchParams` traduce `+` a espacio, y el valor de `secret` es otra referencia que puede llevarlo: decodificarlo como un formulario la parte en silencio, dejándola con aspecto de correcta.

## Alternativas descartadas

- **Aceptar `http://` con un aviso.** El aviso lo lee quien no lo necesita.
- **Aceptar `http://` con una bandera de opt-in.** Una bandera cuyo uso correcto es "nunca" es un agujero con documentación.
- **Confiar en `ETag` o `Last-Modified` como versión.** Vienen del mismo origen del que se desconfía, y un origen mal configurado los deja quietos mientras el cuerpo cambia.
- **Permitirlo dentro de una red privada declarada.** "Red privada" no es una propiedad comprobable desde aquí, y la mayoría de los movimientos laterales que importan ocurren precisamente dentro de una.
