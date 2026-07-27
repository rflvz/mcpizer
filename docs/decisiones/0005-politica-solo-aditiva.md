# 0005 — La política solo concede; no hay reglas de denegación

**Estado**: Vigente

## Contexto

El artefacto declarativo tiene que expresar quién obtiene qué capacidades, con qué cuenta y bajo qué límites. Los sistemas de política suelen ofrecer reglas de permiso y de denegación, con alguna regla de precedencia que resuelve los conflictos: la denegación gana, o gana la más específica, o gana la última.

El invariante 3 exige fallo cerrado, y el 4 exige que toda decisión lleve motivo.

## Decisión

**Solo hay concesiones.** Se deniega por defecto y las concesiones son puramente aditivas. No existen reglas de denegación.

**La ambigüedad es error de compilación**: si dos concesiones cubren la misma capacidad para el mismo principal con **cuentas distintas**, la configuración no compila y el diagnóstico señala ambas.

## Motivo

Las denegaciones traen precedencia, la precedencia trae orden, y el orden trae la clase de fallo en la que una regla añadida al final de un fichero largo abre en silencio algo que otra cerraba doscientas líneas antes. Las revisiones no lo detectan de forma fiable, porque exige tener el fichero entero en la cabeza.

Sin denegaciones, **el resultado es independiente del orden**. Reordenar el fichero no puede cambiar ninguna decisión, y leer una concesión no obliga a comprobar que nada posterior la contradiga. El fichero significa lo que parece.

Hay una ganancia derivada que no es menor: la consulta inversa —"¿quién puede emitir facturas?"— tiene respuesta exacta y barata, porque basta recorrer las concesiones. Con precedencia, esa pregunta solo se contesta simulando, y es la pregunta que hace de verdad quien audita.

Sobre la ambigüedad: elegir en silencio significaría que la respuesta a "¿con qué cuenta se ejecutó esto?" depende de una regla que el autor no escribió y probablemente no conoce. Sobre la segunda identidad, esa opacidad es inaceptable. Fallar en compilación lo convierte en un problema de autoría, detectable en seco y por tanto en CI, que es donde el invariante 8 quiere que aparezcan estas cosas.

## Consecuencias

- **Se pierde expresividad**: no se puede decir "todo el equipo salvo Ana". La excepción se expresa estrechando el selector, lo que además deja constancia de a quién *se concede* en vez de a quién no.
- Configuraciones grandes pueden necesitar más concesiones que con denegaciones. Se acepta: son más largas y menos sorprendentes.
- Cuando varias concesiones coinciden **con la misma cuenta** no hay ambigüedad: las capacidades se unen y **gana el límite más restrictivo**, la única combinación que no puede ampliar el acceso por accidente.
- La evaluación no necesita ordenar ni resolver conflictos, lo que la hace más simple de verificar por propiedades.

## Alternativas descartadas

- **Permitir + denegar con "la denegación gana".** El modelo más común y el más seguro de los que tienen denegaciones, pero sigue haciendo que el significado de una regla dependa de todas las demás.
- **Precedencia por especificidad.** Peor: la regla que decide no está escrita en ninguna parte del fichero, y el autor tiene que conocerla de memoria.
- **Resolver la ambigüedad de cuenta por orden de aparición.** Convierte un error de autoría en comportamiento silencioso, justo sobre la segunda identidad.
