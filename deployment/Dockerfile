# La imagen es una envoltura del artefacto, no otra forma de construirlo.
#
# La primera etapa ejecuta exactamente `node deployment/package.js`, que es lo
# mismo que ejecuta el arnés de verificación. Si la imagen construyera el
# producto por su cuenta —su propio `tsc`, su propio `npm install`— habría dos
# empaquetados y solo uno estaría comprobado, que es la forma habitual de que
# "en local funciona" sea verdad y siga sin servir de nada (decisión 0032).
#
#   docker build -f deployment/Dockerfile -t mcpizer .
#   docker run --rm -v "$PWD/examples:/politica:ro" -e MCPIZER_API_KEY=… mcpizer \
#     serve /politica/policy.yaml --catalog /politica/catalog.yaml --issuer ci \
#     --http --host 0.0.0.0 --port 8080

FROM node:22-alpine AS build

RUN corepack enable
WORKDIR /src

COPY . .
RUN pnpm install --frozen-lockfile
RUN node deployment/package.js --out /opt/mcpizer


FROM node:22-alpine

# Lo único que se le añade a la imagen base. `git+<url>#<ref>:<ruta>` es el
# origen de política esperado en cuanto se revisa por PR, y ese adaptador invoca
# al binario: sin él, la forma recomendada sería justo la que no funciona dentro
# del contenedor.
RUN apk add --no-cache git

# Y nada más. Ni el repositorio, ni pnpm, ni el compilador, ni las dependencias
# de desarrollo: lo que no viaja no hay que parchearlo.
COPY --from=build /opt/mcpizer /opt/mcpizer

# La pasarela no necesita ser nadie en particular. Sí necesita un `TMPDIR`
# escribible, que es donde el origen sobre git mantiene su espejo.
USER node
WORKDIR /opt/mcpizer

# Orientativo: el puerto lo decide `--port`, y quien publica es quien corre.
EXPOSE 8080

# Sin HEALTHCHECK, a propósito. El puerto lo elige quien arranca el contenedor,
# así que una sonda cableada aquí declararía enfermo a un proceso perfectamente
# sano en cuanto alguien pasara `--port 9000`. El contrato es la ruta `/health`
# (decisión 0034); quien la interroga configura la suya.
#
# Y `--host 0.0.0.0` es obligatorio aquí dentro, por eso mismo no es el defecto
# del programa: abrir un puerto de autorización a toda la red tiene que ser una
# decisión escrita, no lo que pasa si no se dice nada.

# SIGTERM es lo que manda un orquestador al parar, y el programa lo atiende:
# deja de aceptar, cierra las sesiones upstream y sale con 0. `ENTRYPOINT` en
# forma exec, para que la señal llegue al proceso y no a una shell que no la
# reenviaría.
STOPSIGNAL SIGTERM

ENTRYPOINT ["node", "/opt/mcpizer/dist/cli/main.js"]
CMD ["help"]
