# Modelo de datos

Cierra el tercer guion de la sección 6 de [`../arquitectura.md`](../arquitectura.md), en lo relativo a modelo de datos.

Prerrequisito de lectura: `../arquitectura.md`. Este documento se sostiene solo; [`contextos.md`](contextos.md) explica por qué los tipos no se comparten entre contextos.

Las formas que siguen fijan **semántica**, no sintaxis. Los nombres y la expresión concreta son del agente implementador; lo vinculante es qué información contiene cada concepto y, sobre todo, cuál no puede contener.

---

## 1. Las dos identidades

Se describen juntas y primero porque el invariante 5 es la propiedad que más fácilmente se pierde al escribir código, y verlas enfrentadas deja claro que no son intercambiables.

```
Principal                          AccountRef
  id            identificador        id        asa opaca
  attributes    pares clave-valor
                para selección
```

**`Principal` — quién invoca.** Un identificador y un conjunto de atributos sobre los que la política discrimina: equipo, rol, entorno, tipo de cliente. Los atributos son datos ya normalizados por el contexto `principals`; el núcleo no sabe si vinieron de un token o de un certificado, y no debe saberlo.

Un `Principal` **nunca contiene material de credencial**. Ni el token del que salió, ni un hash, ni una huella. Ya está autenticado cuando llega: la prueba de identidad se consumió en el borde y no viaja hacia dentro.

**`AccountRef` — contra qué cuenta se ejecuta.** Un asa. No una credencial, ni una envoltura de credencial, ni algo de lo que se pueda derivar una. Su único poder es que `CredentialResolver` sabe canjearla, y eso solo ocurre en la periferia y solo después de que una decisión lo permita.

**Por qué no comparten forma.** Ambas son "identidades" y la tentación de un tipo `Identity` común es real. Se rechaza: en cuanto existe ese tipo, un parámetro que espera una identidad acepta las dos, y el compilador deja de distinguir entre "el agente de Ana" y "la cuenta de facturación que el agente de Ana puede usar". El invariante 5 pasaría de estructural a convencional. Están además en contextos separados que no se importan, así que ni siquiera hay un sitio donde ese tipo común pudiera vivir.

---

## 2. Capacidades y tools

```
Capability                         ToolDescriptor
  id      identificador estable      upstreamId   de qué servidor viene
                                     name         cómo se llama allí
                                     inputSchema  qué acepta
                                     capability   qué capacidad realiza
```

**`Capability`** es el término en el que se escribe la política, y el mecanismo del invariante 7. Su identificador es estable por contrato: renombrar una tool upstream cambia un `ToolDescriptor`, nunca una `Capability`.

**`ToolDescriptor`** describe una tool real y declara qué capacidad realiza. **El mapeo es de muchas a una**: varias tools, incluso de upstreams distintos, pueden realizar la misma capacidad. Esa multiplicidad es el objetivo, no un efecto colateral — es lo que permite sustituir un proveedor por otro sin tocar ninguna concesión.

Una tool sin capacidad declarada **no es visible ni invocable**. No es un caso de error de configuración que haya que recordar comprobar: es fallo cerrado (invariante 3) aplicado al catálogo. Un upstream que añade una tool nueva no la expone a nadie hasta que alguien declara qué capacidad realiza.

---

## 3. La entrada de la decisión

Todo lo que el núcleo necesita, ya reunido por la cáscara. No hay nada más: si algo no está aquí, el núcleo no lo puede consultar.

```
Invocation
  principal    quién invoca
  capability   qué pretende hacer
  at           instante, como dato
  usage        uso acumulado, como dato
  arguments    qué le pasa a la tool (opcional)
```

**`at` y `usage` son hechos inyectados, no consultas.** Es la consecuencia directa de declinar `Clock` y de que el estado de límites entre como dato ([`puertos.md`](puertos.md) §3). Junto con `policy` compilada, hacen que la evaluación sea una función pura: mismos valores, misma decisión, siempre, y sin un solo doble en los tests.

Un efecto secundario que conviene ver: como `at` es un parámetro, la verificación en seco puede preguntar "¿qué pasaría el 1 de enero a las 3?" sin manipular el reloj de nadie. El invariante 8 sale casi gratis de haber respetado el invariante 2.

**`arguments` es opcional** porque hay dos preguntas distintas y solo una los tiene. Ver §5.

---

## 4. La decisión

```
Decision
  outcome     allow | deny
  reason      SIEMPRE presente
  accountRef  solo si allow
  limits      solo si allow
```

**`reason` es obligatorio en ambos resultados.** El invariante 4 dice "toda decisión lleva motivo", no "toda denegación". Un permiso sin motivo no se puede auditar: la pregunta "¿por qué este agente pudo usar esta cuenta?" es tan importante como su contraria, y el registro de auditoría necesita ambas respuestas.

**`accountRef` solo existe en un permiso.** Que la referencia de cuenta sea inalcanzable en una denegación debe ser estructural — imposible de leer, no meramente `null` y confiando en que nadie lo mire. Es el punto donde el modelo puede impedir que una denegación acabe ejecutándose contra una cuenta por un descuido.

### 4.1 `Reason`

```
Reason
  code     término de un vocabulario cerrado
  path     dónde, en el artefacto, se originó
  subject  a qué se refiere (opcional)
```

Estructurado, nunca cadena libre. Un motivo es un dato que se consume, no un mensaje que se lee.

**`code` pertenece a un vocabulario cerrado.** "Ninguna concesión cubre esta capacidad", "la concesión existe pero el límite está agotado", "la cuenta está revocada", "la capacidad no la realiza ninguna tool declarada". Cerrado significa que un consumidor puede ramificar exhaustivamente sobre los motivos y saber que no le va a llegar uno que no contempla.

**`path` es la parte que hace útil todo esto.** Apunta al lugar del artefacto declarativo que produjo el resultado — la concesión concreta que permitió, o la ausencia concreta que denegó. Es lo que convierte "denegado" en "denegado, y el sitio a tocar es este".

Ese es exactamente el bucle de corrección que menciona el invariante 4: quien configura el sistema — persona o agente — recibe una denegación, va al punto señalado, corrige y vuelve a verificar en seco, sin desplegar y sin adivinar. Un motivo sin `path` deja al configurador buscando a ciegas, y una configuración que solo se puede depurar desplegándola incumple el invariante 8 en la práctica aunque lo cumpla en la teoría.

**`path` nunca contiene material sensible.** Señala posiciones en un documento declarativo, que por diseño solo tiene referencias.

### 4.2 `Limits`

Los techos que acompañan a un permiso: cuántas invocaciones, en qué ventana, con qué caducidad. Son **salida** de la decisión, no entrada — el núcleo determina qué techo aplica, y la cáscara lo hace cumplir y actualiza los contadores mediante `UsageWriter`.

La comprobación de si el uso *ya* excede el techo sí ocurre dentro, con el `usage` recibido. Lo que ocurre fuera es la escritura.

---

## 5. Una evaluación, dos preguntas

El dominio contesta dos preguntas que parecen distintas y no lo son:

**"¿Qué tools ve?"** — el `tools/list` de MCP. Para cada capacidad conocida, ¿existe un permiso para este principal? Las que sí, se traducen a sus `ToolDescriptor` y se devuelven. Las que no, **no aparecen**: no salen marcadas como prohibidas, no salen en absoluto. Lo no concedido no se anuncia (invariante 3).

**"¿Puede ejecutar esta?"** — el `tools/call` de MCP. La misma evaluación sobre una única capacidad, esta vez con `arguments` y con `usage` cargado, porque los límites solo tienen sentido cuando hay algo que consumir.

**Es la misma función.** La visibilidad no es un filtro aparte que haya que mantener sincronizado con la autorización; es la misma decisión aplicada a cada capacidad. Que fueran dos rutas distintas es el origen clásico del fallo en que una tool se oculta pero sigue siendo invocable si el cliente adivina su nombre. Aquí ese fallo no puede ocurrir por construcción, y no por acordarse de comprobarlo en los dos sitios.

Una consecuencia que conviene aceptar de forma consciente: **que una tool sea visible no garantiza que la siguiente llamada se permita.** Los límites pueden haberse agotado entre una pregunta y otra. Es correcto — la alternativa sería consultar contadores al listar, lo que haría el listado dependiente de estado volátil y mucho más caro, a cambio de una garantía que de todas formas caduca en el instante siguiente.

---

## 6. Lo que el modelo hace imposible

Resumen de las prohibiciones, que son la parte vinculante:

| Prohibición | Invariante |
|---|---|
| `Principal` no contiene credencial, ni hash, ni huella | 6 |
| `AccountRef` es opaca; nada canjeable cruza al núcleo | 6 |
| No existe un tipo común a `Principal` y `AccountRef` | 5 |
| `accountRef` es inalcanzable en una denegación | 3 |
| Una tool sin capacidad declarada no es visible ni invocable | 3, 7 |
| `reason` está presente también al permitir | 4 |
| `reason` es estructurado y su `code` pertenece a vocabulario cerrado | 4 |
| El núcleo no consulta hora ni contadores: los recibe | 2 |
| La política referencia capacidades, nunca nombres de tool | 7 |
