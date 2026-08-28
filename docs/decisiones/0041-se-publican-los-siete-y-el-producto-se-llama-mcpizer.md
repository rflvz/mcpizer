# 0041 — Se publican los siete paquetes, con una sola versión, y el que trae la CLI se llama `mcpizer`

**Estado**: Vigente. Sustituye en parte a [0035](0035-una-version-para-el-producto.md).

## Contexto

El producto se conseguía de dos maneras, y las dos exigían este repositorio: clonarlo y ejecutar `pnpm`, o construir el artefacto desplegable desde él ([0030](0030-el-artefacto-desplegable-es-el-cierre-de-runtime.md)). Para un despliegue eso basta. Para todo lo demás —alguien que quiere preguntarle una cosa a una política, revisar una concesión en un PR ajeno, probar la pasarela un rato— clonar un repositorio y construirlo es un peaje que no tiene nada que ver con el problema.

La decisión [0035](0035-una-version-para-el-producto.md) dejó los siete paquetes `private: true` con un argumento explícito: *"publicarlos convertiría las superficies internas de los cinco contextos en API de terceros, y el blast radius —hoy cero por construcción— pasaría a depender de quién haya instalado qué"*.

## Decisión

**Se publican los siete**, todos a la misma versión: la del producto. **El que trae la CLI se llama `mcpizer`** —no `@mcpizer/runtime`— y el paquete raíz del workspace pasa a llamarse `mcpizer-workspace`, que es lo que de verdad es: el taller, y no se publica.

## Motivo

**Por qué el argumento de 0035 no se puede cumplir publicando menos.** La salida ideal sería publicar **un** paquete y que los seis contextos viajaran dentro de él: quien instala obtiene el producto, y ninguna superficie interna aparece en el registro. npm tiene exactamente ese mecanismo, `bundledDependencies`, y se intentó. pnpm se niega:

```
ERR_PNPM_BUNDLED_DEPENDENCIES_WITHOUT_HOISTED
bundledDependencies does not work with "nodeLinker: isolated"
```

Para empaquetarlos dentro habría que pasar el workspace entero a un `node_modules` aplanado. Y el aplanado es justo lo que permite que un paquete resuelva algo que nunca declaró, que es el mecanismo —no la convención— sobre el que descansa la frontera entre contextos ([`../diseno/verificacion.md`](../diseno/verificacion.md) §1). Cambiar la resolución de módulos de todo el repositorio para no publicar seis manifiestos es pagar la garantía fuerte por la débil.

**Y por qué publicar los siete no es lo que 0035 temía.** Lo que aquella decisión protegía es que el blast radius de un cambio interno sea cero. Eso lo sostienen los retratos de superficie, y siguen sosteniéndolo: cambiar la superficie de un contexto pone rojo `pnpm check:surface` igual que antes. Lo que cambia es que un tercero *podría* importar `@mcpizer/policy` y quedarse pegado a ella. Se responde diciéndolo —los seis se describen en su propio manifiesto como *contexto de mcpizer*, no como biblioteca— y no fingiendo que el riesgo no existe. Es el mismo trato que [0040](0040-se-escriben-las-implementaciones-previstas.md): se registra lo que cuesta, en vez de justificarlo a posteriori.

**Por qué `mcpizer` y no `@mcpizer/runtime`.** El nombre que alguien teclea es la primera línea de documentación del producto, y `runtime` es un nombre de la arquitectura: dice qué papel hace ese paquete *dentro*, y no dice nada a quien solo quiere instalarlo. El directorio sigue llamándose `runtime/` porque ahí ese nombre sí significa algo — es la composición, y `docs/diseno/contextos.md` §4 lo nombra así. Que el directorio y el paquete publicado no se llamen igual es información, no incoherencia: son dos audiencias distintas.

**Por qué una sola versión para los siete, y no seis ceros.** `pnpm pack` sustituye `workspace:*` por la versión **exacta** del paquete al que apunta. Con los contextos en `0.0.0` eso publica un `mcpizer@0.1.0` que exige `@mcpizer/policy@0.0.0`: se instala hoy y deja de instalarse el día que uno de los seis suba de número por cualquier motivo. Alinearlos no es cosmética; es lo que hace que los siete se instalen juntos o no se instale ninguno. La alternativa de 0035 —"seis números que nadie lee"— era correcta mientras nadie los resolviera; ahora los resuelve npm.

## Consecuencias

- `pnpm publish -r` publica los siete. `deployment/publish.js` lo envuelve, **en seco por defecto** como el producto ([0014](0014-uso-por-defecto-en-seco.md)), y se niega en los casos en que publicar sale mal sin que el registro se queje.
- Subir de versión pasa de tocar dos manifiestos a tocar ocho. Lo atrapan dos comprobaciones distintas: el empaquetado se niega si la raíz y el artefacto no coinciden, y el publicado se niega si los siete no dicen lo mismo.
- `npx mcpizer` funciona, y es el camino que el README ofrece primero.
- Nadie ha publicado todavía, y ya no es porque falte nada: la licencia que quedaba pendiente ([0042](0042-la-licencia-la-elige-el-dueno.md)) la eligió el dueño ([0044](0044-la-licencia-es-mit.md)). Lo que está comprobado es que lo que se publicaría se instala y arranca ([0043](0043-lo-instalado-se-comprueba-con-el-npm-real.md)); lo que queda es dar el paso irreversible.
- Si algún día los seis contextos estorban en el registro, el camino de vuelta existe y está descrito arriba: `bundledDependencies` con un `node_modules` aplanado, pagando lo que cuesta.

## Alternativas descartadas

- **Seguir sin publicar, como decidió 0035.** Sigue siendo defendible para el producto que 0035 describía —"una pasarela que se despliega, no una biblioteca que se importa"—. Lo que cambió es que la pasarela también se usa en seco, en un portátil, y para eso clonar el repositorio es la parte cara.
- **Empaquetar los seis dentro del séptimo.** Es la que se quería. La descarta pnpm, y el precio de forzarla es el aplanado del `node_modules`: ver arriba.
- **Publicar solo `mcpizer` y aplanar los siete paquetes en uno al compilar.** Destruye la frontera en lo que la gente instala, y deja verificada en el árbol de trabajo una propiedad que el producto distribuido no tiene. Es el mismo argumento por el que el artefacto desplegable no es un fichero único ([0030](0030-el-artefacto-desplegable-es-el-cierre-de-runtime.md)).
- **Llamar al paquete `@mcpizer/cli`.** Un ámbito para un solo paquete público es ceremonia, y obliga a teclear siete caracteres que no dicen nada.
