# syntax=docker/dockerfile:1
# Image unique : le serveur de jeu Node sert aussi le client construit (dist/) et /ws.
# Construction : docker build -t paris-manif-3d .
# (si Docker Hub limite les téléchargements : --build-arg IMAGE_NODE=mirror.gcr.io/library/node:22.23.4-alpine)
# Derrière un proxy TLS d'entreprise : --secret id=ca_npm,src=/chemin/ac.pem (facultatif, non copié dans l'image)
# Exécution    : docker run --rm -p 8080:8080 -e PM3D_ORIGINES=https://votre-domaine paris-manif-3d
ARG IMAGE_NODE=node:22.23.4-alpine

FROM ${IMAGE_NODE} AS construction
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN --mount=type=secret,id=ca_npm,required=false \
    if [ -f /run/secrets/ca_npm ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca_npm; fi; \
    npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm run serveur:build

FROM ${IMAGE_NODE} AS execution
ENV NODE_ENV=production \
    PM3D_PORT=8080 \
    PM3D_HOTE=0.0.0.0 \
    PM3D_STATIQUE=/app/dist
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN --mount=type=secret,id=ca_npm,required=false \
    if [ -f /run/secrets/ca_npm ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca_npm; fi; \
    npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=construction /app/dist ./dist
COPY --from=construction /app/dist-serveur ./dist-serveur
USER node
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/sante > /dev/null || exit 1
CMD ["node", "dist-serveur/index.js"]
