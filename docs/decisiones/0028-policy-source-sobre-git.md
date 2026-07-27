# 0028 — `PolicySource` sobre git: la versión es el sha, y se lee sin copia de trabajo

**Estado**: Vigente

## Contexto

[`../diseno/puertos.md`](../diseno/puertos.md) §2.2 prevé git como segunda implementación de `PolicySource`, "cuando la política se revisa por PR, que es el modo esperado en cuanto hay más de una persona". El contrato pide "el contenido en bruto del artefacto más una etiqueta de versión que permita saber si ha cambiado", y el adaptador de fichero cumple con un `sha256` de los doce primeros caracteres del texto.

Con git hay que decidir tres cosas que el fichero no plantea: qué es la etiqueta de versión, cómo se obtiene el contenido, y cómo se pide el origen desde la CLI.

## Decisión

**La etiqueta de versión es el sha del commit.**

**Se lee el blob del objeto, sin `checkout`**: un espejo desnudo (`git init --bare`), un `git fetch --depth 1` de la referencia declarada, y `git cat-file blob <sha>:<ruta>`.

**El origen se pide como `git+<url>#<ref>:<ruta>`**, en el mismo argumento posicional donde iría una ruta. Sin bandera nueva.

## Motivo

**Por qué el sha.** Un resumen del contenido dice *si* cambió; un sha dice **qué** cambió, quién lo aprobó y cuándo — y se puede pegar en un incidente y llegar al PR. Cumple el contrato mejor que el resumen sin ampliarlo. El adaptador de fichero se queda con el suyo porque un fichero suelto no tiene historia que ofrecer, y esa asimetría es exactamente la clase de variación que justifica que la frontera exista.

**Por qué sin copia de trabajo.** Un `checkout` deja un directorio que otro proceso puede tocar entre la lectura y la decisión, y que puede quedar sucio si un arranque se interrumpe. Leer el objeto no tiene ese hueco: el contenido que se compila es el que ese commit tiene, por definición. Además el espejo se reutiliza entre arranques —`git init` es idempotente— así que el segundo arranque no vuelve a traerse la historia.

**Por qué un solo argumento y no banderas.** Con `--repo`, `--ref` y `--path` habría que añadir las tres a los cinco comandos, y `diff` necesitaría seis. Con la forma compacta, `validate`, `explain`, `who-can`, `diff` y `serve` aceptan las dos procedencias sin que ninguno se entere: la cáscara mira si empieza por `git+` y construye un adaptador u otro. El `#` separa lo que identifica al repositorio de lo que identifica al artefacto dentro de él, y el `:` es el mismo separador que usa git en `<commit>:<ruta>`, así que la segunda mitad se lee como lo que es.

**Fallo cerrado.** Repositorio inalcanzable, referencia que no existe o fichero que no está en ese commit: los tres lanzan, con un mensaje que dice cuál de los tres fue. Ninguno produce una política vacía — sería sintácticamente válida, lo denegaría todo, y resultaría indistinguible de un fallo de infraestructura. Y se arranca con `GIT_TERMINAL_PROMPT=0`: un arranque no interactivo que se queda esperando a que un humano teclee una contraseña es peor que uno que falla.

## Consecuencias

- Se usa el binario `git`, no una biblioteca. Es la implementación mejor probada que existe y está en cualquier máquina donde esto corra (decisión [0026](0026-jose-si-cliente-de-redis-y-sdk-de-otel-no.md)).
- La autenticación con el remoto es la de git: `~/.ssh`, `credential.helper`, un token en la URL. mcpizer no la reimplementa ni la declara.
- El espejo vive bajo el temporal del sistema, derivado del nombre del repositorio. Con `--depth 1` no crece con la historia.
- La política **no se relee**: se carga al arrancar, como con un fichero. Que la referencia sea móvil (`refs/heads/main`) no la convierte en dinámica — recargar en caliente es la misma pregunta que la decisión [0025](0025-el-descubrimiento-mcp-no-autentica.md) contesta para el catálogo, y la respuesta es la misma.
- `mcpizer validate git+…` funciona, y es lo que permite validar en CI exactamente el commit que se va a desplegar.

## Alternativas descartadas

- **Clonar y leer del sistema de ficheros.** Más familiar, y deja una copia de trabajo que puede ensuciarse y una ventana entre leer y decidir.
- **Mantener el resumen del texto como versión.** Uniforme con el adaptador de fichero, y tira la única información que git aporta.
- **Banderas `--repo`, `--ref`, `--path`.** Tres banderas por comando, seis en `diff`, y ninguna ventaja.
- **Una biblioteca de git en JavaScript.** Superficie nueva para reimplementar peor lo que ya está instalado, incluida la autenticación con el remoto.
