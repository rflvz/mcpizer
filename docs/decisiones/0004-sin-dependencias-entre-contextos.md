# 0004 — Ningún contexto importa a otro

**Estado**: Vigente

## Contexto

La sección 3 de la arquitectura exige que "ningún contexto alcance el interior de otro" y que la comunicación pase siempre por la superficie declarada. Y trata el blast radius como criterio de aceptación: un cambio interno no debe propagar cambios fuera.

La lectura literal permite que un contexto importe la **superficie pública** de otro. Cumple la letra. El problema es lo que pasa después: en cuanto `access` importa el `Principal` de `principals`, ese tipo deja de pertenecer a un contexto y se convierte de facto en el modelo compartido de todos. Es el fallo que la propia sección 3 describe al prohibir "forzar un modelo único compartido", solo que llega por acumulación en vez de por decisión.

## Decisión

**Ningún contexto importa a otro contexto. Se encuentran únicamente en la capa de composición.**

Corolario explícito: **no se crea ningún paquete `shared`, `common`, `core`, `kernel` ni `types`.**

## Motivo

- **Blast radius cero por construcción**, no por disciplina. Un cambio interno no puede propagarse porque no hay arista por la que hacerlo. El criterio de la sección 5 pasa de ser algo que hay que vigilar a algo que no puede ocurrir.
- **La comprobación automática no admite negociación**: una regla de cero aristas entre contextos, sin lista de excepciones. Las reglas con excepciones acumulan entradas hasta que dejan de comprobar nada, y cada excepción es una discusión que alguien acabará ganando.
- **Cada contexto se lee en solitario**, que es lo que la sección 7 de la arquitectura pide para que ninguna sesión de trabajo arrastre el contexto de las anteriores.

Sobre los tipos: cada contexto declara los que necesita en sus propios términos. `access` no recibe *el* principal de `principals`, sino su propia vista — un identificador y unos atributos. La traducción ocurre en composición.

Eso duplica declaraciones de identificadores opacos. **Es duplicación aceptada, no deuda**, y la sección 2.5 la cubre de forma explícita: se admite duplicación temporal antes que una abstracción prematura. Un paquete común sería el modelo único compartido que la sección 3 prohíbe, con el agravante de que todos dependerían de él y el blast radius volvería a ser global.

Regla práctica para quien implemente: si un mismo concepto se necesita en dos contextos con el mismo significado y la misma forma, probablemente los dos contextos son uno y la frontera está mal puesta. El arreglo es la frontera, no un paquete común — literalmente lo que dice la sección 3.

## Consecuencias

- La composición es el único punto de acoplamiento total del sistema. Intencionado: concentra ahí la complejidad de integración en lugar de repartirla.
- Hay trabajo de traducción que no existiría con imports directos. Es el precio, y se paga a sabiendas.
- La prohibición de paquete común se comprueba por nombre sobre el manifiesto del workspace. Es tosca, y ataca la forma real en que esto se erosiona: nadie añade un import prohibido, alguien crea un paquete "solo para los ids".

## Alternativas descartadas

- **Regla débil: importar solo superficies públicas.** Cumple la letra de la sección 3 y pierde su intención. Además exige mantener un grafo de dependencias permitidas, que es una discusión recurrente.
- **Paquete común de tipos primitivos.** El fallo de esta decisión, en su forma más razonable y por tanto más peligrosa.
- **Contexto compartido tipo *shared kernel* de DDD.** Legítimo en general, incompatible aquí: convertiría el blast radius en global, que es el criterio que la sección 3 señala como el que más rinde verificar.
