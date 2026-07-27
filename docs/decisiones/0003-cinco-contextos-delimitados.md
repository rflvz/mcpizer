# 0003 — Cinco contextos delimitados

**Estado**: Vigente

## Contexto

La sección 3 de la arquitectura deja fuera la lista de contextos a propósito, y exige que las fronteras existan, estén explicitadas de forma comprobable y no obliguen a un modelo único compartido.

El riesgo es simétrico. Pocos contextos y el vocabulario se mezcla hasta que "identidad" significa dos cosas en el mismo fichero. Muchos y aparece la ceremonia que la sección 2.5 rechaza: fronteras que hay que atravesar constantemente y que no separan nada real.

## Decisión

**Cinco**: `principals`, `capabilities`, `accounts`, `access`, `policy`.

## Motivo

Los tres primeros son las tres partes de la frase que define el dominio en la sección 2.1 — dado un principal y una invocación, qué tools ve, contra qué cuenta se ejecuta y bajo qué límites. `access` es la decisión. `policy` es el artefacto que la gobierna.

El criterio de corte fue el vocabulario, no el tamaño. Dos capacidades son contextos distintos cuando un mismo término significa cosas distintas en cada una, que es exactamente el test que propone la sección 3.

**`principals` y `accounts` separados** es la decisión que más carga soporta. Ambos son "identidades", y ese es justo el motivo para separarlos: si compartieran contexto compartirían vocabulario, y colapsar las dos identidades pasaría de imposible a meramente desaconsejado. Con la regla de 0004 encima —no se importan y no comparten tipo—, fusionarlos exige fusionar paquetes, que es un cambio visible en revisión y no un descuido. Es el invariante 5 convertido en estructura.

**`policy` fuera de `access`** por el mismo test. `policy` habla de documentos, reglas, posiciones en un fichero y errores de autoría; `access` habla de decisiones, concesiones y motivos. Un resultado de `policy` es "esta concesión referencia una cuenta que no existe"; uno de `access` es "denegado porque ninguna concesión cubre esta capacidad". Además `policy` es lo que sostiene el invariante 8: la configuración se verifica entera sin desplegar porque autoría y evaluación están separadas.

## Consecuencias

- Los cinco son paquetes independientes que no se importan entre sí (ver 0004). El coste es traducción en composición.
- Los límites **no** son un contexto propio: se declaran en `policy`, se evalúan en `access` y se hacen cumplir en la cáscara. Un contexto para ellos habría sido la ceremonia que 2.5 rechaza.
- La auditoría tampoco es un contexto: `access` produce el motivo y la periferia lo registra.

## Alternativas descartadas

- **Un único contexto de dominio.** Más simple hoy, pero deja el invariante 5 dependiendo de la disciplina de quien escriba el código.
- **`identity` unificando principales y cuentas.** Descartada por el invariante 5; ver arriba y [`../diseno/modelo.md`](../diseno/modelo.md) §1.
- **`policy` dentro de `access`.** Forzaría un vocabulario común entre autoría y evaluación, que es el fallo que la sección 3 describe.
- **Contextos separados para límites y auditoría.** Ceremonia sin frontera real detrás.
