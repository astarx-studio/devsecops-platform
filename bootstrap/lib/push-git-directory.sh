#!/usr/bin/env bash
# =============================================================================
# bootstrap/lib/push-git-directory.sh
# =============================================================================
# Push a monorepo directory to a GitLab project branch (default develop).
# Caller must define die() and docker_bind_src() before sourcing.
# Expects: GITLAB_ROOT_TOKEN, GITLAB_DOMAIN, gitlab_api_uses_docker from gitlab-api.sh
# =============================================================================

push_git_directory() {
  local group_path="$1"
  local slug="$2"
  local rel_dir="$3"
  local branch="${4:-develop}"
  local repo_root="$5"

  [[ -n "${repo_root}" ]] || die "push_git_directory: repo_root required"
  [[ -d "${repo_root}/${rel_dir}" ]] || die "push_git_directory: missing ${rel_dir}"

  local src="${repo_root}/${rel_dir}"
  local push_url tmp docker_tmp git_network=()

  if gitlab_api_uses_docker; then
    push_url="http://oauth2:${GITLAB_ROOT_TOKEN}@gitlab/${group_path}/${slug}.git"
    git_network=(--network "${DOCKER_NETWORK:-devops-network}")
  else
    push_url="https://oauth2:${GITLAB_ROOT_TOKEN}@${GITLAB_DOMAIN}/${group_path}/${slug}.git"
  fi

  tmp="$(mktemp -d)"
  if command -v rsync >/dev/null 2>&1 && [[ -z "${MSYSTEM:-}" ]]; then
    rsync -a --exclude '.git/' "${src}/" "${tmp}/"
  else
    shopt -s dotglob nullglob
    for entry in "${src}"/*; do
      [[ "$(basename "${entry}")" == ".git" ]] && continue
      cp -a "${entry}" "${tmp}/"
    done
    shopt -u dotglob nullglob
  fi

  docker_tmp="$(docker_bind_src "${tmp}")"

  if ! MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' docker run --rm \
    "${git_network[@]}" \
    --entrypoint sh \
    -v "${docker_tmp}:/payload:ro" \
    alpine/git:latest \
    -ceu "
      git config --global user.email 'bootstrap@devsecops-platform'
      git config --global user.name 'DevSecOps Bootstrap'
      if git ls-remote --heads '${push_url}' '${branch}' | grep -q .; then
        git clone --depth 1 -b '${branch}' '${push_url}' /repo
      else
        git clone --depth 1 '${push_url}' /repo
      fi
      cd /repo
      default_branch=\$(git symbolic-ref --short HEAD 2>/dev/null || echo main)
      if [ \"\${default_branch}\" != '${branch}' ]; then
        git checkout -B '${branch}' \"\${default_branch}\"
      fi
      if command -v rsync >/dev/null 2>&1; then
        rsync -a --exclude '.git' --exclude '.gitlab-ci.yml' /payload/ .
      else
        cp -a /payload/. .
        rm -f .gitlab-ci.yml 2>/dev/null || true
      fi
      if [ ! -f .gitlab-ci.yml ]; then
        git checkout \"\${default_branch}\" -- .gitlab-ci.yml 2>/dev/null \
          || git checkout \"origin/\${default_branch}\" -- .gitlab-ci.yml 2>/dev/null \
          || true
      fi
      git add -A
      if git diff --staged --quiet; then
        echo '[push-git] No changes on ${branch}'
        exit 0
      fi
      git commit -m 'chore(seed): sync application sources from devsecops-platform'
      git push -u origin '${branch}'
    "; then
    rm -rf "${tmp}"
    die "git push to ${group_path}/${slug} (${branch}) failed"
  fi
  rm -rf "${tmp}"
}
