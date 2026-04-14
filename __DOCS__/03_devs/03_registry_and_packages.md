# Container Registry and Packages

← [Back to Developer Guide](index.md)

When your CI pipeline builds a Docker image, it pushes that image to the platform's container registry. The registry is part of GitLab — every project has its own registry path, and access is controlled by your GitLab credentials.

---

## Your registry address

Images for your project are stored at:

```
registry.devops.yourdomain.com/<group-path>/<project-name>
```

For example, a project at `clients/acme/api` would push images to:

```
registry.devops.yourdomain.com/clients/acme/api
```

You can view your project's images in GitLab under **Deploy → Container Registry** in the project sidebar.

---

## Pushing images manually

If you want to push an image outside of a CI pipeline (e.g., for testing):

```bash
# Log in to the registry
docker login registry.devops.yourdomain.com

# Build your image
docker build -t registry.devops.yourdomain.com/clients/acme/api:my-tag .

# Push it
docker push registry.devops.yourdomain.com/clients/acme/api:my-tag
```

When prompted for credentials, use your GitLab username and password (or a [Personal Access Token](https://docs.gitlab.com/ee/user/profile/personal_access_tokens.html) with the `read_registry` / `write_registry` scope — this is preferred over your password).

---

## How it works in CI pipelines

Inside a GitLab CI/CD pipeline, the runner automatically has access to the registry using built-in variables. You don't need to manually set up credentials. The typical pattern in `.gitlab-ci.yml` looks like this:

```yaml
build:
  image: docker:latest
  services:
    - docker:dind
  variables:
    DOCKER_TLS_CERTDIR: "/certs"
  before_script:
    - docker login -u $CI_REGISTRY_USER -p $CI_REGISTRY_PASSWORD $CI_REGISTRY
  script:
    - docker build -t $CI_REGISTRY_IMAGE:$CI_COMMIT_SHORT_SHA .
    - docker push $CI_REGISTRY_IMAGE:$CI_COMMIT_SHORT_SHA
```

The variables `$CI_REGISTRY`, `$CI_REGISTRY_USER`, `$CI_REGISTRY_PASSWORD`, and `$CI_REGISTRY_IMAGE` are automatically set by GitLab for every pipeline — you don't need to define them yourself.

---

## Package registry

GitLab also includes package registries for common formats (npm, Maven, PyPI, etc.). These work the same way — authenticated by your GitLab credentials, and accessible at addresses like:

```
https://gitlab.devops.yourdomain.com/api/v4/projects/<project-id>/packages/npm/
```

See the [GitLab package registry documentation](https://docs.gitlab.com/ee/user/packages/) for format-specific setup instructions.

---

## What isn't configured by default

The container registry doesn't have automatic image cleanup (garbage collection) or storage quotas configured in v1. Over time, old images accumulate. If disk space becomes a concern, you or your admin can configure [GitLab's container registry cleanup policies](https://docs.gitlab.com/ee/user/packages/container_registry/reduce_container_registry_storage.html) in the project settings.
