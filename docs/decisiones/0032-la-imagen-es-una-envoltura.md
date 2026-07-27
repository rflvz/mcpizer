# 0032 — La imagen es una envoltura del artefacto, y el criterio de terminación no la necesita

**Estado**: Vigente

## Contexto

"Empaquetado y despliegue" evoca inmediatamente una imagen de contenedor, y para casi cualquier despliegue real es la forma de entrega. Pero el criterio de terminación de S4 —"el artefacto desplegable se construye y arranca desde cero contra una política de ejemplo"— es un criterio **mecánico**: un comando que pasa o falla ([`../sesiones.md`](../sesiones.md) §3).

Si ese comando necesitara un demonio de contenedores, dejaría de correr en cualquier portátil y en cualquier ejecutor sin privilegios. Y este repositorio ya presume de lo contrario en su comprobación anterior: "no hace falta Docker, ni red, ni un servicio levantado".

## Decisión

**El criterio de terminación se ejecuta sobre el directorio autocontenido, sin Docker.** Construye, arranca el proceso fuera del repositorio con el entorno podado, y le pasa un cliente MCP de verdad por los dos transportes.

**La imagen es una envoltura de ese mismo artefacto.** Su primera etapa ejecuta literalmente `node deployment/package.js`; la segunda copia el resultado y no construye nada. **Se construye y se arranca en CI**, en un trabajo aparte.

## Motivo

**Por qué la comprobación no depende del contenedor.** Un criterio de terminación que solo corre en CI se comprueba una vez por PR, en frío, y deja de ser la red que sostiene el trabajo autónomo de [`../sesiones.md`](../sesiones.md) §2. El que corre en el portátil se comprueba cada vez.

**Por qué la imagen no construye el producto por su cuenta.** Si tuviera su propio `tsc` y su propio `install`, habría **dos empaquetados y solo uno comprobado**. Es la forma habitual de que "en local funciona" sea literalmente verdad y siga sin servir de nada. Con una sola etapa que invoca el mismo guion, un fallo de empaquetado se ve en `pnpm verify`, no en el registro de imágenes.

**Por qué aun así se construye en CI.** Un `Dockerfile` que nadie construye es documentación que se pudre en silencio. El trabajo de CI la construye, le pregunta la versión, la arranca contra `examples/policy.yaml`, comprueba que la sonda contesta y que `docker stop` termina con **código 0** — no 143, que sería morir *por* la señal, ni 137, que sería que se agotó el plazo.

## Consecuencias

- `pnpm verify` sigue sin necesitar Docker, red ni servicios. La afirmación del README se mantiene, acotada explícitamente a ese comando.
- El trabajo `image` de CI puede fallar por causas ajenas al código —un registro caído, una etiqueta base movida—. Es un trabajo separado a propósito: su rojo no significa lo mismo que el rojo de `verify`.
- La imagen no lleva ni pnpm, ni compilador, ni fuentes: solo el artefacto y un Node. Lo que no viaja no hay que parchearlo.
- Correr como usuario sin privilegios y sin necesidad de escribir en disco es posible porque la pasarela no persiste nada: los contadores viven en memoria o en Redis, y la auditoría sale por un descriptor.

## Alternativas descartadas

- **La imagen como artefacto desplegable primario, y el criterio sobre ella.** Ata la comprobación más importante del repositorio a una herramienta que puede no estar, y hace irreproducible en local el único comando que decide si la sesión terminó.
- **No incluir imagen y documentar cómo se construiría.** Deja el despliegue en el terreno de la opinión, que es lo que la sección 5 de la arquitectura prohíbe.
- **Construir la imagen dentro de `pnpm verify` cuando haya demonio disponible.** Una comprobación que se salta sola es peor que no tenerla: cambia lo que se está verificando sin decirlo.
- **Manifiestos de orquestador versionados en el repositorio.** No se pueden ejecutar aquí, así que serían YAML sin verificar en un repositorio cuyo criterio es que las cosas se ejecutan y se responden. Lo vinculante es el **contrato de operación** —señales, sonda, interfaz, códigos de salida—, y ese sí está escrito y comprobado.
