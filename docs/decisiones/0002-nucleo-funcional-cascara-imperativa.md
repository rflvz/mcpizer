# 0002 — El núcleo no llama a puertos: es una función

**Estado**: Vigente

## Contexto

Dos invariantes de la sección 4 entran en tensión bajo la lectura habitual de hexagonal:

- **1**: el núcleo no conoce la periferia; la dependencia apunta hacia dentro.
- **2**: el núcleo es determinista y puro; sin reloj, sin red, sin aleatoriedad, sin E/S.

En hexagonal canónico el dominio declara puertos y *los llama*: pide la hora a un `Clock`, pide contadores a un `UsageStore`. La dependencia sigue apuntando hacia dentro, así que el invariante 1 se cumple. Pero el dominio ya no es determinista: depende de lo que devuelvan esas llamadas, y probarlo exige dobles.

La sección 5 zanja la ambigüedad al exigir que "el dominio se ejecuta sin dobles de infraestructura ni entorno". Esa formulación descarta la lectura canónica.

## Decisión

**El núcleo no invoca nada. Es una función de datos a datos.**

La cáscara —periferia y composición— reúne los hechos mediante puertos, invoca la decisión y ejecuta el efecto. Los puertos los declara `runtime/`, no el dominio.

## Motivo

Es la única forma de que ambos invariantes se cumplan a la vez. No debilita hexagonal: lo hace más estricto. Las dependencias siguen apuntando hacia dentro, y además desaparece la inversión de control en el núcleo, porque no queda control que invertir.

## Consecuencias

- **El tiempo es dato de entrada.** No existe un puerto `Clock`; el instante entra en la invocación como un hecho.
- **El estado de límites es dato de entrada.** El núcleo recibe contadores, no los consulta. Decidir qué techo aplica es suyo; incrementar y persistir es de la cáscara.
- **Los puertos viven en la frontera de composición**, no en el dominio ([`../diseno/puertos.md`](../diseno/puertos.md) §1).
- **El núcleo se prueba sin un solo doble.** Eso convierte la pureza en algo observable: si un test del dominio necesita un mock, el invariante está roto.
- **La verificación en seco sale casi gratis.** Como `at` es un parámetro y no el reloj del sistema, se puede evaluar la política en cualquier instante, incluido uno futuro. El invariante 8 se deriva de haber respetado el 2.
- **Coste**: la cáscara tiene que saber qué hechos hará falta *antes* de decidir. Reúne alguna cosa que a veces no se usa. Es un coste real y se acepta.

## Alternativas descartadas

- **Hexagonal canónico con puertos llamados desde el dominio.** Rompe el invariante 2 y la exigencia explícita de la sección 5 de probar el dominio sin dobles.
- **Puerto `Clock` con implementación fija en tests.** Es exactamente el doble que la sección 5 usa como señal de fallo, y además haría que la verificación en seco de ventanas futuras necesitara manipular el reloj.
