# 0027 — Con HTTP la credencial del cliente llega por cabecera y **por petición**

**Estado**: Vigente

## Contexto

En S2 el servidor MCP hablaba stdio, y `GatewayHandlers` —el tipo que la pasarela le pasa al adaptador de entrada— no llevaba credencial: la cáscara cerraba sobre una función que leía `process.env` en cada petición. Funcionaba porque con stdio **el cliente arranca el proceso**, así que hay un proceso por cliente y la identidad es del proceso.

Con HTTP hay un proceso para todos. Dos clientes con identidades distintas llegan por el mismo puerto, y su credencial viene en la cabecera de **su** petición.

## Decisión

**`GatewayHandlers` recibe la credencial como argumento**, en las dos operaciones:

```
listTools(credentials)
callTool(credentials, name, args)
```

El servidor de stdio se construye con un proveedor que se evalúa en cada petición y lee el entorno; el de HTTP la extrae de la cabecera de la petición que está atendiendo. Y cada petición HTTP se atiende con su **propio** servidor MCP, sin sesión.

`runtime/src/ports.ts` no cambia: `Gateway.list` y `Gateway.call` ya recibían las credenciales por llamada desde S2.

## Motivo

**Por qué no vale una clausura.** Un servidor HTTP que cerrara sobre una credencial fija atendería a todo el mundo con la identidad de quien la fijó al arrancar. Eso no es un problema de fontanería: es un fallo de autorización, del tipo que no da error y sirve datos de más. La forma del tipo tiene que hacerlo imposible, y un argumento lo hace: no hay dónde guardar una identidad entre peticiones.

**Por qué un servidor MCP por petición.** Es el modo que el SDK llama *stateless*, y refuerza lo mismo por otra vía: sin estado compartido entre peticiones, la identidad de una no puede filtrarse a la siguiente ni por descuido.

**Por qué esto no rompe la promesa de S3.** `GatewayHandlers` es un tipo de `adapters/`, no un puerto. La prueba está en el retrato: `verification/surface/runtime.d.ts` no lo menciona, y no ha cambiado. El contrato que sí importa —`Gateway`— ya estaba bien planteado desde S2, y esa es la comprobación que S3 existía para hacer: los dos transportes caben en él sin tocarlo.

**Que la ausencia de cabecera se traduzca a cadena vacía** y no a un 401 del transporte es coherente con el invariante 3. Quien decide qué significa "sin credencial" es `PrincipalResolver`, y contestar antes convertiría una denegación explicable —con su código y su sitio en el artefacto— en un 401 mudo.

## Consecuencias

- `mcp-stdio-server.ts` y `mcp-http-server.ts` comparten todo menos el transporte: los dos manejadores viven en `mcp-server.ts`. Que el segundo no tuviera que reimplementar el primero es la señal de que el corte de la decisión [0015](0015-donde-vive-la-pasarela.md) estaba bien puesto.
- `runtime/src/cli/main.ts` pasa de una clausura a un objeto de manejadores que sirve a los dos servidores. Es la única forma en que este cambio llega a `runtime`, y es la cáscara.
- La cabecera es configurable con `--key-header`; por defecto `Authorization`, y se le quita el prefijo `Bearer `.
- Con `--http` el proceso no termina cuando un cliente se va: los clientes van y vienen. Termina cuando se le manda terminar.
- Falta el otro lado de una pasarela HTTP seria: TLS, CORS y límites de tamaño de petición. Es empaquetado y operación, que es S4.

## Alternativas descartadas

- **Mantener `GatewayHandlers` sin credencial y llevarla por `AsyncLocalStorage`.** No toca ningún tipo y hace invisible en la firma la cosa que más importa que se vea. Un estado implícito por petición es el sitio donde se escriben los fallos de autorización difíciles de encontrar.
- **Un servidor MCP compartido entre peticiones, en modo con sesión.** Ata la identidad a la sesión MCP y no a la petición, y obliga a decidir qué pasa cuando dos credenciales distintas reusan una sesión.
- **Contestar 401 en el transporte cuando falta la cabecera.** Se pierde el motivo y el sitio del artefacto: el bucle de corrección del invariante 4 deja de funcionar justo en el borde exterior.
