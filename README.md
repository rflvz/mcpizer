# mcpizer

**Dado quién invoca y qué intenta hacer: qué tools ve, contra qué cuenta se ejecuta y bajo qué límites.**

Eso es todo el dominio. Un cliente MCP se conecta a mcpizer en lugar de conectarse a diez servidores upstream; mcpizer decide qué parte de ese catálogo existe para ese invocante concreto, con qué identidad de ejecución se atiende cada llamada y qué techos se le aplican.

Las dos identidades nunca son la misma cosa. **Quién invoca** es el principal: una persona, un agente, un servicio. **Con qué credencial se actúa** es la cuenta de ejecución. Que un agente pueda usar la cuenta de facturación de la empresa no lo convierte en la empresa, y el diseño no permite confundirlos en ningún punto.

## Estado

Fase de diseño. El enfoque arquitectónico está cerrado y el diseño detallado está escrito; no hay implementación todavía.

## Documentación

| Documento | Para qué |
|---|---|
| [`docs/arquitectura.md`](docs/arquitectura.md) | **Vinculante.** Estilo, invariantes y criterios de aceptación. Viaja completo a cualquier sesión de trabajo. |
| [`docs/diseno/`](docs/diseno/) | Diseño detallado: contextos, puertos, modelo, artefacto declarativo y verificación. |
| [`docs/decisiones/`](docs/decisiones/) | Registro de decisiones tomadas durante el diseño, con su motivo. |

Empieza por [`docs/diseno/README.md`](docs/diseno/README.md): dice qué documento necesita cada tipo de sesión, para no arrastrar contexto que no hace falta.

## Las cinco capacidades del dominio

- **principals** — quién invoca.
- **capabilities** — el vocabulario estable de lo que puede hacerse, y a qué tools reales corresponde.
- **accounts** — contra qué cuenta se ejecuta, siempre como referencia y nunca como credencial.
- **access** — la decisión.
- **policy** — el artefacto declarativo que la gobierna, y su verificación en seco.

## Base técnica

TypeScript sobre el SDK oficial de MCP. La elección condiciona nombres y herramientas de verificación, no la estructura — ver [`docs/decisiones/0001-lenguaje-y-base-mcp.md`](docs/decisiones/0001-lenguaje-y-base-mcp.md).
