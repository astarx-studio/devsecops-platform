# -- Base --
FROM node:20-alpine AS base
WORKDIR /app

# -- Build --
FROM base AS build
COPY package.json package-lock.json* pnpm-lock.yaml* ./
RUN if [ -f pnpm-lock.yaml ]; then corepack enable && pnpm install --frozen-lockfile; \
    else npm ci; fi
COPY tsconfig.json nest-cli.json ./
COPY src/ src/
RUN if [ -f pnpm-lock.yaml ]; then pnpm run build; else npm run build; fi

# -- Production dependencies --
FROM base AS prod-deps
COPY package.json package-lock.json* pnpm-lock.yaml* ./
RUN if [ -f pnpm-lock.yaml ]; then corepack enable && pnpm install --frozen-lockfile --prod; \
    else npm ci --omit=dev; fi

# -- Final --
FROM node:20-alpine
WORKDIR /app
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER appuser
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --retries=3 --start-period=10s \
  CMD wget --spider --quiet http://localhost:3000/health || exit 1
CMD ["node", "dist/main.js"]
