# 0042 — Publicar exige una licencia, y elegirla no es una decisión de diseño

**Estado**: Vigente en su regla —publicar sigue exigiendo licencia—. La elección que dejaba abierta la cerró el dueño en [0044](0044-la-licencia-es-mit.md): MIT.

## Contexto

Los siete manifiestos no declaran `license`, y el repositorio no tiene fichero de licencia. Mientras nada se publicaba daba igual. Publicar lo cambia: un paquete sin licencia declarada es, por defecto, un paquete que nadie tiene permiso para usar.

Y npm no ayuda a corregirlo después. Una versión publicada no se edita; se sucede. Quien instaló `mcpizer@0.1.0` sin licencia se quedó con esa.

## Decisión

**`deployment/publish.js` se niega a publicar si algún manifiesto no declara `license`.** No es un aviso: es una de las cinco negativas, al mismo nivel que un `private` olvidado.

**Y esta sesión no elige ninguna.** El repositorio queda listo para publicar salvo por eso.

## Motivo

El corolario de la sección 1 de la arquitectura dice que, ante una pregunta que la documentación no contesta, la respuesta por defecto es **decidir y dejar constancia**, no preguntar. Esto es una de las pocas excepciones legítimas, y conviene decir por qué lo es en vez de aplicarlo por prudencia genérica.

La regla existe para que una sesión larga no se detenga ante huecos de diseño. Una licencia no es un hueco de diseño: es una cesión de derechos del dueño del repositorio a terceros, no se deriva de ningún invariante, y **no se puede revertir** sobre lo ya distribuido. Ninguna de las tres cosas es cierta de las otras cuarenta decisiones de este registro.

Y hay una razón práctica que apunta al mismo sitio: elegir mal aquí es peor que no elegir. Una permisiva y una copyleft producen productos distintos —quién puede integrarlo y en qué—, y esa diferencia la nota el dueño, no el diseño.

**Por qué bloquea en vez de avisar.** Un aviso en la salida de un guion que se ejecuta una vez cada varias semanas se lee la primera vez. El único momento en que esto importa es el momento en que alguien está publicando; ahí es donde tiene que estar la negativa.

## Consecuencias

- `node deployment/publish.js` en este repositorio imprimió siete negativas idénticas hasta [0044](0044-la-licencia-es-mit.md), y salía con 1. Era el estado correcto: decía exactamente qué faltaba.
- La comprobación de instalación afirmaba que **lo único** que faltaba era la licencia — `problemas` sin las de `license` tenía que estar vacío—, para que el día que se eligiera publicar fuera un solo paso. Lo fue: 0044 quitó el filtro y la afirmación pasó a ser que no falta nada.
- Añadir la licencia es tocar los siete manifiestos y dejar el fichero en la raíz. La comprobación de alineación de versiones ya obliga a tocarlos juntos.

## Alternativas descartadas

- **Elegir MIT y seguir.** Es lo que haría casi todo el mundo, y es lo que el dueño acabó eligiendo — preguntado, que es la diferencia que esta decisión defiende. Sigue sin ser de quien escribe el código: es del dueño del repositorio, y una elección irreversible tomada por comodidad es exactamente el tipo de decisión que este registro existe para no tomar en silencio.
- **Publicar sin `license` y añadirla en la siguiente versión.** Deja una versión publicada que nadie puede usar legalmente, para siempre, y con el aspecto de estar disponible.
- **Avisar en vez de bloquear.** Un aviso en un guion es una nota adhesiva en la pantalla de otro.
