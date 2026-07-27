# 0033 — TLS lo termina el despliegue, no se emite ninguna cabecera CORS, y el techo de petición sí es del proceso

**Estado**: Vigente. Cierra la deuda que dejó anotada la decisión [0027](0027-la-credencial-del-cliente-llega-por-peticion.md).

## Contexto

La decisión [0027](0027-la-credencial-del-cliente-llega-por-peticion.md) termina diciendo: *"Falta el otro lado de una pasarela HTTP seria: TLS, CORS y límites de tamaño de petición. Es empaquetado y operación, que es S4."* Son tres cosas distintas con tres respuestas distintas, y agruparlas fue una comodidad de redacción.

## Decisión

**TLS lo termina el despliegue.** El proceso habla HTTP en claro y escucha por defecto en la interfaz de bucle. Abrirlo a la red exige decirlo (`--host`).

**No se emite ninguna cabecera CORS.** Ni permisiva ni configurable.

**El techo de tamaño de petición sí lo pone el proceso**: `--max-body`, un mebibyte por defecto, comprobado antes de tocar el cuerpo.

## Motivo

**TLS fuera.** El ciclo de vida de un certificado —emisión, renovación, rotación, la cadena que se confía— es un hecho del despliegue, no de la política, y por tanto cae del lado que la decisión [0022](0022-donde-se-elige-la-implementacion-de-cada-puerto.md) ya separó. Terminarlo en el proceso obligaría a montarle un almacén de certificados y a recargarlos en caliente: superficie nueva, sensible, y que toda plataforma ya resuelve. La contrapartida honesta es que un puerto en claro expuesto a la red es un error, y por eso el defecto es la interfaz de bucle: exponerlo tiene que ser una decisión escrita.

Con un matiz que la decisión [0027](0027-la-credencial-del-cliente-llega-por-peticion.md) fija y que esto no puede aflojar: **TLS sí, autorización en el borde no**. Un proxy que rechace por su cuenta convierte una denegación explicable —con su código y su sitio en el artefacto— en un 401 mudo, y rompe el bucle de corrección del invariante 4.

**CORS ninguno.** Un cliente MCP no es una página web: no hay origen que permitir. Emitir `Access-Control-Allow-Origin` no habilitaría un caso de uso previsto, habilitaría que **cualquier página que visite el navegador de alguien** hable con la pasarela que ese alguien tiene escuchando en su portátil. La ausencia de la cabecera es lo que hace que el navegador no deje leer la respuesta, y eso es fallo cerrado por omisión, que es como el invariante 3 quiere que sean los defectos. Si algún día hubiera un cliente web legítimo, será el momento de decidir con el caso delante, y no antes.

**El techo dentro.** Es el único de los tres que no puede delegarse sin perder la propiedad. Sin techo, cualquiera que alcance el puerto agota la memoria del proceso **antes de que nadie haya decidido si tiene permiso para algo**: la denegación llega después de haber leído lo que se envió. Un borde exterior puede añadir el suyo, pero el proceso no puede depender de que exista.

**Por qué se exige `Content-Length` en vez de contar lo que llega.** Contar obligaría a consumir el flujo que el transporte necesita íntegro, y un contador que interfiere con la lectura es peor que no tener techo. La contrapartida es que un cuerpo troceado sin longitud se rechaza con 411; ningún cliente MCP los manda, y aceptarlos dejaría abierta justo la vía que este techo cierra.

## Consecuencias

- `--max-body` es un parámetro de operación, no de política: depende de qué tools se atienden. Su valor por defecto acota un mensaje JSON-RPC, no una subida de fichero.
- El rechazo por tamaño ocurre en el transporte y **no produce decisión ni registro de auditoría**: no hubo principal, no hubo capacidad y no hubo nada que decidir. Es coherente con que `DecisionRecorder` registre decisiones, no tráfico.
- La imagen documenta `--host 0.0.0.0` como obligatorio dentro del contenedor, precisamente porque el defecto no lo es.
- Queda fuera la protección contra *DNS rebinding* por validación de `Origin`, que el SDK ofrece y marca como obsoleta. Con el defecto en la interfaz de bucle y sin credencial válida no hay nada que obtener, así que no se activa; si algún despliegue expone el puerto sin borde delante, esa es la decisión a revisar.

## Alternativas descartadas

- **TLS en el proceso, con `--tls-cert` y `--tls-key`.** Superficie sensible que duplica lo que toda plataforma ya hace, y que además hay que recargar en caliente para que sirva de algo.
- **CORS configurable con `--allow-origin`.** Una bandera cuyo uso correcto es "nunca" y cuyo uso incorrecto es un agujero. Si no hay caso, no hay bandera.
- **Techo delegado al borde exterior.** Hace que la protección exista solo en los despliegues que la configuran, y desaparezca justo en el más expuesto: el que arranca el proceso a mano.
- **Contar bytes según llegan, interceptando el flujo.** Interfiere con la lectura del transporte. Un techo que corrompe peticiones legítimas no es un techo.
