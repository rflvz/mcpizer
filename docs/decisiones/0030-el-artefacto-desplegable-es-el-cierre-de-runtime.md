# 0030 — El artefacto desplegable es `runtime` con su cierre de dependencias, producido por `pnpm deploy`

**Estado**: Vigente

## Contexto

[`../sesiones.md`](../sesiones.md) §5 dice que S4 termina cuando "el artefacto desplegable se construye y arranca desde cero contra una política de ejemplo". No dice qué es el artefacto desplegable, y hay al menos cuatro respuestas defendibles: un paquete publicado en un registro, un fichero único producido por un empaquetador, un directorio autocontenido, o una imagen de contenedor.

La elección no es cosmética. Determina qué se verifica, qué se puede verificar **sin infraestructura**, y qué le pasa a la frontera entre contextos —que en este repositorio la sostiene el gestor de módulos ([`../diseno/verificacion.md`](../diseno/verificacion.md) §1) y no una convención.

## Decisión

**El artefacto desplegable es un directorio autocontenido**: `runtime/` compilado más el cierre de sus dependencias de producción. Con ese directorio y un Node 22 hay pasarela; no hace falta el repositorio, ni pnpm, ni una instalación previa, ni red.

Lo produce **`pnpm deploy`**, no un empaquetador propio, desde [`../../deployment/package.js`](../../deployment/package.js).

## Motivo

**Por qué el cierre y no un fichero único.** Un empaquetador aplana los siete paquetes en un módulo. En este repositorio eso no es una optimización: es demoler la única comprobación que no se puede silenciar. La frontera entre contextos existe porque `exports` con entrada única convierte el import profundo en **un error de resolución de Node**, y un módulo aplanado ya no resuelve nada — la frontera pasaría de garantía a convención, que es justo lo que la decisión [0008](0008-workspace-esm-y-build.md) descartó. Verificar en el árbol de trabajo una propiedad que el artefacto desplegado no tiene sería verificar otra cosa.

**Por qué `pnpm deploy` y no un empaquetado propio.** El fichero de bloqueo decide qué versión de cada dependencia entra. Lo que se despliega es entonces exactamente lo que se verificó. Un empaquetador que resolviera por su cuenta rompería esa cadena en el único punto donde no se nota hasta producción.

**Por qué no publicar en un registro.** Los siete paquetes son los contextos y la composición: publicarlos convertiría sus superficies internas en API pública de terceros, y el blast radius —que hoy es cero por construcción— pasaría a depender de quién haya instalado qué. El producto es una pasarela, no una biblioteca. Ver también [0035](0035-una-version-para-el-producto.md).

**Por qué no la imagen.** Ver [0032](0032-la-imagen-es-una-envoltura.md): la imagen es una envoltura de este directorio, y hacerla el artefacto primario ataría el criterio de terminación a un demonio de contenedores.

## Consecuencias

- `pnpm package` construye el artefacto. Compila siempre y parte de vacío: empaquetar sobre un `dist/` viejo produce un artefacto que arranca y hace lo que ya no dice el código.
- El manifiesto del artefacto **es** el de `runtime/`, así que la versión que imprime `mcpizer version` sale de ahí. De ahí la comprobación de que los dos manifiestos digan lo mismo, con su caso de fallo en [`../../verification/fixtures/violations/version-desalineada/`](../../verification/fixtures/violations/version-desalineada/).
- `pnpm deploy` necesita `--legacy` en pnpm 10: la vía moderna exige `inject-workspace-packages`, que cambia cómo se enlazan los paquetes durante el desarrollo. No se toca el desarrollo para arreglar el despliegue.
- El artefacto pesa lo que pesa su cierre de producción, unas cien dependencias, casi todas del SDK de MCP. Es visible y auditable, que es preferible a un fichero único donde no se distingue qué entró.

## Alternativas descartadas

- **Fichero único con un empaquetador.** Rompe la frontera entre contextos en producción, como se ha explicado. Además esconde la procedencia de cada dependencia.
- **Publicar `mcpizer` en un registro.** Obliga a versionar y mantener siete superficies internas, y no responde a nadie: el producto se despliega, no se importa.
- **`npm pack` de cada paquete y una instalación en el destino.** Requiere red o un registro interno en el momento del despliegue, que es exactamente cuando conviene no necesitarlos.
- **Copiar el repositorio entero al destino.** Lleva el taller —compilador, linter, ejecutor de tests, fixtures— a producción. Lo que no viaja no hay que parchearlo.
