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
