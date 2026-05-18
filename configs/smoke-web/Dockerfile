FROM nginx:alpine
ARG SMOKE_BUILD_MARKER=local
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html /usr/share/nginx/html/index.html
# BUILD profile supplies SMOKE_BUILD_MARKER via Kaniko --build-arg (dotenv_build_args).
RUN printf '%s\n' \
  "window.SMOKE_BUILD_MARKER = '${SMOKE_BUILD_MARKER}';" \
  > /usr/share/nginx/html/smoke-build-env.js
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=5s CMD wget -qO- http://localhost/health || exit 1
