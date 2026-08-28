# Registro de decisiones

El corolario de la sección 1 de [`../arquitectura.md`](../arquitectura.md) dice que, ante una pregunta cuya respuesta no está en la arquitectura, la respuesta por defecto no es preguntar sino **decidir y dejar constancia**. Esto es la constancia.

Solo se escala lo que contradiga una decisión cerrada o un invariante. Nada de lo registrado aquí lo hace.

## Qué entra

Una decisión merece registro si se cumple alguna de estas condiciones:

- La arquitectura la dejó abierta y había más de una opción defendible.
- Alguien razonable la tomaría al revés.
- Se rechazó una alternativa que un implementador propondría por reflejo.

No entran las decisiones que solo tienen una respuesta sensata, ni las que el código explica mejor que un documento.

## Formato

Contexto, decisión, motivo, consecuencias y alternativas descartadas. Breve. Un registro que nadie relee no sirve de nada.

Las decisiones no se borran ni se editan cuando cambian: se registra una nueva que sustituya a la anterior, y se marca la vieja como sustituida. Saber qué se creyó y por qué dejó de creerse vale más que un fichero limpio.

## Índice

| # | Decisión | Estado |
|---|---|---|
| [0001](0001-lenguaje-y-base-mcp.md) | TypeScript sobre el SDK oficial de MCP | Vigente |
| [0002](0002-nucleo-funcional-cascara-imperativa.md) | El núcleo no llama a puertos: es una función | Vigente |
| [0003](0003-cinco-contextos-delimitados.md) | Cinco contextos delimitados | Vigente |
| [0004](0004-sin-dependencias-entre-contextos.md) | Ningún contexto importa a otro | Vigente |
| [0005](0005-politica-solo-aditiva.md) | La política solo concede; no hay denegaciones | Vigente |
| [0006](0006-nomenclatura-y-troceado-documental.md) | Nomenclatura en inglés y diseño en varios documentos | Vigente |
| [0007](0007-fase-de-sesiones.md) | Fase de sesiones: cuatro sesiones grandes, hito en la CLI | Vigente |
| [0008](0008-workspace-esm-y-build.md) | Workspace de pnpm, ESM y `exports` apuntando a lo compilado | Vigente |
| [0009](0009-donde-viven-la-cli-y-el-arnes.md) | La CLI vive en `runtime/`; el arnés, en `verification/` | Vigente |
| [0010](0010-dos-puertos-en-s1.md) | S1 declara dos puertos, no siete | Vigente |
| [0011](0011-semantica-del-selector.md) | El selector es una conjunción de igualdades sobre atributos de un solo valor | Vigente |
| [0012](0012-path-como-puntero-resoluble.md) | `path` es un puntero RFC 6901 resoluble a línea y columna | Vigente |
| [0013](0013-combinacion-de-techos.md) | El techo más restrictivo se compara por ritmo | Vigente |
| [0014](0014-uso-por-defecto-en-seco.md) | En seco, el uso por defecto es cero, y el listado no lo consulta | Vigente |
| [0015](0015-donde-vive-la-pasarela.md) | La pasarela se orquesta en `runtime/`; el protocolo MCP vive en `adapters/` | Vigente |
| [0016](0016-nombre-expuesto-de-una-tool.md) | El nombre expuesto de una tool es `upstream__tool`, siempre | Vigente |
| [0017](0017-clave-estatica-en-el-artefacto.md) | El emisor `static-key` declara sujeto y referencia a la clave | Vigente |
| [0018](0018-fallos-que-access-no-ve.md) | Los fallos que `access` no ve envuelven la decisión; no amplían `ReasonCode` | Vigente |
| [0019](0019-el-registro-va-a-stderr.md) | El registro de decisiones va a stderr, porque stdout es el protocolo | Vigente |
| [0020](0020-una-sesion-por-upstream-y-cuenta.md) | Una sesión de upstream por `(upstream, cuenta)` | Vigente |
| [0021](0021-el-catalogo-declarado-basta-en-s2.md) | S2 no añade descubrimiento MCP al `CatalogSource` | Vigente |
| [0022](0022-donde-se-elige-la-implementacion-de-cada-puerto.md) | El artefacto elige la periferia por elemento; el arranque elige la del proceso | Vigente |
| [0023](0023-el-ciclo-de-vida-vive-en-el-compositor.md) | El ciclo de vida de la periferia vive en un compositor, no en los puertos | Vigente |
| [0024](0024-claims-multivaluados.md) | Un claim multivaluado no produce atributo | Vigente |
| [0025](0025-el-descubrimiento-mcp-no-autentica.md) | El descubrimiento MCP ocurre una vez al arrancar, y sin credencial | Vigente |
| [0026](0026-jose-si-cliente-de-redis-y-sdk-de-otel-no.md) | `jose` sí; cliente de Redis y SDK de OpenTelemetry, no | Vigente |
| [0027](0027-la-credencial-del-cliente-llega-por-peticion.md) | Con HTTP la credencial del cliente llega por cabecera y por petición | Vigente |
| [0028](0028-policy-source-sobre-git.md) | `PolicySource` sobre git: la versión es el sha, y se lee sin copia de trabajo | Vigente |
| [0029](0029-discovery-y-audience-salen-del-documento.md) | `discovery` y `audience` los lee la cáscara del documento | Vigente |
| [0030](0030-el-artefacto-desplegable-es-el-cierre-de-runtime.md) | El artefacto desplegable es `runtime` con su cierre, producido por `pnpm deploy` | Vigente |
| [0031](0031-el-empaquetado-vive-en-deployment.md) | El empaquetado vive en `deployment/`, un directorio sin manifiesto | Vigente |
| [0032](0032-la-imagen-es-una-envoltura.md) | La imagen es una envoltura, y el criterio de terminación no la necesita | Vigente |
| [0033](0033-tls-fuera-cors-ninguno-techo-dentro.md) | TLS fuera, CORS ninguno, techo de petición dentro | Vigente |
| [0034](0034-la-parada-ordenada-la-conecta-la-cascara.md) | La parada ordenada la conecta la cáscara; sin puerto de señales, salud ni configuración | Vigente |
| [0035](0035-una-version-para-el-producto.md) | Una versión para el producto; los siete paquetes siguen privados | Sustituida en parte por 0041 |
| [0036](0036-lo-que-s4-no-cierra.md) | Lo que S4 no cierra, y por qué | Sustituida en parte por 0039 y 0040 |
| [0037](0037-la-identidad-de-certificado-la-verifica-el-terminador.md) | La identidad de certificado la verifica el terminador TLS, y llega por cabecera | Vigente |
| [0038](0038-nada-sensible-por-canal-abierto.md) | Ni el artefacto ni el secreto de un cliente viajan por canal abierto | Vigente |
| [0039](0039-el-generador-del-catalogo-declarado.md) | El generador del catálogo declarado, y por qué aborta en vez de completar | Vigente |
| [0040](0040-se-escriben-las-implementaciones-previstas.md) | Se escriben las cinco implementaciones previstas que faltaban | Vigente |
| [0041](0041-se-publican-los-siete-y-el-producto-se-llama-mcpizer.md) | Se publican los siete, con una sola versión, y el que trae la CLI se llama `mcpizer` | Vigente |
| [0042](0042-la-licencia-la-elige-el-dueno.md) | Publicar exige una licencia, y elegirla no es una decisión de diseño | Cerrada por 0044 |
| [0043](0043-lo-instalado-se-comprueba-con-el-npm-real.md) | Lo publicado se comprueba instalándolo con el `npm` real | Vigente |
| [0044](0044-la-licencia-es-mit.md) | La licencia es MIT, y el aviso viaja dentro de cada paquete | Vigente |
