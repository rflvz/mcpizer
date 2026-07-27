# 0025 — El descubrimiento MCP ocurre una vez al arrancar, y sin credencial

**Estado**: Vigente

## Contexto

La decisión [0021](0021-el-catalogo-declarado-basta-en-s2.md) dejó el descubrimiento MCP para S3 y nombró las preguntas que lo hacían trabajo de verdad y no un añadido de diez líneas: *cuándo se refresca el catálogo, qué pasa si un upstream está caído al arrancar, qué se sirve mientras tanto*.

Al implementarlo aparece una tercera que 0021 no vio: **`CatalogSource.toolsOf()` no recibe credencial**. Un upstream real puede exigir autenticación para `tools/list`, y el contrato no tiene por dónde pasársela.

## Decisión

**Se descubre una vez, al arrancar.** Que es cuando `loadPolicy` llama a `toolsOf()`. No hay refresco.

**Un upstream inalcanzable o que contesta algo ininteligible hace fallar el arranque.** Nunca devuelve lista vacía, ni parcial.

**El descubrimiento va sin autenticar.** El contrato del puerto no cambia. Un upstream que exija credencial para listar se queda con el catálogo declarado, que sigue siendo una implementación de pleno derecho.

## Motivo

**Cuándo.** Refrescar en caliente cambiaría el catálogo que un cliente ya vio sin que ninguna decisión lo hubiera autorizado. Una tool que desaparece sola es una revocación silenciosa por la puerta de atrás, y es el mismo fallo del que avisa [`../diseno/puertos.md`](../diseno/puertos.md) §2.3 en su otra forma. Que el catálogo cambie tiene que ser consecuencia de que la política cambie.

**Qué pasa si está caído.** Lo dice el diseño y no hay margen: "un upstream caído no puede degradarse a 'sin tools': eso permitiría que una caída pasara silenciosamente por una revocación". Por eso se descubre **en serie** y el primero que falle para el arranque: descubrir en paralelo y servir lo que respondiera sería servir un catálogo que nadie declaró.

**Por qué sin credencial, que es la parte incómoda.** Las tres salidas eran ampliar el puerto, ampliar el artefacto o vivir sin ella.

Ampliar `toolsOf()` para que lleve credencial toca `runtime/src/ports.ts`, que es lo que el criterio de S3 promete no hacer — y tocarlo aquí sería además prematuro, porque no se sabe todavía **qué** credencial: ¿una por upstream declarada en el artefacto? ¿la de una cuenta de servicio? ¿la del cliente que pregunta? Son tres diseños distintos con consecuencias distintas para el invariante 6.

Ampliar el artefacto con una credencial de descubrimiento por upstream toca `policy`, que es el núcleo, y cambia su retrato de superficie.

Vivir sin ella no bloquea a nadie: el catálogo declarado cubre exactamente ese caso, y `puertos.md` §2.3 insiste en que **no es un sustituto pobre** — es lo que hace posible el invariante 8. Un despliegue con upstreams autenticados versiona su catálogo junto a la política, que además es lo que le deja validar en seco.

Y hay una razón de fondo para no correr: si la credencial de descubrimiento acabara siendo la de una cuenta, estaría cruzando la frontera que `CredentialResolver` existe para custodiar —"solo con una referencia que una decisión permitió"— y el descubrimiento ocurre **antes** de que haya ninguna decisión. Eso merece su propia decisión, con el caso de uso delante.

## Consecuencias

- `mcpizer serve --discover` sirve para upstreams que listan sin autenticar. Los demás usan `--catalog`.
- Descubrir necesita saber qué upstreams hay, y eso solo lo dice la política compilada — que a su vez quiere el catálogo para comprobar el mapeo. El bucle se rompe compilando primero **sin** catálogo, en la cáscara: una lectura más del artefacto al arrancar, y ningún contrato se entera. Está en `runtime/src/cli/main.ts`, comentado.
- Queda pendiente, y anotado: la herramienta que genera el catálogo declarado desde los upstreams reales, que 0021 ya dejó pendiente. Con `--discover` funcionando, es un volcado de lo que este adaptador ya obtiene.
- La credencial de descubrimiento queda pendiente para cuando exista un upstream que la exija. Ese será el momento de saber cuál de los tres diseños es.

## Alternativas descartadas

- **Ampliar `CatalogSource.toolsOf()` con una credencial.** Toca `runtime`, y sin un caso de uso delante habría que adivinar cuál de las tres credenciales posibles es.
- **Declarar una credencial de descubrimiento por upstream en el artefacto.** Toca el núcleo y cambia el retrato de `policy`. Y arrastra la pregunta de si esa referencia pasa por `CredentialResolver` antes de que exista ninguna decisión.
- **Descubrir en paralelo y servir lo que responda.** Más rápido al arrancar, y convierte una caída parcial en una revocación silenciosa.
- **Refrescar el catálogo periódicamente.** El catálogo que ve un cliente cambiaría sin que la política hubiera cambiado.
