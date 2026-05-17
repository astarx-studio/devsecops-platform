#!/usr/bin/env bash
# =============================================================================
# bootstrap/lib/smoke-cleanup.sh
# =============================================================================
# Tear down smoke sample projects: Helm/K8s, GitLab (permanent delete + wait
# until slug paths are free), Vault secret trees, and Mongo. Avoids scheduled-
# deletion conflicts on re-run.
#
# Expects: log, warn, die, GRAPHQL_URL, API_KEY, gitlab-api.sh sourced by caller.
# Optional: SMOKE_GITLAB_DELETE_WAIT (default 180 seconds)
# Vault: VAULT_ROOT_TOKEN or VAULT_DEV_ROOT_TOKEN_ID, VAULT_CONTAINER (default vault)
# =============================================================================

SMOKE_GITLAB_DELETE_WAIT="${SMOKE_GITLAB_DELETE_WAIT:-180}"
SMOKE_REGISTRY_DELETE_WAIT="${SMOKE_REGISTRY_DELETE_WAIT:-${SMOKE_GITLAB_DELETE_WAIT}}"

# mongosh inside the mongo container (no auth until .auth-enabled exists).
smoke_mongosh() {
  local db="${1:-platform}"
  shift
  local -a auth=()
  if docker exec mongo test -f /data/db/.auth-enabled 2>/dev/null; then
    # Platform DB documents use MONGO_APP_*; admin credentials may not have platform write access.
    if [[ -n "${MONGO_APP_USER:-}" && -n "${MONGO_APP_PASSWORD:-}" ]]; then
      auth=(
        --username "${MONGO_APP_USER}"
        --password "${MONGO_APP_PASSWORD}"
        --authenticationDatabase "${MONGO_DB_NAME:-platform}"
      )
    elif [[ -n "${MONGO_ADMIN_USER:-}" && -n "${MONGO_ADMIN_PASSWORD:-}" ]]; then
      auth=(
        --username "${MONGO_ADMIN_USER}"
        --password "${MONGO_ADMIN_PASSWORD}"
        --authenticationDatabase admin
      )
    else
      warn "Mongo auth enabled; set MONGO_ADMIN_* or MONGO_APP_* in .env for smoke-cleanup"
    fi
  fi
  docker exec mongo mongosh --quiet "${auth[@]}" "${db}" "$@"
}

smoke_vault_cli() {
  if docker exec "${VAULT_CONTAINER:-vault}" sh -c 'command -v bao >/dev/null 2>&1'; then
    echo bao
  else
    echo vault
  fi
}

smoke_vault_exec() {
  local token="${VAULT_ROOT_TOKEN:-${VAULT_DEV_ROOT_TOKEN_ID:-}}"
  [[ -n "${token}" ]] || return 1
  docker exec \
    -e "VAULT_TOKEN=${token}" \
    -e "VAULT_ADDR=${VAULT_ADDR:-http://localhost:8200}" \
    "${VAULT_CONTAINER:-vault}" \
    "$(smoke_vault_cli)" "$@"
}

smoke_vault_list_keys() {
  local path="$1"
  smoke_vault_exec kv list -mount=secret -format=json "${path}" 2>/dev/null \
    | jq -r '.[]? // empty' 2>/dev/null || true
}

smoke_vault_metadata_delete() {
  local path="$1"
  smoke_vault_exec kv metadata delete -mount=secret "${path}" >/dev/null 2>&1 || true
}

# Collect all KV v2 metadata paths under a project root (deepest paths first).
smoke_collect_vault_paths() {
  local path="$1"
  local keys key seg child

  keys="$(smoke_vault_list_keys "${path}")"
  if [[ -n "${keys}" ]]; then
    while IFS= read -r key; do
      [[ -z "${key}" ]] && continue
      if [[ "${key}" == */ ]]; then
        seg="${key%/}"
        smoke_collect_vault_paths "${path}/${seg}"
      else
        echo "${path}/${key}"
      fi
    done <<< "${keys}"
  fi
  echo "${path}"
}

smoke_delete_vault_tree() {
  local root="$1"
  local p deleted=0

  [[ -n "${root}" ]] || return 0
  if [[ -z "${VAULT_ROOT_TOKEN:-${VAULT_DEV_ROOT_TOKEN_ID:-}}" ]]; then
    warn "VAULT_ROOT_TOKEN unset — cannot delete Vault tree ${root}"
    return 1
  fi

  log "Vault: deleting secret tree at ${root}..."
  while IFS= read -r p; do
    [[ -z "${p}" ]] && continue
    smoke_vault_metadata_delete "${p}"
    log "Vault: deleted secret/${p}"
    deleted=$((deleted + 1))
  done < <(smoke_collect_vault_paths "${root}" | awk '{ print length, $0 }' | sort -rn | cut -d' ' -f2-)

  if [[ "${deleted}" -gt 0 ]]; then
    log "Vault: removed ${deleted} metadata path(s) under ${root}"
  fi
}

smoke_mongo_vault_base_path() {
  local mongo_id="$1"
  smoke_mongosh platform --eval \
    "const d=db.projects.findOne({_id:ObjectId('${mongo_id}')}); if(d) print(d.vaultBasePath||('projects/'+d.gitlabPath));" \
    2>/dev/null | tr -d '\r\n'
}

smoke_mongo_group_query() {
  local group_path="$1"
  local -a segments=()
  local seg query i=0

  IFS='/' read -r -a segments <<< "${group_path}"
  query="{"
  for seg in "${segments[@]}"; do
    [[ -n "${seg}" ]] || continue
    [[ "${i}" -gt 0 ]] && query+=", "
    query+="\"groupPath.${i}\": \"${seg}\""
    i=$((i + 1))
  done
  query+="}"
  echo "${query}"
}

smoke_vault_paths_for_mongo_query() {
  local query="$1"
  smoke_mongosh platform --eval \
    "db.projects.find(${query}, {vaultBasePath:1, gitlabPath:1}).forEach(d => print(d.vaultBasePath || ('projects/' + d.gitlabPath)));" \
    2>/dev/null | tr -d '\r' | sort -u
}

smoke_purge_vault_for_mongo_query() {
  local query="$1"
  local vp
  while IFS= read -r vp; do
    [[ -n "${vp}" ]] && smoke_delete_vault_tree "${vp}"
  done < <(smoke_vault_paths_for_mongo_query "${query}")
}

smoke_gitlab_http_code() {
  gitlab_curl -s -o /dev/null -w "%{http_code}" "${GITLAB_API_HDR[@]}" "$@" 2>/dev/null || echo "000"
}

smoke_gitlab_project_json() {
  gitlab_curl -sf "${GITLAB_API_HDR[@]}" "$@" 2>/dev/null || echo "{}"
}

smoke_encode_path() {
  printf '%s' "$1" | jq -sRr @uri
}

smoke_registry_repo_count() {
  local pid="$1"
  gitlab_curl -sf "${GITLAB_API_HDR[@]}" \
    "${GITLAB_API}/projects/${pid}/registry/repositories" 2>/dev/null | jq 'length' 2>/dev/null || echo "0"
}

smoke_purge_registry() {
  local pid="$1"
  local repo_ids repo page tags t enc code wait_deadline now remaining

  repo_ids="$(gitlab_curl -sf "${GITLAB_API_HDR[@]}" \
    "${GITLAB_API}/projects/${pid}/registry/repositories" 2>/dev/null | jq -r '.[].id' || true)"
  [[ -n "${repo_ids}" ]] || return 0

  log "Purging container registry for GitLab project ${pid}..."

  for repo in ${repo_ids}; do
    gitlab_curl -s -o /dev/null "${GITLAB_API_HDR[@]}" -X DELETE \
      "${GITLAB_API}/projects/${pid}/registry/repositories/${repo}/tags" \
      -H "Content-Type: application/json" \
      -d '{"name_regex_delete":".*"}' 2>/dev/null || true

    page=1
    while true; do
      tags="$(gitlab_curl -sf "${GITLAB_API_HDR[@]}" \
        "${GITLAB_API}/projects/${pid}/registry/repositories/${repo}/tags?per_page=100&page=${page}" \
        2>/dev/null | jq -r '.[].name' || true)"
      [[ -n "${tags}" ]] || break
      for t in ${tags}; do
        enc="$(smoke_encode_path "${t}")"
        gitlab_curl -s -o /dev/null "${GITLAB_API_HDR[@]}" -X DELETE \
          "${GITLAB_API}/projects/${pid}/registry/repositories/${repo}/tags/${enc}" 2>/dev/null || true
      done
      page=$((page + 1))
    done

    code="$(smoke_gitlab_http_code -X DELETE \
      "${GITLAB_API}/projects/${pid}/registry/repositories/${repo}")"
    log "GitLab registry repository ${repo} on project ${pid} → HTTP ${code}"
  done

  wait_deadline=$(( $(date +%s) + SMOKE_REGISTRY_DELETE_WAIT ))
  while (( $(date +%s) < wait_deadline )); do
    if [[ "$(smoke_registry_repo_count "${pid}")" == "0" ]]; then
      log "Registry cleared for project ${pid}"
      return 0
    fi
    now=$(date +%s)
    remaining=$((wait_deadline - now))
    log "debug: waiting for registry cleanup on project ${pid} (${remaining}s left)..."
    repo_ids="$(gitlab_curl -sf "${GITLAB_API_HDR[@]}" \
      "${GITLAB_API}/projects/${pid}/registry/repositories" 2>/dev/null | jq -r '.[].id' || true)"
    for repo in ${repo_ids}; do
      smoke_gitlab_http_code -X DELETE \
        "${GITLAB_API}/projects/${pid}/registry/repositories/${repo}" >/dev/null || true
    done
    sleep 10
  done
  warn "Registry still present on project ${pid} after ${SMOKE_REGISTRY_DELETE_WAIT}s — will retry project delete"
}

smoke_finalize_gitlab_project_deletion() {
  local pid="$1"
  local meta full_path marked

  meta="$(smoke_gitlab_project_json "${GITLAB_API}/projects/${pid}")"
  if [[ "$(echo "${meta}" | jq -r '.id // empty')" == "" ]]; then
    return 0
  fi
  marked="$(echo "${meta}" | jq -r '.marked_for_deletion_on // empty')"
  full_path="$(echo "${meta}" | jq -r '.path_with_namespace')"
  if [[ -n "${marked}" && "${marked}" != "null" ]]; then
    smoke_gitlab_permanently_remove "${pid}" "${full_path}"
    sleep 2
  fi
}

# Immediate removal for projects already marked for deletion (renamed paths).
smoke_gitlab_permanently_remove() {
  local pid="$1"
  local full_path="$2"
  local enc_path code
  enc_path="$(smoke_encode_path "${full_path}")"
  code="$(smoke_gitlab_http_code -X DELETE \
    "${GITLAB_API}/projects/${pid}?permanently_remove=true&full_path=${enc_path}")"
  log "GitLab permanently_remove ${full_path} (id ${pid}) → HTTP ${code}"
}

smoke_hard_delete_gitlab_project() {
  local pid="$1"
  local path="${2:-}"
  local meta full_path marked code

  meta="$(smoke_gitlab_project_json "${GITLAB_API}/projects/${pid}")"
  if [[ "$(echo "${meta}" | jq -r '.id // empty')" == "" ]]; then
    log "GitLab project id ${pid} already absent"
    return 0
  fi

  full_path="$(echo "${meta}" | jq -r '.path_with_namespace')"
  [[ -n "${path}" ]] || path="${full_path}"

  smoke_purge_registry "${pid}"

  code="$(smoke_gitlab_http_code -X DELETE \
    "${GITLAB_API}/projects/${pid}?permanently_delete=true")"
  if [[ "${code}" != "202" && "${code}" != "204" ]]; then
    smoke_purge_registry "${pid}"
    code="$(smoke_gitlab_http_code -X DELETE \
      "${GITLAB_API}/projects/${pid}?permanently_delete=true")"
  fi
  if [[ "${code}" != "202" && "${code}" != "204" ]]; then
    code="$(smoke_gitlab_http_code -X DELETE "${GITLAB_API}/projects/${pid}")"
  fi
  log "GitLab delete ${full_path} (id ${pid}) → HTTP ${code}"

  smoke_finalize_gitlab_project_deletion "${pid}"
}

# Wait until projects/{group}/{slug} is not an active project (404/403 = free).
smoke_wait_slug_path_free() {
  local group_path="$1"
  local slug="$2"
  local enc deadline meta pid full_path marked
  enc="$(smoke_encode_path "${group_path}/${slug}")"
  deadline=$(( $(date +%s) + SMOKE_GITLAB_DELETE_WAIT ))

  while true; do
    local http_code
    http_code="$(smoke_gitlab_http_code "${GITLAB_API}/projects/${enc}")"
    [[ "${http_code}" != "200" ]] && break
    if (( $(date +%s) >= deadline )); then
      die "GitLab path ${group_path}/${slug} still taken after ${SMOKE_GITLAB_DELETE_WAIT}s"
    fi
    meta="$(smoke_gitlab_project_json "${GITLAB_API}/projects/${enc}")"
    pid="$(echo "${meta}" | jq -r '.id // empty')"
    full_path="$(echo "${meta}" | jq -r '.path_with_namespace // empty')"
    marked="$(echo "${meta}" | jq -r '.marked_for_deletion_on // empty')"
    if [[ -n "${pid}" ]]; then
      if [[ -n "${marked}" && "${marked}" != "null" ]]; then
        smoke_gitlab_permanently_remove "${pid}" "${full_path}"
      else
        smoke_hard_delete_gitlab_project "${pid}" "${full_path}"
      fi
    fi
    sleep 10
    log "debug: waiting for GitLab path ${group_path}/${slug} to be free..."
  done
  log "GitLab path ${group_path}/${slug} is free"
}

smoke_restore_gitlab_group() {
  local group_path="$1"
  local gid marked code
  gid="$(gitlab_curl -sf "${GITLAB_API_HDR[@]}" "${GITLAB_API}/groups/${group_path}" 2>/dev/null \
    | jq -r '.id // empty' || true)"
  [[ -n "${gid}" ]] || return 0
  marked="$(gitlab_curl -sf "${GITLAB_API_HDR[@]}" "${GITLAB_API}/groups/${group_path}" 2>/dev/null \
    | jq -r '.marked_for_deletion_on // empty' || true)"
  if [[ -n "${marked}" && "${marked}" != "null" ]]; then
    code="$(smoke_gitlab_http_code -X POST "${GITLAB_API}/groups/${gid}/restore")"
    log "Restored GitLab group ${group_path} (was scheduled for deletion) → HTTP ${code}"
  fi
}

# Immediate removal for subgroups already marked (renamed full_path).
smoke_gitlab_permanently_remove_group() {
  local gid="$1"
  local full_path="$2"
  local enc_path code
  enc_path="$(smoke_encode_path "${full_path}")"
  code="$(smoke_gitlab_http_code -X DELETE \
    "${GITLAB_API}/groups/${gid}?permanently_remove=true&full_path=${enc_path}")"
  log "GitLab permanently_remove group ${full_path} (id ${gid}) → HTTP ${code}"
}

# Top-level groups cannot use permanently_remove via API; optional rails destroy (local Docker GitLab).
smoke_rails_destroy_gitlab_group() {
  local gid="$1"
  local full_path="$2"
  if [[ "${SMOKE_GITLAB_RAILS_DESTROY:-0}" != "1" ]]; then
    return 1
  fi
  if ! gitlab_api_uses_docker; then
    warn "SMOKE_GITLAB_RAILS_DESTROY=1 requires GitLab API via docker exec (unset GITLAB_API_BASE_URL)"
    return 1
  fi
  if docker exec "${GITLAB_CONTAINER}" gitlab-rails runner \
    "g = Group.find_by(id: ${gid}); g&.destroy!" >/dev/null 2>&1; then
    log "GitLab rails: destroyed group ${full_path} (id ${gid})"
    return 0
  fi
  warn "GitLab rails destroy failed for group ${full_path} (id ${gid})"
  return 1
}

# Collect group id|full_path lines: exact path, deletion_scheduled rename, and legacy top-level smoke.
smoke_collect_gitlab_groups() {
  local logical_path="$1"
  local base="${logical_path##*/}"
  local seen="|"
  local meta gid fp marked line search

  emit_group() {
    local id="$1" path="$2"
    [[ -n "${id}" && "${id}" != "null" ]] || return 0
    [[ "${seen}" == *"|${id}|"* ]] && return 0
    seen="${seen}${id}|"
    printf '%s|%s\n' "${id}" "${path}"
  }

  meta="$(smoke_gitlab_project_json "${GITLAB_API}/groups/${logical_path}")"
  gid="$(echo "${meta}" | jq -r '.id // empty')"
  fp="$(echo "${meta}" | jq -r '.full_path // empty')"
  [[ -n "${gid}" ]] && emit_group "${gid}" "${fp}"

  search="$(gitlab_curl -sf "${GITLAB_API_HDR[@]}" \
    "${GITLAB_API}/groups?search=${base}&per_page=100" 2>/dev/null || echo "[]")"
  while IFS= read -r line; do
    [[ -z "${line}" ]] && continue
    gid="$(echo "${line}" | jq -r '.id')"
    fp="$(echo "${line}" | jq -r '.full_path')"
    if [[ "${fp}" == "${logical_path}" ]] \
      || [[ "${fp}" == "${base}" ]] \
      || [[ "${fp}" == "${base}-deletion_scheduled-"* ]] \
      || [[ "${fp}" == "${logical_path}-deletion_scheduled-"* ]]; then
      emit_group "${gid}" "${fp}"
    fi
  done < <(echo "${search}" | jq -c '.[]?')

  # Legacy top-level smoke (before nested SMOKE_GROUP_PATH default).
  if [[ "${logical_path}" != "smoke" ]]; then
    meta="$(smoke_gitlab_project_json "${GITLAB_API}/groups/smoke")"
    gid="$(echo "${meta}" | jq -r '.id // empty')"
    fp="$(echo "${meta}" | jq -r '.full_path // empty')"
    [[ -n "${gid}" ]] && emit_group "${gid}" "${fp}"
    search="$(gitlab_curl -sf "${GITLAB_API_HDR[@]}" \
      "${GITLAB_API}/groups?search=smoke&per_page=100" 2>/dev/null || echo "[]")"
    while IFS= read -r line; do
      [[ -z "${line}" ]] && continue
      gid="$(echo "${line}" | jq -r '.id')"
      fp="$(echo "${line}" | jq -r '.full_path')"
      if [[ "${fp}" == "smoke" || "${fp}" == smoke-deletion_scheduled-* ]]; then
        emit_group "${gid}" "${fp}"
      fi
    done < <(echo "${search}" | jq -c '.[]?')
  fi
}

smoke_hard_delete_gitlab_group() {
  local logical_path="$1"
  local groups gid full_path parent_id marked meta code deadline enc

  groups="$(smoke_collect_gitlab_groups "${logical_path}")"
  if [[ -z "${groups}" ]]; then
    log "GitLab group(s) for ${logical_path} already absent"
    return 0
  fi

  while IFS='|' read -r gid full_path; do
    [[ -n "${gid}" ]] || continue
    log "Removing GitLab group ${full_path} (id ${gid})..."

    # Projects under this group path prefix (scheduled groups use renamed full_path).
    smoke_clear_gitlab_group_projects "${logical_path}"
    if [[ "${full_path}" != "${logical_path}" ]]; then
      smoke_clear_gitlab_group_projects "${full_path}"
    fi

    code="$(smoke_gitlab_http_code -X DELETE "${GITLAB_API}/groups/${gid}")"
    log "GitLab delete group ${full_path} (id ${gid}) → HTTP ${code}"

    deadline=$(( $(date +%s) + SMOKE_GITLAB_DELETE_WAIT ))
    while true; do
      meta="$(smoke_gitlab_project_json "${GITLAB_API}/groups/${gid}")"
      if [[ "$(echo "${meta}" | jq -r '.id // empty')" == "" ]]; then
        meta="$(smoke_gitlab_project_json "${GITLAB_API}/groups/${full_path}")"
      fi
      if [[ "$(echo "${meta}" | jq -r '.id // empty')" == "" ]]; then
        log "GitLab group ${full_path} removed"
        break
      fi

      marked="$(echo "${meta}" | jq -r '.marked_for_deletion_on // empty')"
      full_path="$(echo "${meta}" | jq -r '.full_path')"
      parent_id="$(echo "${meta}" | jq -r '.parent_id // empty')"
      gid="$(echo "${meta}" | jq -r '.id')"

      if [[ -n "${marked}" && "${marked}" != "null" ]]; then
        if [[ -n "${parent_id}" && "${parent_id}" != "null" ]]; then
          smoke_gitlab_permanently_remove_group "${gid}" "${full_path}"
        else
          smoke_rails_destroy_gitlab_group "${gid}" "${full_path}" || true
        fi
      fi

      if (( $(date +%s) >= deadline )); then
        if [[ -n "${marked}" && "${marked}" != "null" && ( -z "${parent_id}" || "${parent_id}" == "null" ) ]]; then
          warn "Top-level GitLab group ${full_path} is scheduled for deletion (instance retention ~30d). Set SMOKE_GITLAB_RAILS_DESTROY=1 for immediate removal on local Docker GitLab, or wait for retention."
        else
          die "GitLab group ${full_path} still present after ${SMOKE_GITLAB_DELETE_WAIT}s"
        fi
        break
      fi
      sleep 3
    done
  done <<< "${groups}"
}

smoke_clear_gitlab_group_projects() {
  local group_path="$1"
  local projects pid path slug

  smoke_restore_gitlab_group "${group_path}"

  while true; do
    projects="$(gitlab_curl -sf "${GITLAB_API_HDR[@]}" \
      "${GITLAB_API}/groups/${group_path}/projects?include_subgroups=true&per_page=100" 2>/dev/null \
      | jq -c '.[] | {id, path_with_namespace}' || true)"
    [[ -n "${projects}" ]] || break
    while IFS= read -r line; do
      [[ -z "${line}" ]] && continue
      pid="$(echo "${line}" | jq -r '.id')"
      path="$(echo "${line}" | jq -r '.path_with_namespace')"
      smoke_hard_delete_gitlab_project "${pid}" "${path}"
    done <<< "${projects}"
    sleep 2
  done
}

smoke_delete_k8s_release() {
  local release="$1"
  local kube_ctx="${KUBE_CONTEXT:-k3d-dsoaas}"
  local ns
  for ns in dev stg prod; do
    helm --kube-context "${kube_ctx}" -n "${ns}" uninstall "${release}" 2>/dev/null || true
    kubectl --context "${kube_ctx}" delete deployment,service,ingress,externalsecret \
      -n "${ns}" "${release}" --ignore-not-found 2>/dev/null || true
    kubectl --context "${kube_ctx}" delete secret -n "${ns}" \
      -l "owner=helm,name=${release}" --ignore-not-found 2>/dev/null || true
  done
}

smoke_delete_mongo_by_id() {
  local mongo_id="$1"
  local path="$2"
  local vault_path="${3:-}"
  local deleted

  if [[ -z "${vault_path}" ]]; then
    vault_path="$(smoke_mongo_vault_base_path "${mongo_id}")"
  fi
  [[ -n "${vault_path}" ]] && smoke_delete_vault_tree "${vault_path}"

  deleted="$(smoke_mongosh platform --eval \
    "db.projects.deleteOne({ _id: ObjectId('${mongo_id}') }).deletedCount" 2>/dev/null || echo "0")"
  if [[ "${deleted}" == "1" ]]; then
    log "Mongo: removed ${path} (id=${mongo_id})"
    return 0
  fi
  return 1
}

smoke_delete_mongo_via_api() {
  local mongo_id="$1"
  local path="$2"
  local vault_path="${3:-}"
  local delresp outcome
  [[ -n "${mongo_id}" && "${mongo_id}" != "null" ]] || return 0

  if [[ -z "${vault_path}" ]]; then
    vault_path="$(smoke_mongo_vault_base_path "${mongo_id}")"
  fi

  if delresp="$(curl -sf -X POST "${GRAPHQL_URL}" \
    -H "Content-Type: application/json" -H "X-API-Key: ${API_KEY}" \
    -d "$(jq -n --arg id "${mongo_id}" \
      '{
        query: "mutation($id: ID!, $force: Boolean) { deleteProject(id: $id, forceGitLabDelete: $force) { outcome message } }",
        variables: { id: $id, force: false }
      }')" \
    2>/dev/null)"; then
    outcome="$(echo "${delresp}" | jq -r '.data.deleteProject.outcome // empty')"
    if [[ "${outcome}" == "DELETED" ]]; then
      log "deleteProject DELETED for ${path} (mongo id=${mongo_id})"
      return 0
    fi
    if [[ "${outcome}" == "ARCHIVED" ]]; then
      log "deleteProject ARCHIVED for ${path} — ensuring Vault tree is cleared"
      [[ -n "${vault_path}" ]] && smoke_delete_vault_tree "${vault_path}"
      return 0
    fi
  fi

  # GitLab often already removed during hard-delete; API may archive or fail — purge Vault + Mongo.
  if smoke_delete_mongo_by_id "${mongo_id}" "${path}" "${vault_path}"; then
    if [[ -n "${delresp}" ]] && echo "${delresp}" | grep -q '404'; then
      log "Mongo: dropped orphan record ${path} (GitLab project already absent)"
    else
      log "Mongo: dropped ${path} (API deleteProject incomplete; direct Mongo + Vault cleanup)"
    fi
    return 0
  fi

  if [[ -z "${delresp}" ]]; then
    warn "deleteProject unreachable for ${path} (is the Management API up?)"
    [[ -n "${vault_path}" ]] && smoke_delete_vault_tree "${vault_path}"
    return 1
  fi
  warn "deleteProject for ${path}: ${delresp}"
  [[ -n "${vault_path}" ]] && smoke_delete_vault_tree "${vault_path}"
  return 1
}

smoke_preflight_clear_slots() {
  local group_path="$1"
  shift
  local slugs=("$@")
  local slug lookup lresp row mongo_id gitlab_id path release

  log "Preflight: hard-clearing GitLab group ${group_path}..."
  smoke_clear_gitlab_group_projects "${group_path}"

  lookup="$(jq -n \
    --argjson gp "${GROUP_JSON}" \
    '{
      query: "query($f: ProjectFilterInput!) { projects(filter: $f, page: 0, perPage: 100) { id projectSlug gitlabPath gitlabProjectId effectiveSlug vaultBasePath capabilities { deployable } } }",
      variables: { f: { groupPathPrefix: $gp } }
    }')"
  lresp="$(graphql_post "${lookup}")"

  for slug in "${slugs[@]}"; do
    row="$(echo "${lresp}" | jq -c --arg s "${slug}" \
      '(.data.projects // [])[] | select(.projectSlug == $s)' | head -1 || true)"
    if [[ -n "${row}" ]]; then
      mongo_id="$(echo "${row}" | jq -r '.id')"
      path="$(echo "${row}" | jq -r '.gitlabPath')"
      release="$(echo "${row}" | jq -r '.effectiveSlug')"
      vault_path="$(echo "${row}" | jq -r '.vaultBasePath // empty')"
      log "Preflight: removing stale Mongo/K8s record ${path}"
      smoke_delete_k8s_release "${release}"
      smoke_delete_mongo_via_api "${mongo_id}" "${path}" "${vault_path}"
    fi
    smoke_wait_slug_path_free "${group_path}" "${slug}"
  done

  while IFS= read -r row; do
    [[ -z "${row}" ]] && continue
    slug="$(echo "${row}" | jq -r '.projectSlug')"
    skip=0
    for s in "${slugs[@]}"; do [[ "${slug}" == "${s}" ]] && skip=1; done
    (( skip )) && continue
    mongo_id="$(echo "${row}" | jq -r '.id')"
    path="$(echo "${row}" | jq -r '.gitlabPath')"
    release="$(echo "${row}" | jq -r '.effectiveSlug')"
    vault_path="$(echo "${row}" | jq -r '.vaultBasePath // empty')"
    warn "Preflight: removing extra smoke Mongo record ${path}"
    smoke_delete_k8s_release "${release}"
    smoke_delete_mongo_via_api "${mongo_id}" "${path}" "${vault_path}"
  done < <(echo "${lresp}" | jq -c '(.data.projects // [])[]')

  # GraphQL listProjects hides archived rows; drop any leftover Mongo docs for this group.
  smoke_purge_mongo_group "${group_path}"

  log "Preflight: GitLab paths for ${group_path} are clear"
}

# When GitLab is already gone, deleteProject may fail — purge Vault trees then Mongo rows.
smoke_purge_mongo_group() {
  local group_path="$1"
  local query count total=0
  local legacy_query='{"groupPath.0": "smoke", "groupPath.1": {$exists: false}}'

  query="$(smoke_mongo_group_query "${group_path}")"
  smoke_purge_vault_for_mongo_query "${query}"

  count="$(smoke_mongosh platform --eval \
    "db.projects.deleteMany(${query}).deletedCount" 2>/dev/null || echo "0")"
  count="${count//$'\r'/}"
  total=$((total + count))

  if [[ "${group_path}" != "smoke" ]]; then
    smoke_purge_vault_for_mongo_query "${legacy_query}"
    count="$(smoke_mongosh platform --eval \
      "db.projects.deleteMany(${legacy_query}).deletedCount" 2>/dev/null || echo "0")"
    total=$((total + count))
  fi

  if [[ "${total}" != "0" ]]; then
    log "Mongo: removed ${total} project document(s) under group ${group_path}"
  fi

  local remaining
  remaining="$(smoke_mongosh platform --eval \
    "db.projects.countDocuments(${query})" 2>/dev/null | tr -d '\r\n ' || echo "?")"
  if [[ "${remaining}" =~ ^[0-9]+$ && "${remaining}" != "0" ]]; then
    die "Mongo: ${remaining} project document(s) still present for ${group_path} (including archived) — set MONGO_APP_* in .env or purge manually"
  fi
}

smoke_delete_project_via_api() {
  local mongo_id="$1"
  local gitlab_id="$2"
  local release="$3"
  local path="$4"
  local group_path="${path%%/*}"
  local slug="${path##*/}"

  smoke_delete_k8s_release "${release}"

  if [[ -n "${mongo_id}" && "${mongo_id}" != "null" ]]; then
    smoke_delete_mongo_via_api "${mongo_id}" "${path}" || true
  fi

  if [[ -n "${gitlab_id}" && "${gitlab_id}" != "null" ]]; then
    smoke_hard_delete_gitlab_project "${gitlab_id}" "${path}"
  fi

  smoke_wait_slug_path_free "${group_path}" "${slug}"
}
