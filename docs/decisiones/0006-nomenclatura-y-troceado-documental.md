# 0006 — Nomenclatura en inglés y diseño partido en cinco documentos

**Estado**: Vigente

## Contexto

Dos decisiones menores que se registran porque alguien razonable las tomaría al revés, que es uno de los criterios de entrada de este registro.

La documentación del proyecto está en español. La sección 2.2 exige que la estructura de primer nivel grite el dominio. Y la sección 7 pide que ninguna sesión de trabajo arrastre el contexto acumulado de las anteriores.

## Decisión

**1. Los nombres de código van en inglés**, con sustantivos del dominio: `principals/`, `capabilities/`, `accounts/`, `access/`, `policy/`, más `adapters/` y `runtime/`. La documentación sigue en español.

**2. El diseño detallado se parte en cinco documentos** en vez de escribirse como uno solo.

## Motivo

**Sobre el idioma.** Lo que la sección 2.2 exige es que la estructura hable del *problema* en lugar de la tecnología. `principals/` cumple eso igual que `quien-invoca/`; lo que estaba descartado era `controllers/` y `services/`. Elegido el inglés, el código no mezcla idiomas dentro de una misma expresión — el SDK de MCP, los tipos del protocolo y las capacidades declaradas en el artefacto ya están en inglés, y una mezcla obligaría a traducir mentalmente en cada frontera. La documentación es otro artefacto, con otro público, y no tiene ese problema.

Que `adapters/` y `runtime/` tengan nombres técnicos es correcto y honesto: son periferia, y la sección 2.2 pide que la estructura grite el *dominio*. La periferia no lo es, y disfrazarla de dominio sería peor que nombrarla por lo que es.

**Sobre el troceado.** Un documento único obligaría a cada sesión a cargarlo entero para usar una quinta parte, que es exactamente lo que la sección 7 quiere evitar. Partido, cada documento se lee con `arquitectura.md` y nada más, y el índice de [`../diseno/README.md`](../diseno/README.md) dice qué lleva cada tipo de sesión.

Hay además un efecto de disciplina: si un documento no se sostiene sin los otros cuatro, el troceado está mal hecho y se nota al escribirlo. Un fichero único esconde ese acoplamiento.

## Consecuencias

- Hay repetición deliberada entre documentos — el argumento del núcleo funcional aparece resumido en varios sitios. Es el precio de que cada uno se lea solo, y se paga a sabiendas.
- Los enlaces cruzados apuntan a secciones concretas para que la repetición no se convierta en divergencia.
- Traducir entre los términos del dominio en español y los nombres en inglés es trabajo recurrente al escribir documentación. Se asume.

## Alternativas descartadas

- **Nombres de carpeta en español** (`quien-invoca/`, `contra-que-cuenta/`). Gritan el dominio con más fuerza y encajan con la documentación, pero obligan a mezclar idiomas en cada frontera con el SDK y con el propio artefacto declarativo.
- **Un único documento de diseño.** Más fácil de mantener coherente, peor para el objetivo de la sección 7.
- **Diseño dentro del propio `arquitectura.md`.** Descartado de plano: ese documento es vinculante y su sección 0 dice explícitamente que no es diseño detallado. Mezclarlos borraría la distinción entre lo que no se renegocia y lo que sí.
