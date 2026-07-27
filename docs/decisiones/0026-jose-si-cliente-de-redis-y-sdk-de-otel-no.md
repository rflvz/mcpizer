# 0026 — `jose` sí; cliente de Redis y SDK de OpenTelemetry, no

**Estado**: Vigente

## Contexto

S3 trae seis adaptadores que hablan con infraestructura de verdad. Un implementador instalaría por reflejo `jose`, `redis` y media docena de paquetes de `@opentelemetry/*`, y no sería un disparate: son las bibliotecas estándar de cada cosa.

`adapters/` tenía hasta ahora dos dependencias, `@modelcontextprotocol/sdk` y `yaml`.

## Decisión

**Una dependencia nueva: `jose`**, para verificar el JWT en `oidc-principal.ts`.

**Ninguna más.** Vault y OTLP van con `fetch`; Redis, con un cliente RESP mínimo sobre `node:net`; git, con el binario `git`; y MCP sobre HTTP con los transportes que el SDK ya trae.

## Motivo

**Por qué `jose` sí.** Verificar la firma de un JWT contra un JWKS es el único punto de este repositorio donde un error deja de ser un fallo y pasa a ser una **vulnerabilidad de autenticación**. No es que sea difícil; es que se equivoca en silencio: el `alg: none`, la confusión entre RSA y HMAC, comparar el `kid` sin comprobar el tipo de clave. Nada de eso da un test rojo — da un sistema que autentica a quien no debe. Es el sitio exacto donde una biblioteca auditada vale su coste.

**Por qué Redis no.** El adaptador emite seis comandos: `HINCRBY`, `HSETNX`, `HGET`, `HMGET`, `PEXPIRE` y `PING`. Lo que de verdad tiene que ser correcto no es el catálogo de comandos, es **el modo de fallo**: si el almacén no contesta, la promesa tiene que rechazar, porque uso desconocido se trata como techo agotado (invariante 3). Y un cliente completo trae precisamente lo contrario — reconexión automática, reintentos, colas que sobreviven a la desconexión—, que son las políticas que convertirían ese rechazo en una espera y luego en un cero. Habría que desactivarlas una a una y confiar en que ninguna versión nueva reintrodujera alguna. El protocolo RESP2 cabe en 150 líneas legibles.

**Por qué el SDK de OpenTelemetry no.** Lo que un colector entiende es **OTLP**, no la biblioteca con que se produjo. El adaptador emite el JSON que la especificación fija y lo envía a `/v1/logs`; media docena de paquetes para eso es superficie que este repositorio no controla, con su propio ciclo de vida de proveedores globales y procesadores. El nombre del puerto es la interoperabilidad, no el SDK. Y el fixture de verificación es un colector HTTP de veinte líneas justamente porque el protocolo es el contrato.

**Por qué Vault y git tampoco.** Vault es un `GET` con una cabecera y una envoltura JSON. Y para git ya hay una implementación instalada en cualquier máquina donde esto corra, mejor probada que cualquier biblioteca: el binario.

## Consecuencias

- `adapters/` pasa de dos dependencias a tres. Los cinco contextos siguen sin ninguna.
- El cliente RESP es código propio y hay que mantenerlo. A cambio, su modo de fallo es explícito y está probado contra un servidor RESP real en `verification/fixtures/redis/`, no contra un doble.
- El fixture de OIDC firma con `node:crypto`, **sin** `jose`. Deliberado: si firmara con la misma biblioteca que verifica, un error de uso se cancelaría contra sí mismo y el test pasaría sin demostrar nada.
- Si algún día hiciera falta RESP3, `CLIENT TRACKING`, *cluster* o *pipelining* de verdad, esto es lo que hay que revisar. La señal sería que el cliente empezara a tener estado que no es "la conexión y lo pendiente".

## Alternativas descartadas

- **`redis` o `ioredis`.** Bien probados y bien mantenidos. Traen reconexión y reintentos activados por defecto, que es exactamente lo que rompe el fallo cerrado del invariante 3, y habría que desactivarlos y vigilar que sigan desactivados.
- **`@opentelemetry/sdk-logs` + `exporter-logs-otlp-http` + `api`.** Interoperabilidad ya probada, a cambio de seis paquetes y un ciclo de vida global para producir un JSON fijo.
- **Verificar el JWT a mano con `node:crypto`.** Cero dependencias en el sitio donde un error es una vulnerabilidad. No.
- **`node-vault`.** Un envoltorio sobre un `GET`.
