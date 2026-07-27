# El artefacto declarativo

Cierra el tercer guion de la sección 6 de [`../arquitectura.md`](../arquitectura.md), en lo relativo al formato del artefacto.

Prerrequisito de lectura: `../arquitectura.md`. Ayuda haber leído [`modelo.md`](modelo.md), pero el ejemplo se entiende sin él.

---

## 1. Dos mitades con propiedades distintas

El artefacto contiene dos cosas que suelen mezclarse y que aquí conviene separar desde el principio, porque tienen garantías diferentes:

- **La política** — capacidades, mapeos, concesiones y límites. Es **evaluable por completo en local**, sin contactar con nada. Aquí vive el invariante 8.
- **El enganche con la periferia** — cómo se alcanza cada upstream, dónde está cada secreto, qué emisor valida qué token. Solo hace falta en ejecución.

La verificación en seco **evalúa la política entera** y del enganche solo comprueba **integridad referencial**: que ninguna concesión apunte a una cuenta inexistente, que ningún mapeo apunte a un upstream no declarado. No comprueba alcanzabilidad, porque hacerlo requeriría red y rompería la propiedad que se busca.

La consecuencia práctica es la que importa: se puede responder "¿quién puede emitir facturas?" en un portátil sin credenciales, sin VPN y sin que exista ningún despliegue.

Formato: **YAML con JSON Schema**. YAML porque estos ficheros se revisan por PR y los comentarios importan; JSON Schema porque da validación estructural gratis y editores con autocompletado, y porque es el mismo vocabulario de esquemas que MCP ya usa para las tools.

---

## 2. Ejemplo completo

```yaml
version: 1

# ─────────────────────────────────────────────────────────────
# 1. CAPACIDADES — el vocabulario estable.
#    Es lo único que las concesiones pueden nombrar. Los nombres
#    de tool no aparecen en ninguna concesión, nunca: por eso
#    renombrar una tool upstream no rompe esta configuración.
# ─────────────────────────────────────────────────────────────
capabilities:
  - id: crm.contact.read
    description: Consultar fichas de contacto
  - id: crm.contact.write
    description: Crear o modificar fichas de contacto
  - id: billing.invoice.issue
    description: Emitir facturas contra un cliente

# ─────────────────────────────────────────────────────────────
# 2. UPSTREAMS — de dónde salen las tools y qué capacidad realiza
#    cada una. Este es el único punto que conoce nombres reales;
#    absorbe los renombrados y aísla al resto del fichero.
# ─────────────────────────────────────────────────────────────
upstreams:
  - id: crm-principal
    transport:
      kind: mcp-stdio
      command: crm-mcp-server
    tools:
      # Muchas tools → una capacidad. Es el caso normal.
      - name: get_contact
        capability: crm.contact.read
      - name: search_contacts
        capability: crm.contact.read
      - name: upsert_contact
        capability: crm.contact.write
      # `delete_contact` existe en el upstream y NO está aquí.
      # Por tanto no la ve nadie y no la invoca nadie. No hace
      # falta prohibirla: no declararla ya es denegarla.

  - id: facturacion
    transport:
      kind: mcp-http
      url: https://billing.internal/mcp
    tools:
      - name: create_invoice
        capability: billing.invoice.issue

# ─────────────────────────────────────────────────────────────
# 3. CUENTAS — la segunda identidad. Solo referencias.
#    Ninguna clave, ningún token, nada canjeable en este fichero:
#    por eso puede vivir en git y revisarse por PR.
# ─────────────────────────────────────────────────────────────
accounts:
  - id: crm-solo-lectura
    secret: { ref: "vault://kv/mcpizer/crm-ro" }
  - id: crm-operaciones
    secret: { ref: "vault://kv/mcpizer/crm-rw" }
  - id: facturacion-ops
    secret: { ref: "env://BILLING_OPS_KEY" }

# ─────────────────────────────────────────────────────────────
# 4. PRINCIPALES — cómo se reconoce a quien invoca y sobre qué
#    atributos puede discriminar la política.
# ─────────────────────────────────────────────────────────────
principals:
  issuers:
    - id: corp
      kind: oidc
      discovery: https://id.internal/.well-known/openid-configuration
      audience: mcpizer
      # Solo estos claims se convierten en atributos. Lo demás
      # del token se descarta: la política no puede discriminar
      # sobre algo que no esté declarado aquí.
      attributes:
        team: claim:groups
        role: claim:role

    - id: ci
      kind: static-key
      # Para desarrollo y para la propia verificación en seco.
      # Una clave estática no trae sujeto consigo como lo trae un token, así
      # que hay que declararlo. Y la clave en sí no vive aquí: como las
      # cuentas, solo su referencia.
      subject: build-agent
      secret: { ref: "env://MCPIZER_CI_KEY" }
      attributes:
        team: platform
        role: automation

# ─────────────────────────────────────────────────────────────
# 5. CONCESIONES — quién obtiene qué, con qué cuenta y con qué
#    techo. Solo hay concesiones: no existen reglas de denegación.
#    Ver §3.
# ─────────────────────────────────────────────────────────────
grants:
  - to:
      issuer: corp
      attributes: { team: ventas }
    capabilities: [crm.contact.read]
    using: crm-solo-lectura
    limits:
      calls: 500
      per: 1h

  - to:
      issuer: corp
      attributes: { team: ventas, role: manager }
    capabilities: [crm.contact.write]
    using: crm-operaciones
    limits:
      calls: 50
      per: 1h

  # Un agente automatizado. Nótese que quién invoca (el agente de
  # CI) y con qué credencial se actúa (la cuenta de facturación)
  # son dos cosas distintas y visiblemente separadas.
  - to:
      issuer: ci
      attributes: { role: automation }
    capabilities: [billing.invoice.issue]
    using: facturacion-ops
    limits:
      calls: 20
      per: 24h
```

---

## 3. Solo hay concesiones. No hay denegaciones.

**Decisión.** El artefacto no admite reglas de denegación. Se deniega por defecto y las concesiones son puramente aditivas.

El motivo es que las reglas de denegación traen precedencia, y la precedencia trae orden, y el orden trae la clase de fallo en la que una regla añadida al final de un fichero largo abre en silencio algo que otra cerraba doscientas líneas antes. Es un fallo que las revisiones no detectan de forma fiable, porque exige tener el fichero entero en la cabeza.

Sin denegaciones, el resultado es **independiente del orden**. Reordenar el fichero no puede cambiar ninguna decisión, y leer una concesión no obliga a comprobar que nada posterior la contradiga. Se pierde expresividad — no se puede decir "todo el equipo salvo Ana" — y a cambio se gana que el fichero signifique exactamente lo que parece. Para un sistema cuyo invariante 3 es el fallo cerrado, el intercambio compensa: la excepción se expresa estrechando el selector, que además deja constancia de a quién se concede en lugar de a quién no.

### Ambigüedad: error de autoría, no resolución silenciosa

Si dos concesiones cubren la misma capacidad para el mismo principal **con cuentas distintas**, la configuración es ambigua. No se resuelve por orden, ni por especificidad, ni por ninguna regla implícita: **falla en compilación**, con diagnóstico que señala las dos concesiones en conflicto.

Elegir en silencio significaría que la respuesta a "¿con qué cuenta se ejecutó esto?" depende de una regla que el autor no escribió y probablemente no conoce. Sobre la segunda identidad, esa opacidad es inaceptable.

Cuando varias concesiones coinciden **con la misma cuenta**, no hay ambigüedad: las capacidades se unen y **gana el límite más restrictivo**. Es la única combinación que no puede ampliar el acceso por accidente.

---

## 4. Verificación en seco

La superficie que hace real el invariante 8. Todo funciona sin red, sin credenciales y sin despliegue.

**Validar** — estructura contra el esquema, más los diagnósticos que el esquema no puede expresar: referencias colgantes a cuentas o upstreams, capacidades declaradas que ninguna tool realiza, capacidades usadas en concesiones pero nunca declaradas, cuentas que nadie usa, concesiones ambiguas. Es lo que corre en CI sobre el PR que toca la política.

**Explicar** — dado un principal, una capacidad y un instante, la decisión completa con su motivo y su `path`. Es el bucle de corrección del invariante 4 convertido en herramienta: se pregunta, se recibe el sitio exacto a tocar, se corrige, se vuelve a preguntar. Que el instante sea un parámetro — y no el reloj del sistema — permite preguntar por ventanas futuras sin trucos; sale directo de haber declinado el puerto `Clock`.

**Consultar al revés** — dada una capacidad, qué principales llegan a ella y con qué cuenta. Es la pregunta de auditoría real ("¿quién puede emitir facturas?") y solo tiene respuesta exacta porque no hay denegaciones ni precedencia: basta con recorrer las concesiones.

**Diferencia efectiva** — entre dos versiones del artefacto, qué decisiones cambian. Un diff de texto no lo dice; añadir un atributo a un selector es una línea y puede cortarle el acceso a un equipo entero.

### El catálogo estático

Validar el mapeo tool→capacidad requiere saber qué tools existen, y preguntárselo a los upstreams rompería la propiedad. Por eso `CatalogSource` tiene una implementación de catálogo declarado ([`puertos.md`](puertos.md) §2.3): un fichero de descriptores, **generado** desde los upstreams reales y versionable junto a la política.

Esa generación es el único momento del ciclo que toca la red, y por eso es un paso aparte: se ejecuta una vez contra los upstreams, su salida se versiona, y a partir de ahí todo lo demás vuelve a evaluarse sin red. Un catálogo al que le faltan las tools de un upstream que no contestó sería una revocación silenciosa el día que ese fichero se usara para verificar, así que un upstream caído aborta la generación en vez de producir un fichero incompleto ([0039](../decisiones/0039-el-generador-del-catalogo-declarado.md)).

Con él, la verificación en seco detecta también lo que de otro modo solo aparecería en ejecución: mapeos a tools que ya no existen, y tools nuevas que ningún mapeo cubre — que son invisibles por fallo cerrado, correctamente, pero cuya aparición conviene señalar.

---

## 5. Reglas vinculantes del formato

| Regla | Invariante |
|---|---|
| Las concesiones nombran capacidades, jamás nombres de tool | 7 |
| Ningún secreto en el artefacto: solo referencias | 6 |
| Una tool sin mapeo declarado no es visible ni invocable | 3 |
| Sin reglas de denegación; el resultado no depende del orden | 3 |
| Concesión ambigua sobre la cuenta = error de compilación | 3, 5 |
| Concesiones coincidentes con la misma cuenta: gana el límite más restrictivo | 3 |
| Quién invoca y con qué cuenta se actúa son campos distintos (`to` / `using`) | 5 |
| La política se evalúa entera sin red; del enganche solo se comprueba integridad referencial | 8 |
| Todo diagnóstico y todo motivo señalan una posición del documento | 4 |

### Los esquemas de referencia, y por qué siguen siendo referencias

`secret.ref` admite cuatro esquemas, y ninguno rompe la segunda regla de la tabla:

| Esquema | Qué nombra |
|---|---|
| `env://VARIABLE` | Una variable del entorno del proceso |
| `vault://<montaje>/<ruta>[#<campo>]` | Un secreto de la bóveda |
| `gcp-secrets://projects/<p>/secrets/<s>[/versions/<v>]` | Un secreto del gestor de la nube |
| `oauth+<url>?client=…&secret=…[&scope=…]` | Un token que se **acuña** contra ese emisor |

El cuarto es el que más cerca pasa de la regla, y por eso el secreto del cliente no está en la referencia: la referencia nombra **otra referencia**, y esa la resuelve el mismo despachador. Así el artefacto sigue sin contener nada canjeable, y el secreto del cliente puede vivir en la bóveda como cualquier otro.

Un emisor puede además declararse `kind: mtls`, y entonces sus atributos salen de componentes del nombre distinguido del certificado (`dn:O`, `dn:OU`) igual que los de uno `oidc` salen de claims. Quién verifica la cadena es el terminador TLS, no este proceso: declararlo en el artefacto **es** la decisión de confiar en lo que ese terminador reenvía ([0037](../decisiones/0037-la-identidad-de-certificado-la-verifica-el-terminador.md)).
