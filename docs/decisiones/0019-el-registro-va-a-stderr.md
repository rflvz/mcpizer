# 0019 — El registro de decisiones va a stderr, porque stdout es el protocolo

**Estado**: Vigente

## Contexto

[`../diseno/puertos.md`](../diseno/puertos.md) §2.7 da como primera implementación de `DecisionRecorder` "JSON estructurado a stdout", y es la elección correcta para un contenedor: es donde cualquier recolector de logs mira.

Con transporte stdio, stdout es el canal por el que viajan los mensajes JSON-RPC del protocolo MCP.

## Decisión

**El registro va a stderr.**

## Motivo

Escribir la auditoría por stdout intercalaría objetos JSON que no son mensajes del protocolo en medio de la sesión, y el cliente se desincronizaría. No es una cuestión de gusto: es un fallo duro, y silencioso hasta que alguien mira por qué el cliente se cae.

"A stdout" en `puertos.md` significa **a la salida de diagnóstico del proceso**, que es lo que un contenedor recoge igual: Docker, Kubernetes y systemd capturan los dos descriptores. La intención del documento —que el mínimo para contenedores no exija montar nada— se cumple entera.

Vale la pena registrarlo porque es la clase de decisión que alguien tomaría al revés leyendo el documento al pie de la letra, y el fallo que produce no se parece a su causa.

## Consecuencias

- El mismo cuidado se aplica al otro lado. El `stderr` del proceso hijo que arranca `ToolInvoker` se descarta en vez de heredarse: es por donde un upstream descuidado devolvería su credencial a **nuestra** salida, y mezclarlo con la auditoría haría imposible saber quién escribió qué.
- Un `serve` que quiera separar auditoría de diagnóstico tendrá que hacerlo con un adaptador distinto. Cabe en S3 junto a OpenTelemetry y al fichero con rotación, y no obliga a cambiar el puerto.
- Los tests que comprueban la fuga de credenciales capturan `stderr` explícitamente. Si el registro se moviera, dejarían de mirar donde hay que mirar — así que el escáner afirma primero que encuentra rastro de la sesión, y solo después que no encuentra el centinela.

## Alternativas descartadas

- **Stdout, y el protocolo por otro sitio.** Invertiría el problema y rompería el transporte estándar de MCP, que es literalmente stdin/stdout.
- **Un fichero, siempre.** Obliga a montar volumen y a rotar en el caso más simple, que es justo lo que el "mínimo para contenedores" quería evitar.
- **Silenciar el registro cuando el transporte es stdio.** Que la auditoría desaparezca según el transporte es un fallo de seguridad disfrazado de detalle de configuración.
