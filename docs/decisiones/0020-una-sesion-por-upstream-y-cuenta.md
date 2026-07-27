# 0020 — Una sesión de upstream por `(upstream, cuenta)`

**Estado**: Vigente

## Contexto

`ToolInvoker` sobre MCP por stdio arranca el upstream como proceso hijo y habla con él por sus descriptores. Arrancar un proceso por invocación es caro, así que la sesión pide cachearse.

La pregunta es por qué clave. Lo natural sería por upstream: un proceso por proveedor, reutilizado por todos.

## Decisión

**La clave es el par `(upstream, cuenta)`.** El material se inyecta al hijo por entorno al arrancarlo, en la variable `MCP_UPSTREAM_CREDENTIAL`, y el hijo recibe solo esa variable y `PATH`.

## Motivo

En stdio la credencial viaja en el arranque del proceso, no en cada mensaje. Un proceso por upstream se arrancaría con la credencial de **la primera cuenta que llegara**, y todas las invocaciones posteriores —de cualquier principal, contra cualquier cuenta autorizada— se ejecutarían con ella. La decisión diría `crm-solo-lectura` y el upstream estaría usando `crm-operaciones`.

Eso no es una fuga de rendimiento: es la separación de las dos identidades rota en el último metro, después de que todo el diseño la haya sostenido. Y sería invisible desde dentro, porque el registro anotaría la cuenta que la decisión nombró.

La clave compuesta es la única que evita elegir entre eso y arrancar un proceso por llamada. Cuesta un proceso por combinación realmente usada, que en un despliegue con dos cuentas por proveedor son dos.

Al hijo se le pasa un entorno mínimo por el mismo motivo: heredar el del padre le entregaría las variables donde viven las credenciales de **todas** las demás cuentas declaradas. La cuenta autorizada da acceso a su material, no al de sus vecinas.

## Consecuencias

- Los procesos hijos viven mientras vive la pasarela, y `close()` los cierra todos. No hay caducidad ni límite de sesiones: si un despliegue declara muchas cuentas por upstream, hará falta, y es trabajo con la variación delante.
- Una sesión que no llega a arrancar no se cachea. Si se cacheara la promesa fallida, un upstream que estuvo caído un segundo lo estaría para siempre.
- Con HTTP (S3) esto se simplifica: la credencial va por cabecera en cada petición y una sola conexión sirve a todas las cuentas. El contrato del puerto no cambia — `account` sigue estando en la llamada, y ese adaptador simplemente no lo necesitará para aislar.

## Alternativas descartadas

- **Una sesión por upstream.** La mitad de procesos y la segunda identidad colapsada en el borde. Es la que un implementador escribe sin pensarlo.
- **Un proceso por invocación.** Correcto y con el coste de arrancar un intérprete por llamada. Se descarta por precio, no por diseño; si la caché diera problemas, es el sitio al que volver.
- **Multiplexar cuentas sobre una sesión pasando la credencial en los argumentos de cada tool.** Ensucia el esquema de entrada de todas las tools y pone material canjeable en el mismo sitio que los datos del usuario, que es donde más fácil acaba en un registro.
