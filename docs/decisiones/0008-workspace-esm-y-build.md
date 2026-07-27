# 0008 — Workspace de pnpm, ESM y `exports` apuntando a lo compilado

**Estado**: Vigente

## Contexto

La decisión [0001](0001-lenguaje-y-base-mcp.md) elige TypeScript y apoya las fronteras en el campo `exports` del manifiesto, porque convierte el import profundo en un **error de resolución de módulos** y no en un aviso silenciable. Su sección de consecuencias avisa de que esa maquinaria hay que montarla desde el primer commit: "si llega tarde, llega después de la primera violación".

Montarla exige tres respuestas que 0001 no da: qué gestiona el workspace, qué sistema de módulos se usa, y a qué apunta `exports`.

## Decisión

**Workspace de pnpm. ESM con `module`/`moduleResolution` en `nodenext`. `exports` apunta a `dist/`, no a `src/`.**

Siete paquetes, uno por directorio de [`../diseno/contextos.md`](../diseno/contextos.md) §4, cada uno con exactamente una entrada `"."` y compilación con referencias de proyecto (`tsc -b`).

## Motivo

**Por qué `nodenext`.** Es el único modo en que TypeScript respeta `exports` también para los tipos. Con cualquier otro, un import profundo fallaría en ejecución pero compilaría, y la frontera solo existiría a medias — justo el "aviso que alguien puede silenciar" que 0001 descarta.

**Por qué `dist/` y no `src/`.** Es la parte contraintuitiva. Apuntar `exports` a las fuentes es cómodo: no hay que construir para probar. Pero entonces la frontera solo la sostiene el empaquetador del ejecutor de tests, y lo que se estaría comprobando es el resolutor de Vitest, no el de Node. Con `dist/`, alcanzar el interior de un contexto es `ERR_PACKAGE_PATH_NOT_EXPORTED` en el Node que corre en producción. Es la diferencia entre una frontera y una convención bien intencionada, y el test que lo demuestra lanza un proceso de Node aparte precisamente por eso.

**Por qué pnpm.** Sus `node_modules` aislados hacen que un paquete solo alcance lo que declara. Con hoisting plano, `access` podría importar una dependencia de `policy` sin declararla y nadie se enteraría; el aislamiento convierte eso en un fallo de resolución. Es la misma propiedad que 0001 busca, aplicada a las dependencias externas.

## Consecuencias

- **Hay que construir antes de comprobar.** `pnpm verify` empieza por `tsc -b`. Es un paso más y se acepta: sin él, la comprobación más importante mediría la herramienta equivocada.
- Los especificadores relativos llevan extensión `.js` aunque el fichero sea `.ts`. Obliga a dar el resolutor de TypeScript a dependency-cruiser, que de otro modo vería un grafo casi vacío.
- Los cinco contextos compilan con `types: []`: sin los tipos de Node, `process` y `Buffer` ni siquiera existen para el compilador. Es una capa más de pureza, gratis, por encima de la regla de linter.
- El esquema JSON viaja dentro del paquete `policy` y se copia a `dist/` en la compilación, así que la CLI puede emitirlo sin leer del disco.

## Alternativas descartadas

- **`exports` a `src/` con `tsx` o similar.** Ciclo de iteración más corto y ninguna garantía real de frontera. La comprobación de §2.3 de [`../diseno/verificacion.md`](../diseno/verificacion.md) pasaría a medir el ejecutor de tests.
- **npm workspaces.** Funcionan, pero el hoisting plano deja pasar dependencias no declaradas, que es una arista prohibida por otra vía.
- **Un solo paquete con carpetas y una regla de linter.** Es exactamente lo que la sección 3 de la arquitectura llama "una convención de nombres", y lo que 0001 rechaza al elegir `exports`.
