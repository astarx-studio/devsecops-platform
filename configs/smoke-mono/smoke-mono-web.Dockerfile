FROM nginx:alpine
COPY apps/smoke-mono-web/nginx.conf /etc/nginx/conf.d/default.conf
COPY apps/smoke-mono-web/index.html /usr/share/nginx/html/index.html
# smoke-build-env.js is injected by the BUILD raw_file env profile (prepare-build-env
# stages it to apps/smoke-mono-web/; the build job copies staged-workspace into
# CI_PROJECT_DIR before Kaniko runs). The file in this repo is the local/default fallback.
COPY apps/smoke-mono-web/smoke-build-env.js /usr/share/nginx/html/smoke-build-env.js
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=5s CMD wget -qO- http://localhost/health || exit 1
