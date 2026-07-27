# 0029 — `discovery` y `audience` los lee la cáscara del documento, no del modelo compilado

**Estado**: Vigente

## Contexto

El esquema del artefacto admite `discovery` y `audience` en un emisor `oidc` desde el primer día, y [`../../examples/policy.yaml`](../../examples/policy.yaml) los declara. Pero `CompiledIssuer` —el modelo que `policy` produce— no los lleva: tiene `id`, `kind`, `attributes`, `subject`, `secretRef` y `path`, y nada más.

Hasta S3 nadie lo notó, porque no había ningún adaptador OIDC que los necesitara. Ahora sí, y la asimetría salta a la vista: `upstreams[].transport` **sí** está compilado —`CompiledTransport`, que `gateway.ts` usa—, y esto no.

## Decisión

**La cáscara los lee del documento**, en `runtime/src/cli/main.ts`, y los pasa al compositor junto a lo que sí viene compilado. `LoadedPolicy.document.value` ya expone el artefacto como datos planos, y `runtime` ya lo exporta.

**`policy` no se toca.**

## Motivo

**Por qué no ampliar `CompiledIssuer`.** Sería lo natural, y por eso hay que decir por qué no. Cambiaría el retrato de superficie de `policy` —`verification/surface/policy.d.ts`—, y el criterio de terminación de S3 dice "sin tocar el núcleo ni `runtime`". Ese criterio no es ceremonia: existe para que al final de la sesión se pueda afirmar, con el diff delante, que los contratos aguantaron dos periferias sin retocarse. Ampliar el núcleo para acomodar al primer adaptador de identidad que llega es exactamente lo que el criterio quería impedir.

**Y hay un motivo que sobrevive al criterio.** [`../diseno/artefacto.md`](../diseno/artefacto.md) §1 divide el artefacto en dos mitades: la que gobierna decisiones y la que engancha con la periferia. De la segunda, la verificación en seco comprueba **solo integridad referencial** — es lo que la decisión [0017](0017-clave-estatica-en-el-artefacto.md) razonó para `subject` y `secret`. `discovery` y `audience` son de esa segunda mitad entera: no participan en ninguna decisión, no aparecen en ningún motivo, y ninguna pregunta de `who-can` los necesita. Meterlos en el modelo evaluable sería meter fontanería en el vocabulario del dominio.

**Por qué en la cáscara y no en `adapters/`.** Es la misma traducción que hace `wiring.ts` para el núcleo, en la otra dirección: la cáscara es el único sitio que conoce a la vez el vocabulario del artefacto y el de la periferia. Que `adapters/` conociera la forma del YAML de política le daría un conocimiento del artefacto que no le toca.

## Consecuencias

- Un emisor `oidc` sin `discovery` no autentica a nadie, y la pasarela lo dice al arrancar con la lista de los que sí sirven. Es el mismo comportamiento que un `static-key` sin `secret`, por el mismo motivo, y con el mismo mensaje.
- La lectura es tolerante: un documento sin `principals.issuers` o con entradas mal formadas no rompe nada, porque para entonces `policy` ya ha emitido sus diagnósticos sobre lo que sí gobierna.
- Queda la asimetría con `transport`, que sí está compilado. No se corrige aquí: `transport` participa en la ejecución a través de `ToolCall` y tiene sitio en el modelo; estos dos no. Si algún día `access` necesitara discriminar por audiencia —no se ve cómo—, esto es lo que habría que revisar.
- Si el enganche de periferia en el artefacto sigue creciendo, la respuesta no es ir ampliando `CompiledIssuer` campo a campo, sino que `policy` exponga la mitad de periferia como una sección aparte, declarada y validada referencialmente pero fuera del modelo evaluable. Ese es trabajo de S4 si aparece la tercera ocasión; con dos, todavía es coincidencia.

## Alternativas descartadas

- **Añadir `discovery` y `audience` a `CompiledIssuer`.** Lo natural, y cambia el retrato de `policy` para llevar dos campos que ninguna decisión mira.
- **Pedirlos por bandera de la CLI, `--oidc-discovery`.** No toca nada, y contradice la decisión 0017: el artefacto es donde vive el enganche con la periferia, y dejar que el emisor sea la excepción mientras el upstream y la cuenta declaran el suyo sería incoherente.
- **Que `adapters/` parsee el artefacto por su cuenta.** Duplica el trabajo de `policy` en la periferia y le da conocimiento del formato que no le corresponde.
