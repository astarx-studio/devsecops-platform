FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html /usr/share/nginx/html/index.html
# smoke-build-env.js is injected by the BUILD raw_file env profile (prepare-build-env
# stages it; the build job copies staged-workspace into CI_PROJECT_DIR before Kaniko runs).
# The file in this repo is the local/default fallback.
COPY smoke-build-env.js /usr/share/nginx/html/smoke-build-env.js
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=5s CMD wget -qO- http://localhost/health || exit 1
