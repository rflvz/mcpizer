# 0016 — El nombre expuesto de una tool es `upstream__tool`, siempre

**Estado**: Vigente

## Contexto

El cliente MCP ve un espacio de nombres plano. Los upstreams no: dos proveedores pueden ofrecer `search`, y [`../diseno/modelo.md`](../diseno/modelo.md) §2 dice que varias tools de distintos upstreams realizando lo mismo "es la situación normal, no la excepción".

Hace falta además el camino de vuelta. `tools/call` trae un nombre y hay que llegar desde él a la tool concreta, a su upstream y a la capacidad que realiza, sin ambigüedad.

## Decisión

**El nombre expuesto es `${upstream}__${tool}`, con doble guion bajo, y se cualifica siempre** — no solo cuando hay colisión.

## Motivo

Cualificar solo en conflicto haría que **el nombre visible dependiera de qué otros upstreams estén declarados**. Añadir un proveedor nuevo renombraría tools de otro, y romper el cliente de alguien al declarar algo que no le concierne es exactamente la clase de acoplamiento que el invariante 7 existe para impedir. Que el nombre sea más largo se paga una vez; que cambie solo, se paga siempre.

El separador es `__` y no `-` ni `.` porque los identificadores de upstream ya admiten guiones (`^[a-z0-9][a-z0-9-]*$`): con `-`, `a-b__c` y `a__b-c` colisionarían y el mapeo inverso dejaría de ser una función. El doble guion bajo no aparece en ningún identificador válido y cabe en el juego de caracteres que los clientes MCP aceptan.

El índice inverso se construye una vez al arrancar, desde el catálogo. Un nombre que no está en él **no llega a `access`**: no hay capacidad sobre la que decidir, y fabricar una para obtener un motivo abriría el vocabulario cerrado que la decisión [0018](0018-fallos-que-access-no-ve.md) protege.

## Consecuencias

- Renombrar un upstream cambia todos sus nombres expuestos. Es visible en el artefacto y en el diff, que es donde tiene que serlo.
- El nombre expuesto puede desbordar el límite de longitud del protocolo si un upstream y una tool son largos. No se comprueba en seco a propósito: el límite es conocimiento del protocolo, y meterlo en `policy` filtraría vocabulario de la periferia al núcleo por ahorrar un caso improbable.
- El registro de decisiones anota el nombre expuesto, no el upstream: es lo que el cliente pidió, y por tanto lo que hay que poder buscar cuando alguien pregunta qué pasó.

## Alternativas descartadas

- **El nombre desnudo, cualificando solo al colisionar.** Más bonito y hace el nombre visible función del fichero entero. Un upstream nuevo renombra tools ajenas.
- **El nombre desnudo, y que la colisión sea error de compilación.** Coherente con cómo se trata la ambigüedad de cuenta, y desproporcionado: allí lo que estaba en juego era la segunda identidad, aquí solo cómo se escribe un nombre. Además prohibiría configuraciones legítimas — dos proveedores equivalentes es el caso que el diseño persigue.
- **Un mapa de alias declarado en el artefacto.** Da control total y añade superficie de esquema, un sitio más donde equivocarse y una segunda fuente de verdad sobre nombres. Cabe añadirlo después si alguien lo pide.
