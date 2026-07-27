# 0031 — El empaquetado vive en `deployment/`, un directorio de primer nivel sin manifiesto

**Estado**: Vigente

## Contexto

El empaquetado necesita un sitio: un guion que construya el artefacto y un `Dockerfile` que lo envuelva. Las decisiones [0009](0009-donde-viven-la-cli-y-el-arnes.md) y [0015](0015-donde-vive-la-pasarela.md) cierran la puerta a lo más obvio — **no hay un octavo paquete** —, y la sección 2.2 de la arquitectura exige que el primer nivel se lea como el dominio y no como el andamiaje.

Quedaban tres sitios posibles: la raíz a pelo, dentro de `runtime/`, o un directorio nuevo.

## Decisión

**Un directorio de primer nivel, `deployment/`, sin `package.json`.** Contiene el guion de empaquetado y el `Dockerfile`.

Sigue sin haber octavo paquete: un directorio sin manifiesto no es un paquete del workspace, igual que [`../../verification/`](../../verification/) y [`../../examples/`](../../examples/).

## Motivo

**Por qué no dentro de `runtime/`.** El empaquetado no es del paquete que se empaqueta: opera sobre el workspace entero —compila los siete, y el contexto de construcción de la imagen es la raíz— y su resultado es el producto, no una parte de él. Meterlo dentro de `runtime/` haría que un paquete supiera cómo se despliega el repositorio que lo contiene, que es la dirección equivocada.

**Por qué no en la raíz a pelo.** El `Dockerfile` sí es convencional en la raíz, pero el guion de empaquetado suelto arrancaría la acumulación de ficheros sin dueño que la sección 2.2 quiere evitar. Con un directorio, los dos ficheros tienen sitio y el que llegue después también.

**Por qué `deployment` es un nombre honesto.** El primer nivel ya distingue las cinco capacidades del dominio de lo que honestamente es periferia: `adapters/`, `runtime/`, `verification/`. `deployment/` cae en ese segundo grupo con el mismo argumento con que la decisión [0009](0009-donde-viven-la-cli-y-el-arnes.md) justificó `verification/`: nombra lo que hace, no una capa técnica genérica. No es `scripts/`, ni `ops/`, ni `tools/` — esos sí serían cajones.

**Y sin manifiesto por una razón comprobable**, no estética: [`../../verification/checks/declared-surface.test.ts`](../../verification/checks/declared-surface.test.ts) afirma que los paquetes del workspace son exactamente siete, y descubre paquetes por la presencia de `package.json`. Un directorio con manifiesto tendría que declarar superficie pública, entrar en las reglas de frontera y aparecer en cuatro sitios más. Un guion de empaquetado no tiene superficie pública que declarar.

## Consecuencias

- `deployment/**/*.js` entra en la configuración de ESLint que otorga globales de plataforma, y en el `include` de la comprobación de tipos. Es cáscara, como `verification/` y la CLI.
- El arnés **importa** `deployment/package.js` en vez de reimplementar el empaquetado, para que la comprobación construya el mismo artefacto que se construye a mano.
- `deployment/dist/` es el destino por defecto y ya está ignorado por el patrón `dist/` del `.gitignore`.
- Si algún día el empaquetado necesitara código compartido con los paquetes, la señal será esa y habrá que revisar esta decisión, no añadir un import que cruce la frontera.

## Alternativas descartadas

- **Un octavo paquete `packaging`.** Contradice dos decisiones cerradas, que es de lo poco que [`../sesiones.md`](../sesiones.md) §3 manda escalar en vez de decidir.
- **`scripts/` o `ops/`.** Cajones por definición. La lista de nombres técnicos prohibidos no los incluye, pero el argumento de la sección 2.2 no depende de que la lista sea exhaustiva.
- **Todo en la raíz.** Funciona hoy con dos ficheros y deja de funcionar con cinco.
