# 0001 — TypeScript sobre el SDK oficial de MCP

**Estado**: Vigente

## Contexto

La sección 6 de la arquitectura deja abiertos lenguaje y base MCP, señalando que condicionan "nombres y herramientas, no la estructura".

Es cierto para la estructura, pero no del todo para la verificación: los cuatro criterios que la sección 5 exige automáticos desde el principio dependen de qué puede comprobar el lenguaje elegido, y ahí las opciones no son equivalentes.

## Decisión

**TypeScript sobre el SDK oficial de MCP.**

## Motivo

MCP es un protocolo joven, y su SDK de TypeScript es la implementación de referencia: es donde las capacidades nuevas del protocolo aparecen primero y donde el comportamiento de los clientes reales está mejor rodado. Para un componente que se sitúa **entre** clientes y servidores MCP, y que por tanto habla los dos lados del protocolo, ir por detrás de la referencia se paga en incompatibilidades sutiles.

Sobre la verificación, que era la preocupación legítima: el campo `exports` de un paquete convierte el import profundo en un error de resolución de módulos, no en un aviso silenciable. Eso da fronteras entre contextos sostenidas por el gestor de módulos, no por convención ([`../diseno/verificacion.md`](../diseno/verificacion.md) §1). Es más débil que los `internal` del compilador de Go, pero cumple la exigencia de la sección 3 de que la declaración de frontera sea comprobable, y el resto del análisis estático cubre lo que falta.

## Consecuencias

- Las fronteras se apoyan en `exports` de workspace, análisis estático del grafo de imports y reglas de linter. Es más maquinaria que en un lenguaje con módulos privados nativos, y hay que montarla desde el primer commit — si llega tarde, llega después de la primera violación.
- La pureza del núcleo se prohíbe estáticamente (`node:*`, reloj, aleatoriedad) en lugar de ser imposible por construcción.
- A cambio: el ecosistema MCP más maduro, esquemas JSON compartidos con el propio protocolo, y tests de propiedad baratos sobre un núcleo que es una función.

## Alternativas descartadas

- **Go.** Sus `internal` dan fronteras verificadas por el compilador, que es literalmente el invariante más difícil de la sección 3, y el binario único encaja bien con un gateway. Se descarta porque su SDK de MCP va por detrás de la referencia, y estando el componente en medio del protocolo esa distancia se paga.
- **Rust.** La privacidad de módulos y el sistema de tipos permitirían codificar el fallo cerrado y la separación de identidades como estados imposibles de representar. Descartado por velocidad de iteración en una fase donde el diseño todavía se mueve.
- **Python.** El más débil frente a la sección 3: las fronteras solo serían comprobables con linters externos y convenciones, sin nada que impida el import profundo.
