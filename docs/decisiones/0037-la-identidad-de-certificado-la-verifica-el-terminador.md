# 0037 — La identidad de certificado la verifica el terminador TLS, y llega por cabecera

**Estado**: Vigente

## Contexto

[`../diseno/puertos.md`](../diseno/puertos.md) §2.1 daba por prevista una tercera implementación de `PrincipalResolver`: *"subject de certificado en mTLS"*. Al escribirla aparece una contradicción con una decisión ya tomada: la [0033](0033-tls-fuera-cors-ninguno-techo-dentro.md) dejó **TLS fuera del proceso**, y sin TLS en el proceso no hay conexión de la que sacar un certificado.

Las dos salidas eran reabrir 0033 —terminar TLS aquí, con almacén de certificados y recarga en caliente— o aceptar que en un despliegue real con mTLS quien verifica la cadena es el terminador, y que lo que llega aquí es el **resultado** de esa verificación.

## Decisión

**Se acepta lo segundo.** Un emisor `kind: mtls` toma la identidad del nombre distinguido que el terminador TLS reenvía en una cabecera. Se admiten las dos formas con que los terminadores lo mandan: la cabecera `XFCC` de Envoy y un nombre distinguido a secas.

El nombre común es el sujeto. Los atributos salen de componentes declarados con `dn:<componente>`, igual que los de un emisor `oidc` salen de `claim:<nombre>`.

**La frontera de confianza no se disimula**: este adaptador cree lo que le llega por esa cabecera.

## Motivo

**Por qué no reabrir 0033.** Los motivos de aquella decisión no han cambiado: el ciclo de vida de un certificado es un hecho del despliegue, y terminar TLS aquí obligaría a montar almacén y recarga en caliente para hacer peor lo que toda plataforma ya hace. Y hay uno nuevo: en un despliegue con malla de servicios, mTLS lo termina la malla *por diseño*. Un proceso que insistiera en terminarlo él sería el que no encaja.

**Qué se pierde, dicho sin rodeos.** Se pierde que la verificación sea criptográfica *en este proceso*. Lo que sostiene la identidad pasa a ser la posición en la red: que el proceso solo sea alcanzable a través del terminador, y que el terminador **borre** cualquier cabecera del mismo nombre que traiga el cliente. Ninguna de las dos cosas la puede comprobar el código de aquí.

Por eso hay tres cosas que la hacen explícita en vez de implícita: el defecto de `--host` es la interfaz de bucle, hay que nombrar la cabecera a mano con `--key-header`, y el emisor tiene que declararse `kind: mtls` **en el artefacto**, que se revisa por PR. Declararlo *es* la decisión de confiar.

**Por qué el nombre común es el sujeto, y no se puede elegir otro.** Elegirlo obligaría a un campo nuevo en el artefacto, y la decisión [0029](0029-discovery-y-audience-salen-del-documento.md) dejó anotado que un tercer campo de enganche obligaría a revisar cómo se leen. `CN` es *el* componente de identidad por convención universal; inventar la opción antes de que alguien la necesite es la abstracción anticipada que la sección 2.5 prohíbe.

**Por qué un componente repetido no produce atributo.** `OU` repetido es normal en un certificado real. Quedarse con uno decidiría por sorteo qué política se aplica. Es exactamente el argumento de la decisión [0024](0024-claims-multivaluados.md) para los claims multivaluados, y la consecuencia es la misma: el atributo no se produce, y como el selector es una conjunción de igualdades, eso deniega por construcción.

## Consecuencias

- Un despliegue que exponga el puerto sin terminador delante y declare un emisor `mtls` deja que cualquiera se presente como cualquiera. Es la peor configuración posible del sistema, y por eso los tres frenos de arriba son explícitos.
- Este adaptador no distingue `credential_expired`: un certificado caducado lo rechaza el terminador, y aquí no llega. Los otros tres motivos sí se distinguen.
- Hay dos capas de escapado —la cabecera entrecomilla el nombre distinguido, y el nombre distinguido escapa sus comas— y solo se deshace la de fuera. Deshacer las dos convertiría `CN=Apellido\, Nombre` en dos componentes.

## Alternativas descartadas

- **Terminar TLS en el proceso y leer el certificado de la conexión.** Reabre 0033 sin motivo nuevo, y no encaja en el despliegue donde mTLS es más común: el que ya tiene una malla que lo termina.
- **Fijar el certificado por huella, declarada en el artefacto.** Duplicaría en el artefacto la confianza que el terminador ya administra, y obligaría a tocar el artefacto en cada rotación de certificado — que es justo lo que mTLS bien hecho automatiza.
- **Aceptar la cabecera solo si viene de una IP declarada.** Suena a defensa y no lo es: quien puede poner la cabecera casi siempre puede poner también la dirección de origen. La protección real es que el puerto no sea alcanzable, no una lista.
