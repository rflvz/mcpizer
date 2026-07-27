# 0022 — El artefacto elige la periferia por elemento; el arranque elige la del proceso

**Estado**: Vigente

## Contexto

[`../sesiones.md`](../sesiones.md) §5 pide que cada puerto tenga "al menos dos implementaciones **intercambiables por configuración**". No dice qué configuración, y la respuesta no es obvia: hay dos sitios donde podría vivir, y el artefacto declarativo ya lleva parte de la respuesta sin que nadie lo hubiera planteado así.

Porque [`../../examples/policy.yaml`](../../examples/policy.yaml) ya declara, desde S2:

| Declaración | Qué puerto elige |
|---|---|
| `issuers[].kind: oidc \| static-key` | `PrincipalResolver` |
| `upstreams[].transport.kind: mcp-stdio \| mcp-http` | `CatalogSource` · `ToolInvoker` |
| `accounts[].secret.ref: vault:// \| env://` | `CredentialResolver` |

Y `envCredentials()` y `mcpStdioInvoker()` ya **rechazan** explícitamente lo que no es suyo, con un mensaje que nombra el esquema o el transporte que no saben hablar. Es decir: el sitio donde falta la segunda implementación estaba ya señalado en el código.

## Decisión

**Híbrido, y el corte no es arbitrario: separa los hechos de la política de los hechos del despliegue.**

**Cuatro puertos se eligen por elemento, desde el artefacto.** No se elige "una implementación de `ToolInvoker`": se elige una **por upstream**. La misma ejecución habla stdio con un upstream y HTTP con otro, y resuelve `env://` para una cuenta y `vault://` para la siguiente. Lo implementan despachadores en [`../../adapters/src/periphery.ts`](../../adapters/src/periphery.ts).

**Tres se eligen al arrancar, por banderas de `serve`**: `PolicySource` (`git+<url>#<ref>:<ruta>` o una ruta), `UsageReader`/`UsageWriter` (`--usage redis://…`) y `DecisionRecorder` (`--recorder otlp`). La bóveda, que hace falta para resolver `vault://`, llega por `VAULT_ADDR` y `VAULT_TOKEN`.

## Motivo

**Por qué esos tres no caben en el artefacto.** `PolicySource` es lo que **carga** el artefacto: declararlo dentro sería pedirle al fichero que dijera dónde está. Y dónde viven los contadores y adónde va la auditoría dependen de cuántas réplicas hay y de qué observabilidad tiene la empresa, no de quién puede emitir facturas. Meterlos en el artefacto obligaría a tener una política por entorno, y con ello a que la política que se revisa en el PR no fuera la que corre en producción — que es justo lo que el formato existe para evitar.

**Por qué los otros cuatro sí, y por elemento.** Son hechos **del** elemento, no del despliegue: que `facturacion` se alcance por HTTP es una propiedad de ese upstream en todos los entornos, y que la credencial de `crm-solo-lectura` viva en Vault es una propiedad de esa cuenta. Una bandera global sería además incorrecta: obligaría a que todos los upstreams hablaran el mismo transporte y todas las cuentas vivieran en el mismo sitio, cosa que ningún despliegue real cumple.

**Por qué no una bandera global además del artefacto.** Sería la peor opción: permitiría arrancar con un adaptador que contradice el YAML —resolver `env://` con Vault, hablar stdio con un upstream declarado `mcp-http`— y ese desacuerdo no lo detectaría nadie, porque `validate` solo comprueba el artefacto.

## Consecuencias

- Un puerto con despachador tiene que **rechazar lo que no es suyo**, y esos rechazos son ahora parte del contrato de cada adaptador, no un detalle defensivo. Ya lo eran; ahora se apoyan en ellos.
- `mcpizer validate` sigue sin necesitar infraestructura, y sigue comprobando de la periferia solo integridad referencial ([`../diseno/artefacto.md`](../diseno/artefacto.md) §1). Que una referencia sea `vault://` no obliga a que exista una bóveda para validarla en seco.
- Una referencia `vault://` sin `VAULT_ADDR` **aborta la ejecución diciendo qué falta**, en vez de degradar. Es fallo cerrado y ocurre en el sitio correcto: cuando una decisión ya autorizó esa cuenta.
- Añadir una tercera implementación a uno de los cuatro puertos declarados —mTLS, un gestor de secretos cloud— es una rama más en su despachador y un valor más en el esquema. No toca `runtime`.

## Alternativas descartadas

- **Todo por banderas y entorno.** Uniforme y explícito. Ignora lo que el artefacto ya declara, obliga a una implementación global por puerto y permite arrancar contradiciendo el YAML.
- **Un fichero de configuración aparte, `mcpizer.config.yaml`.** Separa del todo política de despliegue, y añade un segundo artefacto que nadie valida en seco y que duplica lo que el primero ya dice. Dos sitios que pueden discrepar.
- **Todo en el artefacto, incluida la conexión a Redis y el colector.** Una política por entorno, y con ella la garantía de que lo revisado es lo desplegado, perdida.
