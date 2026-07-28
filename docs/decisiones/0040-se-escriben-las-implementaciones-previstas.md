# 0040 — Se escriben las cinco implementaciones previstas que faltaban, sabiendo lo que eso cuesta

**Estado**: Vigente. Sustituye en parte a [0036](0036-lo-que-s4-no-cierra.md).

## Contexto

[`../diseno/puertos.md`](../diseno/puertos.md) §4 enumeraba cinco implementaciones "previstas y sin escribir": mTLS, `PolicySource` sobre HTTP, el gestor de secretos del proveedor cloud, el almacén de tokens OAuth con refresco y el fichero de auditoría con rotación.

Escribirlas tiene un argumento en contra que está escrito en la propia arquitectura, sección 2.5: **abstracciones anticipadas**, y admitir duplicación temporal antes que una abstracción prematura basada en una sola aparición del patrón. La decisión [0036](0036-lo-que-s4-no-cierra.md) se apoyó justo en eso para dejarlas fuera.

## Decisión

**Se escriben las cinco.** Y se registra que la razón es que se pidió cerrar el producto, no que el argumento de 0036 fuera malo.

## Motivo

**Por qué esto no es lo que la sección 2.5 prohíbe.** Lo que aquella sección prohíbe es abrir una **frontera** —un puerto— sin variación conocida. Aquí no se abre ninguna: los siete puertos son los mismos, `runtime/src/ports.ts` no se toca, y su retrato versionado lo demuestra. Lo que se añade son implementaciones dentro de fronteras que el invariante 9 ya justificó, cada una con la variación real que `puertos.md` enunció al abrirlas.

**Y por qué el argumento de 0036 seguía siendo bueno.** Porque el coste no es escribirlas: es mantenerlas sin un despliegue que las use. Un adaptador sin usuario es un adaptador cuyo primer error de verdad lo encuentra alguien que confiaba en él. Se paga con lo único que lo compensa: **cada una tiene su servidor de fixture hablando el protocolo real** y sus casos de fallo, así que ninguna es una promesa — son código ejecutado.

**Lo que se ha aprendido escribiéndolas**, que es lo que justifica el registro más que cualquier recuento:

- La tercera de `PrincipalResolver` contradecía una decisión ya tomada, y la contradicción no se vio hasta escribirla. Está resuelta en [0037](0037-la-identidad-de-certificado-la-verifica-el-terminador.md).
- Dos de ellas traen una URL que alguien escribe en la configuración, y en las dos aceptar `http://` era lo cómodo. Está resuelto en [0038](0038-nada-sensible-por-canal-abierto.md).
- La cuarta de `CredentialResolver` obligó a decidir dónde vive el secreto de su cliente sin romper que el artefacto solo lleve referencias. Se resolvió con una referencia que nombra otra referencia.
- Ninguna de las cinco pidió tocar un contrato de puerto. Un puerto que aguanta cuatro implementaciones con modos de fallo tan distintos como los de una variable de entorno y los de un token que caduca estaba bien planteado — y eso solo se sabe habiéndolo intentado.

## Consecuencias

- `puertos.md` §4 ya no tiene nada en la columna de "previsto y sin escribir". Eso **no** significa que no vaya a haber más implementaciones: significa que las que había previstas dejan de ser una promesa.
- Cinco adaptadores más que mantener, y una superficie de dependencias que no crece: ninguno añade un paquete: HTTP, `node:crypto` y `node:fs` bastan, en la línea de la decisión [0026](0026-jose-si-cliente-de-redis-y-sdk-de-otel-no.md).
- El gestor de secretos cloud se ha escrito contra la API de un proveedor concreto. Otro proveedor es otro adaptador dentro de la misma frontera, no una frontera nueva.
- Si alguna de las cinco no encuentra usuario en un tiempo razonable, lo correcto es **retirarla**, no dejarla envejecer. Esta decisión es el sitio donde mirar para saber que retirarla no rompe ninguna promesa de diseño.

## Alternativas descartadas

- **Dejarlas pendientes, como decidió 0036.** Era defendible y sigue siéndolo; lo que cambió es el encargo, no el argumento.
- **Escribir solo las que tuvieran usuario hoy.** Ninguna lo tiene: no hay despliegue. El criterio habría dejado las cinco fuera.
- **Escribirlas sin servidor de fixture, probándolas con dobles.** Habría sido mucho más rápido y no habría demostrado nada: un doble comprueba que el adaptador llama a nuestra función, no que entienda el protocolo del otro extremo.
