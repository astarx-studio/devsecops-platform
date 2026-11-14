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

FROM quay.io/keycloak/keycloak:26.6 AS keycloak-bins

FROM eclipse-temurin:17-jdk-jammy AS email-sender
WORKDIR /src
COPY --from=keycloak-bins /opt/keycloak/lib/lib/main/org.keycloak.keycloak-server-spi-26.6.0.jar /deps/spi.jar
COPY --from=keycloak-bins /opt/keycloak/lib/lib/main/org.keycloak.keycloak-server-spi-private-26.6.0.jar /deps/spi-private.jar
COPY --from=keycloak-bins /opt/keycloak/lib/lib/main/org.keycloak.keycloak-core-26.6.0.jar /deps/core.jar
COPY email-sender/ /src/
RUN mkdir -p /out/META-INF/services \
    && javac --release 17 -encoding UTF-8 -cp "/deps/*" -d /out $(find /src/src -name '*.java') \
    && cp /src/META-INF/services/org.keycloak.email.EmailSenderProviderFactory /out/META-INF/services/ \
    && jar cf /personal-inbox-email.jar -C /out .

FROM quay.io/keycloak/keycloak:26.6
COPY --from=theme /src/dist_keycloak/platform-theme.jar /opt/keycloak/providers/platform-theme.jar
COPY --from=email-sender /personal-inbox-email.jar /opt/keycloak/providers/personal-inbox-email.jar
