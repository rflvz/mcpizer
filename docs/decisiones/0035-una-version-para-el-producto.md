# 0035 — Una versión para el producto; los siete paquetes siguen privados y sin versionar

**Estado**: Sustituida en parte por [0041](0041-se-publican-los-siete-y-el-producto-se-llama-mcpizer.md), que publica los siete y les da la misma versión. Lo demás sigue vigente.

## Contexto

Los siete paquetes nacieron `private: true` y `0.0.0`, y así llegaron al final de S3. Mientras el repositorio solo se ejecutaba desde el árbol de trabajo daba igual. En cuanto existe un artefacto que se despliega, deja de dar igual: la primera pregunta de cualquier incidencia es **qué build está corriendo**, y `0.0.0` no la contesta nunca.

## Decisión

**El producto tiene una versión.** Empieza en `0.1.0` — la primera que se puede desplegar — y vive en dos manifiestos que tienen que decir lo mismo: el de la raíz, que es el que ve quien abre el repositorio, y el de `runtime/`, que es el que viaja dentro del artefacto.

**Los siete paquetes siguen `private: true`.** Sus versiones internas no significan nada y no se tocan.

`mcpizer version` lee la del manifiesto que acompaña al programa.

## Motivo

**Por qué `0.1.0` y no `0.4.0`.** Numerar por sesión cerrada sería inventar retroactivamente un esquema que nadie siguió en S1, S2 ni S3. `0.1.0` dice lo que de verdad ocurrió: es la primera versión que se puede desplegar.

**Por qué la lee del manifiesto y no está cableada.** Un número en el código dice la verdad hasta el primer despliegue en que alguien olvide tocarlo. El manifiesto es el mismo fichero en el árbol de trabajo y dentro del artefacto, así que el programa contesta lo mismo en los dos sitios sin que nadie tenga que sincronizar nada.

**Por qué dos manifiestos y una comprobación en vez de uno solo.** El artefacto hereda el manifiesto de `runtime/` ([0030](0030-el-artefacto-desplegable-es-el-cierre-de-runtime.md)), así que es ese el número que acaba imprimiendo el proceso desplegado; y la raíz es lo primero que alguien mira. Que se separen no rompe nada visible, y por eso el empaquetado se niega a producir un artefacto si no coinciden — con su caso de fallo, porque una comprobación que nunca ha fallado no está verificada.

**Por qué siguen privados.** Publicarlos convertiría las superficies internas de los cinco contextos en API de terceros, y el blast radius —hoy cero por construcción— pasaría a depender de quién haya instalado qué. El producto es una pasarela que se despliega, no una biblioteca que se importa.

## Consecuencias

- Subir de versión es tocar dos ficheros. El empaquetado falla si solo se toca uno, que es exactamente el descuido que se quiere atrapar.
- La versión viaja además en el saludo MCP: un cliente que se conecte sabe con qué habla, y aparece en la sonda de salud y en el anuncio de arranque por stderr.
- No hay publicación automática ni etiquetas de versión gobernadas por CI. Cuando exista un canal de distribución real, esa será la decisión a tomar; hoy no lo hay, y automatizar una publicación que nadie consume sería andamiaje.
- `mcpizer version` imprime también la versión de Node, porque el artefacto no la lleva dentro y es la otra mitad de "qué está corriendo".

## Alternativas descartadas

- **Dejar todo en `0.0.0`.** Deja sin responder la primera pregunta de una incidencia, para siempre.
- **Versionar los siete paquetes a la vez.** Seis números que nadie lee y que hay que mantener sincronizados, para paquetes que no se publican.
- **Sellar el commit en el artefacto durante el empaquetado.** Ata el empaquetado a que exista un repositorio git en el directorio, lo que rompe construir desde una copia exportada, y hace que dos artefactos idénticos difieran. Si hace falta trazar el commit, lo pone quien construye, en la etiqueta de la imagen.
- **Publicar en un registro con versión sincronizada.** Ver [0030](0030-el-artefacto-desplegable-es-el-cierre-de-runtime.md): expone superficies internas y no responde a ningún consumidor real.
