# Isolated MR review worker. No repo code runs here: files are read from git
# objects. Runs as a non-root user on a read-only root filesystem.
FROM node:22.12.0-alpine3.21

RUN apk add --no-cache git tini \
 && addgroup -S reviewer && adduser -S -G reviewer -h /home/reviewer reviewer \
 && mkdir -p /repos && chown reviewer:reviewer /repos

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY src ./src
COPY prompts ./prompts
COPY schema ./schema

USER reviewer
ENV NODE_ENV=production HOME=/tmp AI_REVIEW_REPOS_DIR=/repos AI_REVIEW_CONFIG=/config/review.yaml
EXPOSE 8791
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD wget -qO- http://127.0.0.1:8791/healthz || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/main.js"]
