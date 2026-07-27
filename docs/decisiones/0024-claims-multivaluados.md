# 0024 — Un claim multivaluado no produce atributo

**Estado**: Vigente

## Contexto

La decisión [0011](0011-semantica-del-selector.md) fijó que un selector es una conjunción de igualdades sobre atributos **de un solo valor**, y dejó anotado el camino de sustitución "para cuando exista un adaptador OIDC real". Ese adaptador es S3, y el choque llega de inmediato: `groups` es un array en cualquier proveedor de identidad, y [`../../examples/policy.yaml`](../../examples/policy.yaml) declara literalmente `team: claim:groups`.

Así que hay que decidir qué hace `PrincipalResolver` cuando el token trae `groups: ["ventas", "compras"]` y la política espera un `team` que valga `ventas` o no valga.

## Decisión

- Un claim que es una cadena, un número o un booleano → ese valor.
- Un array de **un** elemento → ese elemento. Se reduce sin ambigüedad.
- Un array de **varios** elementos → **el atributo no se produce**.
- El token **sigue siendo válido** en los tres casos. No se rechaza.

## Motivo

**Por qué no producirlo es la respuesta correcta.** El selector es una conjunción de igualdades: un atributo ausente no casa con ninguna concesión que lo nombre. Así que un token con `groups: ["ventas", "compras"]` no obtiene la concesión de `team: ventas` — ni la de `team: compras`. Es fallo cerrado **por construcción**, no por una comprobación que alguien tenga que acordarse de escribir.

Y es la única lectura que conserva lo que 0011 compró. Elegir el primer elemento del array haría que el resultado dependiera del orden en que el proveedor de identidad serializa un conjunto — que es exactamente la dependencia del orden que la decisión [0005](0005-politica-solo-aditiva.md) eliminó de la evaluación. Tratarlo como disyunción rompería el análisis de ambigüedad de 0005, que 0011 existe para hacer exacto.

**Por qué el token no se rechaza.** Un emisor puede declarar claims que ninguna concesión usa; rechazar el token por el contenido de uno de ellos haría que añadir un usuario a un segundo grupo le quitara accesos que no dependían de ese grupo. La denegación tiene que ser de la **concesión** que mira ese atributo, no de la identidad entera.

**Y es visible, no silencioso.** Quien tenga grupos múltiples y espere entrar recibe `no_grant_matches` con el sitio exacto del artefacto a tocar, que es el bucle de corrección del invariante 4. El escape que ofrece 0005 —"la excepción se expresa estrechando el selector"— sigue funcionando: se declara un claim que sí sea de un solo valor.

## Consecuencias

- Una organización cuyos usuarios pertenezcan a varios grupos necesita que su proveedor emita un claim de un solo valor para lo que la política discrimine — un `primary_team`, o un claim calculado. Es trabajo de configuración del IdP, y es donde debe estar: la política no puede resolver una ambigüedad que la identidad no ha resuelto.
- El caso está en `adapters/test/oidc-principal.test.ts`, con el array de un elemento y el de varios uno al lado del otro, porque la diferencia entre ambos es la decisión entera.
- Si algún día hace falta discriminar sobre pertenencia a conjunto, lo que hay que revisar es **0011**, no esto. Y entonces habrá que contestar qué significa ambigüedad con atributos multivaluados, que es la pregunta que 0011 evitó a propósito.

## Alternativas descartadas

- **Tomar el primer elemento.** Silencioso y dependiente del orden de serialización del IdP. El mismo usuario entraría o no según cómo su proveedor ordenara un conjunto.
- **Producir el atributo para cada valor y casar si alguno coincide.** Es disyunción: rompe 0011 y con ella el análisis de ambigüedad exacto de 0005.
- **Rechazar el token con `credential_invalid`.** Convierte "no tienes esta concesión" en "tu identidad no vale", que es un motivo distinto y falso, y quita accesos no relacionados.
- **Unir los valores en una cadena, `ventas,compras`.** Produce un atributo que nadie puede escribir en una política sin adivinar el separador y el orden.
