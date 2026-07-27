# 0015 — La pasarela se orquesta en `runtime/`; el protocolo MCP vive en `adapters/`

**Estado**: Vigente

## Contexto

[`../diseno/contextos.md`](../diseno/contextos.md) §4 sitúa el "transporte MCP" en `adapters/`. Pero ese mismo documento dice que `adapters/` **implementa los contratos de puerto que declara `runtime/`**, y un servidor de entrada no implementa ninguno: los consume. Es el mismo argumento por el que la decisión [0009](0009-donde-viven-la-cli-y-el-arnes.md) sacó la CLI de `adapters/`.

Con un servidor MCP la tensión es mayor que con la CLI, porque el servidor sí es protocolo —y el protocolo es periferia sin discusión—, pero lo que hace con cada petición es orquestar los cinco contextos, que es composición.

## Decisión

**Se parte por donde la tensión desaparece.**

`adapters/` expone `mcpStdioServer(info, handlers)`, que envuelve el SDK y no sabe nada más: recibe dos callbacks, `listTools` y `callTool`, y los cablea a las peticiones del protocolo. `runtime/` los implementa en `gateway.ts`.

El SDK de MCP es dependencia de `adapters/` y de ningún otro paquete.

## Motivo

El corte por callbacks deja cada mitad hablando de una sola cosa. El adaptador conoce `tools/list`, `tools/call` y el transporte, y no conoce política, contextos ni decisiones. La composición conoce los cinco contextos y no sabe qué protocolo hay debajo — de hecho no hay una sola línea de `gateway.ts` que cambiaría si el transporte fuera HTTP.

Esa última propiedad es la que lo hace valer la pena: S3 añade MCP sobre HTTP en los dos lados, y con este corte es un fichero nuevo en `adapters/` y una bandera en la CLI, sin tocar la orquestación. Si el servidor viviera en `runtime/`, el protocolo se habría filtrado a la capa que S3 no debería tener que abrir.

Y no hay octavo paquete. `verification/checks/declared-surface.test.ts` afirma exactamente siete, y la decisión [0009](0009-donde-viven-la-cli-y-el-arnes.md) ya explicó por qué añadir uno para esto sería una frontera que no separa nada.

## Consecuencias

- `adapters/` gana su primera dependencia externa de peso. Sigue sin importar ningún contexto, y la regla transitiva lo comprueba.
- El servidor es el único fichero de `adapters/` que no implementa un puerto. Se dice en el encabezado de `adapters/src/index.ts`, porque un lector que buscara su puerto no lo encontraría.
- `serve` es un comando más de la CLI existente, no un segundo binario. Cablea los ocho puertos, y es —como `load()` para la verificación en seco— el único sitio donde se comprueba que los adaptadores cumplen sus contratos.

## Alternativas descartadas

- **El servidor entero en `runtime/`.** Menos indirección, y mete el SDK en la capa de composición. La orquestación pasaría a conocer el protocolo, que es justo lo que S3 tiene que poder cambiar sin tocarla.
- **El servidor entero en `adapters/`, decidiendo por su cuenta.** Exigiría que `adapters/` importara los cinco contextos, que es la arista que `adapters-must-not-import-contexts` prohíbe — y con razón: sería un segundo sitio donde los contextos se ven a la vez.
- **Un paquete `gateway/`.** Contradice el recuento de siete paquetes y repartiría la composición entre dos sitios.
