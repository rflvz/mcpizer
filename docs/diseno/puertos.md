# Puertos: contratos y justificación

Cierra el tercer guion de la sección 6 de [`../arquitectura.md`](../arquitectura.md), en lo relativo a puertos.

Prerrequisito de lectura: `../arquitectura.md`. Conviene, pero no es imprescindible, haber leído [`contextos.md`](contextos.md) — de ahí viene la afirmación de que los puertos viven en la frontera de composición y no dentro del dominio.

---

## 1. Dónde están los puertos

En la mayoría de proyectos hexagonales los puertos los declara el dominio y los llama el dominio. Aquí no, porque el núcleo es una función pura ([`contextos.md`](contextos.md) §1).

**Los puertos los declara `runtime/` — la capa de composición — y los implementa `adapters/`.** El núcleo no los conoce ni los invoca. Recibe los hechos que producen y devuelve una decisión que la cáscara ejecuta.

Esto no debilita el invariante 1, lo refuerza: el dominio no solo no importa infraestructura, es que no tiene ningún punto por el que pudiera hacerlo.

Los puertos se dividen por el momento en que actúan:

- **De entrada (reúnen hechos)**, antes de decidir: `PrincipalResolver`, `PolicySource`, `CatalogSource`, `UsageReader`.
- **De salida (ejecutan efectos)**, después de decidir: `CredentialResolver`, `ToolInvoker`, `UsageWriter`, `DecisionRecorder`.

Que un puerto sea de entrada o de salida no es decoración: los de entrada nunca se consultan después de decidir, y los de salida nunca influyen en la decisión. Si un adaptador de salida acabara alimentando la evaluación, el núcleo dejaría de ser puro.

---

## 2. Los puertos

Cada uno indica qué recibe, qué devuelve, qué debe garantizar y cómo falla. Se fija la **semántica**; nombres exactos y forma sintáctica son del agente implementador.

### 2.1 `PrincipalResolver` — de entrada

Convierte lo que trae el transporte en un principal del dominio.

- **Recibe**: las credenciales de transporte tal como llegan (cabecera, certificado, contexto de conexión).
- **Devuelve**: un principal — identificador y atributos — o un fallo de autenticación.
- **Garantiza**: no devuelve nunca un principal cuya credencial no haya validado. Un principal "anónimo" no es un valor válido de retorno; la ausencia de identidad es fallo, no un principal vacío. Esto es fallo cerrado en el borde exterior.
- **Falla**: credencial ausente, inválida, caducada o de un emisor no reconocido. Los cuatro casos se distinguen, porque acaban en motivos distintos.

**Implementaciones previstas (3)**: OIDC/JWT con validación por JWKS · subject de certificado en mTLS · clave de API estática declarada en el propio artefacto.

**Variación real**: cada despliegue trae su identidad. Un equipo con Okta y otro con mTLS entre servicios no van a converger, y el modo de desarrollo local necesita la clave estática. Esta es la frontera con variación más segura de todo el sistema.

### 2.2 `PolicySource` — de entrada

Entrega el artefacto declarativo sin interpretarlo.

- **Recibe**: nada, o un identificador de versión.
- **Devuelve**: el contenido en bruto del artefacto más una etiqueta de versión que permita saber si ha cambiado.
- **Garantiza**: no parsea, no valida, no interpreta. Eso es del contexto `policy`. El puerto solo consigue bytes. Si mezclara ambas cosas, cambiar de origen obligaría a reimplementar la validación.
- **Falla**: origen inalcanzable, o no hay artefacto. Ninguno de los dos produce una política vacía: producen arranque fallido. Una política vacía sería sintácticamente válida y lo denegaría todo, que es seguro pero indistinguible de un fallo de infraestructura — y esa ambigüedad es peor que parar.

**Implementaciones previstas (3)**: fichero local · repositorio git a una referencia fija · endpoint HTTP o ConfigMap.

**Variación real**: fichero en desarrollo y en la CLI de verificación; git cuando la política se revisa por PR, que es el modo esperado en cuanto hay más de una persona; ConfigMap en Kubernetes.

### 2.3 `CatalogSource` — de entrada

Descubre qué tools ofrecen los upstreams.

- **Recibe**: la identificación de un upstream declarado.
- **Devuelve**: los descriptores de sus tools — nombre, esquema de entrada, descripción.
- **Garantiza**: describe lo que hay, sin filtrar ni decidir. El filtrado por capacidades concedidas es de `capabilities` y `access`.
- **Falla**: upstream inalcanzable o respuesta ininteligible. Un upstream caído no puede degradarse a "sin tools": eso permitiría que una caída pasara silenciosamente por una revocación. Se propaga como fallo del upstream y se refleja como tal.

**Implementaciones previstas (3)**: servidor MCP por stdio · servidor MCP por HTTP streamable · catálogo estático declarado en el artefacto.

**Variación real**: los dos transportes son los del propio protocolo MCP, así que la variación existe desde el primer día. El catálogo estático no es un doble de test: es lo que hace posible el invariante 8, porque permite verificar una configuración entera sin levantar ningún upstream.

### 2.4 `UsageReader` / `UsageWriter` — de entrada y de salida

Uso acumulado frente a los límites declarados.

- **`UsageReader` recibe**: las claves de contador relevantes para la invocación. **Devuelve**: los valores acumulados, como hechos.
- **`UsageWriter` recibe**: el consumo a registrar tras ejecutar. **Devuelve**: confirmación.
- **Garantiza**: leer no muta. La decisión de si un límite se ha superado la toma `access` con los valores recibidos; el puerto no evalúa límites. Separar lectura y escritura no es ceremonia: la lectura ocurre antes de decidir y la escritura después, y colapsarlas invitaría a incrementar el contador durante la evaluación, contaminando el núcleo.
- **Falla**: si el almacén no responde, el uso es desconocido. **Uso desconocido se trata como límite agotado**, no como cero (invariante 3).

**Implementaciones previstas (2)**: memoria del proceso · Redis.

**Variación real**: memoria basta para un proceso único y para la verificación en seco; en cuanto hay más de una réplica los contadores tienen que ser compartidos o los límites dejan de significar nada. La segunda implementación no es hipotética, es la primera vez que se escale horizontalmente.

### 2.5 `CredentialResolver` — de salida

Canjea una referencia de cuenta por material utilizable. **Es la frontera que hace cierto el invariante 6.**

- **Recibe**: una referencia de cuenta opaca, ya autorizada por una decisión.
- **Devuelve**: material de credencial, o un fallo de resolución.
- **Garantiza**: se invoca **después** de decidir y **solo** con una referencia que una decisión permitió. Nunca antes, nunca especulativamente, nunca para varias cuentas "por si acaso". El material que devuelve no vuelve hacia el núcleo bajo ninguna forma, ni siquiera derivada: no entra en motivos, ni en registros, ni en mensajes de error.
- **Falla**: referencia desconocida, cuenta revocada, bóveda inalcanzable, credencial caducada. Todos abortan la ejecución. Ninguno degrada a ejecutar sin credencial.

**Implementaciones previstas (4)**: variables de entorno · HashiCorp Vault · gestor de secretos del proveedor cloud (AWS Secrets Manager y equivalentes) · almacén de tokens OAuth con refresco.

**Variación real**: entorno es el mínimo para desarrollo; cualquier despliegue serio usa bóveda o gestor gestionado; y el almacén OAuth es cualitativamente distinto — tiene ciclo de vida y refresco propios —, lo que confirma que la frontera absorbe variación de verdad y no solo cambios de origen.

### 2.6 `ToolInvoker` — de salida

Ejecuta la tool upstream con el material resuelto.

- **Recibe**: el descriptor de la tool, los argumentos y el material de credencial.
- **Devuelve**: el resultado del upstream, o un fallo de ejecución.
- **Garantiza**: no reinterpreta la decisión. Si llega aquí, está autorizado; este puerto no vuelve a comprobar la política, y tampoco la relaja. Es el único punto del sistema que ve a la vez credenciales y argumentos, y por eso es el único que necesita cuidado explícito con lo que registra.
- **Falla**: upstream caído, tiempo agotado, error del propio upstream. Los fallos del upstream se propagan al cliente distinguibles de las denegaciones de mcpizer: confundir "denegado por política" con "el proveedor está caído" haría inútil el bucle de corrección del invariante 4.

**Implementaciones previstas (2)**: cliente MCP por stdio · cliente MCP por HTTP streamable.

**Variación real**: los dos transportes del protocolo. Simétrico a `CatalogSource` y con la misma justificación.

### 2.7 `DecisionRecorder` — de salida

Registra la decisión y su motivo.

- **Recibe**: la decisión completa, con motivo, principal y referencia de cuenta.
- **Devuelve**: nada relevante para el flujo.
- **Garantiza**: registra tanto permisos como denegaciones. Registrar solo denegaciones dejaría sin rastro justo el caso que más importa auditar: quién usó qué cuenta. **Nunca recibe material de credencial** — recibe la referencia, que es opaca por diseño.
- **Falla**: un fallo al registrar no revierte una ejecución ya hecha, pero sí es visible. Que la auditoría falle en silencio es un fallo de seguridad.

**Implementaciones previstas (3)**: JSON estructurado a stdout · OpenTelemetry · fichero de auditoría con rotación.

**Variación real**: stdout es el mínimo para contenedores; OTel aparece en cuanto hay observabilidad centralizada; el fichero de auditoría con retención propia es un requisito de cumplimiento habitual y no se satisface con los otros dos.

---

## 3. Puertos que se declinan, y por qué

La sección 2.5 de la arquitectura dice que un puerto sin variación real es un coste, y el invariante 9 exige justificarlo. Declinar también hay que registrarlo, porque son las abstracciones que un implementador añadiría por reflejo.

### `Clock` — declinado

Rompería el invariante 2. Si el núcleo pide la hora, deja de ser determinista y probarlo exige un doble, que es exactamente lo que la sección 5 usa como señal de fallo.

**En su lugar**: el instante entra en la invocación como un hecho, capturado por la cáscara antes de decidir. Además de preservar la pureza, esto da algo valioso gratis — la verificación en seco puede evaluar la política *en cualquier instante*, incluido uno futuro, sin trucos.

### Fuente de aleatoriedad — declinada

Mismo motivo. El núcleo no genera identificadores ni muestrea. Si algo necesita un valor imprevisible, lo produce la cáscara y entra como dato.

### Repositorio genérico o unidad de trabajo — declinados

El núcleo no persiste. No hay estado de dominio que guardar: la política es entrada, y los contadores son hechos. Un repositorio sería indirección sin nada al otro lado — lo que 2.5 llama "indirección con nombre".

### `ToolNameResolver` u otra frontera para el mapeo tool→capacidad — declinada

Es tentador, porque suena a algo que podría venir de fuera. Pero el mapeo **es** el contexto `capabilities`, y sacarlo a un puerto significaría que la traducción que protege el invariante 7 vive fuera del núcleo y puede variar sin verificación. La única variación real es de dónde salen los descriptores, y eso ya lo cubre `CatalogSource`.

### Puerto de caché — declinado por ahora

Cachear catálogos o resoluciones de credencial es una preocupación de rendimiento que todavía no tiene forma conocida. Abrir la frontera ahora sería una abstracción anticipada basada en una sola aparición hipotética del patrón, que es lo que 2.5 prohíbe. Si aparece, cabe dentro de los adaptadores existentes sin nueva frontera; y si algún día no cabe, ese será el momento de abrirla — con la variación ya conocida.

---

## 4. Tabla resumen

| Puerto | Momento | Implementaciones previstas | ¿≥2? |
|---|---|---|---|
| `PrincipalResolver` | entrada | OIDC/JWT · mTLS · clave estática | 3 ✓ |
| `PolicySource` | entrada | fichero · git · HTTP/ConfigMap | 3 ✓ |
| `CatalogSource` | entrada | MCP stdio · MCP HTTP · catálogo estático | 3 ✓ |
| `UsageReader` / `UsageWriter` | entrada / salida | memoria · Redis | 2 ✓ |
| `CredentialResolver` | salida | entorno · Vault · gestor cloud · tokens OAuth | 4 ✓ |
| `ToolInvoker` | salida | MCP stdio · MCP HTTP | 2 ✓ |
| `DecisionRecorder` | salida | stdout JSON · OpenTelemetry · fichero auditado | 3 ✓ |

Declinados con motivo: `Clock`, aleatoriedad, repositorio genérico, unidad de trabajo, `ToolNameResolver`, caché.
