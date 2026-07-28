# 0039 — El generador del catálogo declarado, y por qué aborta en vez de completar

**Estado**: Vigente. Sustituye en parte a [0036](0036-lo-que-s4-no-cierra.md).

## Contexto

El catálogo declarado es lo que hace posible el invariante 8: permite verificar una configuración entera sin levantar ningún upstream. Las decisiones [0021](0021-el-catalogo-declarado-basta-en-s2.md) y [0025](0025-el-descubrimiento-mcp-no-autentica.md) daban por hecho que ese fichero se genera desde los upstreams reales, y anotaron que la herramienta no existía. La [0036](0036-lo-que-s4-no-cierra.md) la dejó pendiente otra vez, con el argumento de que su contrato se decidía mejor con un despliegue grande delante.

Ese argumento sigue siendo válido y ya no es el que decide: se ha pedido cerrar el producto. Lo que queda es elegir bien entre las tres formas que la 0036 enunciaba.

## Decisión

**`mcpizer catalog <politica>`**: pregunta `tools/list` a cada upstream declarado y escribe el catálogo completo por stdout.

**Un upstream que no responde aborta la generación.** No se escribe un catálogo parcial.

El resultado va ordenado por upstream y por nombre.

## Motivo

**Por qué el catálogo entero y no un upstream cada vez.** Las tres formas que 0036 enunciaba —entero, por upstream, o el diff contra el versionado— se reducen a una en cuanto se mira qué se hace con el resultado: se versiona junto a la política y se revisa en el mismo PR. Un fichero que se regenera por trozos tiene estados intermedios que nadie ha revisado, y el diff contra el versionado ya lo da `git` sin que haga falta escribirlo.

**Por qué aborta.** Es la misma regla que gobierna el descubrimiento en la pasarela ([`../diseno/puertos.md`](../diseno/puertos.md) §2.3): *un upstream caído no puede degradarse a "sin tools"*. Aquí el efecto está diferido y es peor. Un catálogo al que le faltan las tools de quien no contestó se ve completo, se versiona, y el día que alguien lo use para verificar dirá que unas tools no existen — convirtiendo una caída de hace tres semanas en una revocación silenciosa que nadie relacionará con nada.

**Por qué se ordena.** El resultado se versiona, así que su diff se lee. Un orden que dependiera de en qué orden contestaron los upstreams produciría un diff distinto en cada ejecución, y un fichero cuyo diff es ruido deja de revisarse — que es exactamente perder lo que se buscaba al versionarlo.

**Por qué es un comando aparte y no una bandera de `validate`.** Es la única mitad del flujo que toca la red. Mezclarla con `validate` pondría una llamada de red dentro del comando cuya propiedad declarada es no tener ninguna, y esa propiedad es el invariante 8.

**Por qué el escritor vive junto al lector.** El formato tiene un solo dueño. Si el que escribe y el que lee vivieran separados, la primera vez que uno de los dos cambiara se descubriría en un despliegue.

## Consecuencias

- El ciclo completo queda cerrado y es el que el diseño describía: se genera **una vez** con red, se versiona, y a partir de ahí `validate` y `explain` vuelven a funcionar sin ella.
- Lo que el upstream declara como esquema de entrada viaja tal cual. Reescribirlo sería inventarse un contrato que nadie ha declarado.
- El catálogo incluye tools que ningún mapeo cubre, y debe hacerlo: el catálogo describe lo que **hay**, y que aparezcan es lo que permite a `validate` señalarlas.
- El descubrimiento sigue yendo sin autenticar ([0025](0025-el-descubrimiento-mcp-no-autentica.md)). Un upstream que exija credencial para listar sus tools sigue sin poder generarse así, y esa sigue siendo la condición para reabrir aquella decisión.

## Alternativas descartadas

- **Escribir el fichero en su sitio en vez de por stdout.** Obligaría a saber dónde va y a decidir qué hacer si ya existe. Por stdout, quien lo invoca redirige, y el diff lo enseña `git`.
- **Completar el catálogo con lo que sí contestó y avisar.** Es el modo de fallo que esta decisión existe para evitar.
- **Fusionar con el catálogo versionado en vez de reemplazarlo.** Una tool retirada en el upstream no desaparecería nunca del fichero, y la verificación en seco seguiría validando mapeos a algo que ya no existe.
