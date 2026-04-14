# ==========================================================================
# Management API — Multi-stage Production Build
# ==========================================================================
# Stage 1 (base):      Node.js Alpine with pnpm
# Stage 2 (build):     Install all deps + compile TypeScript
# Stage 3 (prod-deps): Install production-only deps
# Stage 4 (final):     Copy built app + prod deps, non-root user
# ==========================================================================

# -- Base --
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# -- Build --
FROM base AS build
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src/ src/
RUN pnpm run build

# -- Production dependencies --
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

# -- Final --
FROM node:20-alpine AS final
WORKDIR /app

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
  CMD node -e "const h=require('http');h.get('http://127.0.0.1:3000/health',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

CMD ["node", "dist/main.js"]
