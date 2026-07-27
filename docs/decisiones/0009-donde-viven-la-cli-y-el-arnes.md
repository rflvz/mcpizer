# 0009 — La CLI vive en `runtime/`; el arnés de aceptación, en `verification/`

**Estado**: Vigente

## Contexto

[`../sesiones.md`](../sesiones.md) §5 encarga a S1 "el espacio de trabajo y **los siete paquetes**" y "la CLI de verificación en seco". [`../diseno/contextos.md`](../diseno/contextos.md) §4 fija esos siete directorios y ninguno se llama `cli`.

A la vez, las comprobaciones automáticas y sus casos de fallo necesitan vivir en algún sitio, y no son ni dominio ni periferia: son la interfaz de aceptación del trabajo (sección 5 de la arquitectura).

## Decisión

**1. La CLI es un `bin` de `runtime/`.** No hay un octavo paquete.

**2. El arnés de aceptación vive en `verification/`**, fuera del alcance de la compilación, del linter y del análisis de dependencias, junto con sus fixtures de violación.

## Motivo

**Sobre la CLI.** Lo que hace es exactamente lo que la sección 1 de [`../diseno/contextos.md`](../diseno/contextos.md) describe como cáscara: reúne los hechos —el artefacto, el catálogo, el instante—, invoca la decisión y ejecuta el efecto, que aquí es imprimir. Eso es composición. Un paquete `cli/` añadiría un nombre de primer nivel sin capacidad de negocio detrás y le pediría a quien abre el repositorio que distinga entre dos cosas que son la misma.

Que el reloj viva aquí no es un detalle: el instante se captura en la CLI y entra en la decisión como un hecho más. Es la razón por la que no existe un puerto `Clock` ([`0002`](0002-nucleo-funcional-cascara-imperativa.md)) y por la que la verificación en seco puede preguntar por cualquier instante sin trucos.

**Sobre el arnés.** Está fuera del alcance de las herramientas por una razón concreta: [`../sesiones.md`](../sesiones.md) §2 exige que cada comprobación lleve un caso que la hace fallar, y un caso que hace fallar al análisis de dependencias es, por definición, código que viola las reglas. Si estuviera dentro del alcance, el build fallaría siempre. Los fixtures se ejecutan a propósito, contra la regla real —no contra una copia—, y el test afirma que la regla los rechaza.

Que las reglas se exporten como dato y las lean tanto la configuración real como los casos de fallo es lo que hace que aflojar una regla ponga rojo su propio test. Un caso de fallo que use una copia de la regla no demuestra nada.

## Consecuencias

- `verification/` es un directorio de primer nivel que no habla del dominio. Se acepta porque en este proyecto la verificación **es** la interfaz de aceptación, y esconderla sería menos honesto que nombrarla.
- Los mensajes de la CLI y de los diagnósticos van en español, como la documentación. La decisión [0006](0006-nomenclatura-y-troceado-documental.md) fija el inglés para los *nombres de código*; el texto que lee una persona es otro artefacto, con otro público.
- Ejecutar los tests de la CLI exige haber construido antes. `pnpm verify` lo hace; lanzar el ejecutor de tests a pelo tras un cambio puede medir un `dist/` viejo.

## Alternativas descartadas

- **Un paquete `cli/`.** Contradice el recuento explícito de siete paquetes de [`../sesiones.md`](../sesiones.md) §5 y añade una frontera que no separa nada.
- **La CLI dentro de `adapters/`.** Un adaptador de entrada es defendible en hexagonal canónico, pero [`../diseno/contextos.md`](../diseno/contextos.md) §4 dice que `adapters/` implementa los contratos de puerto que declara `runtime/`, y una CLI no implementa ninguno: los consume.
- **Las comprobaciones repartidas por los paquetes.** Cada una habla del repositorio entero, no de un paquete. Repartirlas obligaría a que un paquete supiera de los demás, que es la arista que la decisión [0004](0004-sin-dependencias-entre-contextos.md) prohíbe.
