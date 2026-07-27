# 0017 — El emisor `static-key` declara sujeto y referencia a la clave, y las resuelve su propio adaptador

**Estado**: Vigente

## Contexto

[`../diseno/puertos.md`](../diseno/puertos.md) §2.1 prevé como implementación más simple de `PrincipalResolver` una "clave de API estática **declarada en el propio artefacto**". Pero el artefacto que S1 dejó no tiene dónde: un emisor `static-key` declara `id`, `kind` y `attributes`, y nada más. Faltan dos cosas — con qué clave se compara, y a quién identifica quien la presenta, porque una clave no trae sujeto consigo como lo trae un token.

Y hay una tentación cercana: ya existe un puerto que canjea referencias por material, `CredentialResolver`.

## Decisión

**Un emisor `static-key` puede declarar `subject` y `secret: { ref }`.** Los dos son **opcionales**.

**El adaptador de clave estática resuelve esa referencia por su cuenta**, sin pasar por `CredentialResolver`.

## Motivo

**Por qué en el artefacto.** Es donde vive el resto del enganche con la periferia — el `discovery` de un emisor OIDC, el transporte de un upstream, la referencia al secreto de una cuenta— y no hay motivo para que esta pieza sea la excepción. La regla del formato se respeta entera: ningún secreto en el fichero, solo referencias, así que sigue pudiendo vivir en git y revisarse por PR.

**Por qué opcionales, que es la parte contraintuitiva.** Un implementador los haría obligatorios: sin clave, el emisor no autentica a nadie. Pero [`../diseno/artefacto.md`](../diseno/artefacto.md) §1 divide el artefacto en dos mitades con garantías distintas, y dice que de la periferia la verificación en seco comprueba **solo integridad referencial**. Exigirlos haría que una política perfectamente evaluable —que contesta quién puede hacer qué, que es para lo que existe `who-can`— dejara de compilar por no declarar fontanería que esa pregunta no necesita. `discovery` es opcional en un emisor `oidc` por exactamente el mismo motivo, y ser incoherente con eso sería peor que la laxitud.

Que falten no abre nada: un emisor sin clave no autentica a nadie, que es fallo cerrado. La pasarela lo dice al arrancar, con la lista de los que sí sirven, en vez de dejar que el primer cliente se estrelle contra `issuer_unknown`.

**Por qué no `CredentialResolver`.** Ese puerto recibe "una referencia de **cuenta** opaca, **ya autorizada por una decisión**" ([`../diseno/puertos.md`](../diseno/puertos.md) §2.5). Una clave de emisor no es ninguna de las dos cosas: se consume *antes* de decidir —es lo que produce al principal sobre el que se decide— y pertenece a la primera identidad, no a la segunda. Pasarla por ese puerto colapsaría las dos identidades justo en la frontera que existe para separarlas, y además rompería la garantía que hace útil al puerto: que solo se invoque después de un permiso.

## Consecuencias

- El esquema, `examples/policy.yaml` y el bloque YAML de [`../diseno/artefacto.md`](../diseno/artefacto.md) §2 cambian juntos. No es opcional: `runtime/test/termination.test.ts` afirma que el ejemplo del documento y el del repositorio son el mismo texto, carácter a carácter.
- `CompiledIssuer` gana `subject` y `secretRef`, y con ello cambia el retrato de superficie de `policy`. Es el único que cambia, que es lo que el blast radius promete.
- La resolución de `env://` queda duplicada entre el adaptador de clave estática y el de credenciales. Es duplicación aceptada: son dos fronteras distintas que hoy comparten un esquema de URI, y unificarlas exigiría un sitio común que las volvería a acoplar.
- Un despliegue con varias identidades estáticas necesita un emisor por identidad. Es coherente mientras las claves estáticas sean lo que son —desarrollo y automatización—, y el día que no baste, lo que hace falta es OIDC, que es S3.

## Alternativas descartadas

- **La clave fuera del artefacto, en banderas de `serve` y variables de entorno.** No toca el esquema ni los documentos de diseño, y contradice `puertos.md` §2.1. Deja además el enganche declarado a medias: el upstream y la cuenta dicen dónde está su material, y el emisor no.
- **`subject` y `secret` obligatorios para `static-key`.** Fallo cerrado más visible, e incoherente con `discovery` en OIDC. Rompería toda política existente que declare un emisor estático sin fontanería, incluidas las que solo se usan para verificar en seco.
- **Reutilizar `CredentialResolver`.** Un puerto menos y las dos identidades confundidas.
