# Platform Keycloak image: stock 26.6 server plus the platform theme JAR.
# Keycloakify is pinned in theme/package.json. Maven packs the theme JAR.
FROM node:22-bookworm AS theme
RUN apt-get update \
    && apt-get install -y --no-install-recommends maven openjdk-17-jdk-headless \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY theme/package.json theme/package-lock.json ./
RUN npm ci --ignore-scripts
COPY theme/ ./
RUN npx keycloakify sync-extensions && npm run build-keycloak-theme

FROM quay.io/keycloak/keycloak:26.6
COPY --from=theme /src/dist_keycloak/platform-theme.jar /opt/keycloak/providers/platform-theme.jar
