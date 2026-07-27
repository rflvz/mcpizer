# 0007 — Fase de sesiones: cuatro sesiones grandes, hito en la CLI

**Estado**: Vigente

## Contexto

La sección 7 de la arquitectura pide definir qué cubre cada sesión de trabajo, qué documentación entra y qué produce, "de modo que ninguna arrastre el contexto acumulado de las anteriores".

Tres preguntas quedaban sin respuesta obvia: cuál es el primer hito demostrable, cómo de grande es una sesión, y qué deja cada una en el repositorio.

## Decisión

**1. El primer hito es la CLI de verificación en seco**, no una pasarela MCP mínima.

**2. Cuatro sesiones muy grandes**, no una docena pequeñas.

**3. Un PR en borrador por sesión.**

## Motivo

**Sobre el hito.** La CLI valida y explica políticas sin infraestructura de ningún tipo, así que es el invariante 8 convertido en producto y no en promesa. Es útil por sí sola —un linter de políticas ya justifica su existencia— y se convierte en el banco de pruebas de todo lo posterior: cuando llega la pasarela, ya hay una forma de comprobar que decide lo que debe. Ataca además el riesgo en el orden correcto, porque el núcleo es donde está la lógica y la periferia donde está el fontanero.

**Sobre el tamaño.** La sección 7 no pide sesiones pequeñas: pide que no se arrastre contexto acumulado. Cuatro sesiones autocontenidas filtran menos que doce, porque cada traspaso es una ocasión de que algo viaje en la cabeza de alguien en vez de en el repositorio.

Y es la sección 1 aplicada al troceado. Si sobredeterminar el plan convierte un modelo caro en un transcriptor, trocear el trabajo en encargos de una hora hace lo mismo por otra vía: gasta la capacidad de razonamiento multipaso en recomponer un contexto que se acaba de tirar.

**Sobre el cierre.** Un PR por sesión hace que el estado del repositorio —y no la conversación— sea el portador del contexto, que es literalmente lo que pide la sección 7. Cada sesión queda revisable por separado y el PR deja constancia de qué cubrió y qué dejó fuera.

## Consecuencias

- **El riesgo se desplaza a decisiones tempranas no supervisadas.** Una sesión larga propaga un error durante horas antes de que nadie lo vea. La mitigación no es revisar más, sino que la autonomía la acote la verificación: de ahí que las barreras se levanten antes que lo que protegen, y que cada comprobación lleve un caso que la hace fallar.
- **Los criterios de terminación tienen que ser mecánicos.** Sin humano a media sesión, "funciona" no es criterio.
- **El corolario de la sección 1 pasa de recomendación a mecanismo central**: una sesión que se detiene a preguntar cada vez que el diseño calla no llega al final.
- **Los PR son grandes.** Se acepta: la unidad de revisión es el hito, no el fichero.
- **La tabla de lectura de `../diseno/README.md` pasa a ser un mínimo, no un techo.** Una sesión grande carga toda la documentación. El troceado de `diseno/` sigue justificado por el efecto de disciplina que recoge la decisión [0006](0006-nomenclatura-y-troceado-documental.md), no ya por presupuesto de contexto.

## Alternativas descartadas

- **Pasarela MCP mínima como primer hito.** Es el esqueleto andante clásico y desriesga antes la parte técnicamente más incierta —mcpizer habla MCP por los dos lados, como servidor y como cliente—. Se descarta porque exige periferia antes de tener con qué comprobar que la decisión es correcta, y porque deja el invariante 8 sin demostrar hasta mucho más tarde.
- **Sesiones de un entregable verificable (≈9).** Cada una cabría holgadamente y el troceado sería más tolerante a fallos. Descartada por la restricción explícita de exprimir el razonamiento multipaso en máxima autonomía, y porque multiplica los traspasos, que es donde se fuga el contexto.
- **Una sesión por contexto y por adaptador (≈14).** Máximo aislamiento, pero varias sesiones quedarían por debajo del coste fijo de arrancar en frío.
- **Commits sobre una rama común, sin PR por sesión.** Más simple, pero hace más fácil que una sesión invada el alcance de otra sin que se note en ninguna parte.
