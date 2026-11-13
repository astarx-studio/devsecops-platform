# Platform GitLab image: stock GitLab CE plus additive DSOaaS plugins.
#
# Nothing in GitLab's own source tree is modified. The build only ADDS:
#   - config/initializers/zz_dsoaas_plugins.rb  (the plugin loader)
#   - dsoaas_plugins/                           (plugin code)
#   - /opt/dsoaas/                              (seam guard + contract tests)
#
# The base image is a build arg so bootstrap/upgrade.sh can bump it. The seam
# guard runs BEFORE the plugins are copied: if a new GitLab release renamed or
# removed something a plugin relies on, the build fails and the upgrade stops
# before the running container is touched.
ARG GITLAB_BASE_IMAGE=gitlab/gitlab-ce:19.5.3-ce.0
FROM ${GITLAB_BASE_IMAGE}

ARG RAILS_ROOT=/opt/gitlab/embedded/service/gitlab-rails

COPY seams.txt bin/check-seams.sh /opt/dsoaas/
RUN sh /opt/dsoaas/check-seams.sh /opt/dsoaas/seams.txt "${RAILS_ROOT}"

COPY loader/zz_dsoaas_plugins.rb ${RAILS_ROOT}/config/initializers/zz_dsoaas_plugins.rb
COPY plugins/ ${RAILS_ROOT}/dsoaas_plugins/
COPY test/ /opt/dsoaas/test/

# Cheap guard: every plugin file must at least parse with GitLab's own Ruby.
RUN set -e; \
    for f in ${RAILS_ROOT}/config/initializers/zz_dsoaas_plugins.rb \
             $(find ${RAILS_ROOT}/dsoaas_plugins /opt/dsoaas/test -name '*.rb'); do \
      /opt/gitlab/embedded/bin/ruby -c "$f" >/dev/null; \
    done; \
    chmod -R a+rX ${RAILS_ROOT}/dsoaas_plugins /opt/dsoaas
