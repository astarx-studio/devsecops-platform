#!/usr/bin/env bash
# Build a GCP custom image + instance template from the live VPN edge VM.
#
# Prerequisites:
#   - gcloud authenticated with compute.instanceAdmin + image create rights
#   - Live VM already configured (WireGuard, vpn-edge-nat, FORWARD_TCP including 25432)
#   - Run from the repo root (or set REPO_ROOT)
#
# Usage:
#   ./edge/gcp/create-image-and-template.sh
#   ./edge/gcp/create-image-and-template.sh --no-stop   # image while VM keeps running (force)
#
# Docs: __DOCS__/99_maintainers/10_gcp_edge_template.md
set -euo pipefail

PROJECT="${GCP_PROJECT:-yada-technology}"
ZONE="${GCP_ZONE:-asia-southeast2-a}"
INSTANCE="${GCP_EDGE_INSTANCE:-yada-tunnel-managed-68bh}"
IMAGE_FAMILY="${GCP_EDGE_IMAGE_FAMILY:-vpn-edge}"
TEMPLATE_NAME="${GCP_EDGE_TEMPLATE:-vpn-edge-devtools-v1}"
TAGS="${GCP_EDGE_TAGS:-custom-ssh,http-server,https-server,lb-health-check,wireguard-tunnel}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
STARTUP_SCRIPT="${SCRIPT_DIR}/startup-script.sh"
DATE_TAG="$(date +%Y%m%d)"
IMAGE_NAME="${IMAGE_FAMILY}-devtools-v1-${DATE_TAG}"

STOP_INSTANCE=1
for arg in "$@"; do
  case "${arg}" in
    --no-stop) STOP_INSTANCE=0 ;;
    -h|--help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
  esac
done

log() { printf '[edge-gcp][INFO] %s\n' "$*"; }
die() { printf '[edge-gcp][ERROR] %s\n' "$*" >&2; exit 1; }

command -v gcloud >/dev/null || die "gcloud not on PATH"
[[ -f "${STARTUP_SCRIPT}" ]] || die "Missing ${STARTUP_SCRIPT}"

MACHINE_TYPE="$(gcloud compute instances describe "${INSTANCE}" \
  --project="${PROJECT}" --zone="${ZONE}" \
  --format='value(machineType.basename())')"
DISK_SIZE="$(gcloud compute instances describe "${INSTANCE}" \
  --project="${PROJECT}" --zone="${ZONE}" \
  --format='value(disks[0].diskSizeGb)')"
[[ -n "${MACHINE_TYPE}" ]] || die "Could not read machine type for ${INSTANCE}"
[[ -n "${DISK_SIZE}" ]] || die "Could not read disk size for ${INSTANCE}"

log "Source instance=${INSTANCE} zone=${ZONE} machine=${MACHINE_TYPE} disk=${DISK_SIZE}G"

if [[ "${STOP_INSTANCE}" -eq 1 ]]; then
  log "Stopping ${INSTANCE} for a consistent image (use --no-stop to skip)..."
  gcloud compute instances stop "${INSTANCE}" \
    --project="${PROJECT}" --zone="${ZONE}"
else
  log "Creating image with --force (VM stays running)"
fi

FORCE_FLAG=()
if [[ "${STOP_INSTANCE}" -eq 0 ]]; then
  FORCE_FLAG=(--force)
fi

if gcloud compute images describe "${IMAGE_NAME}" --project="${PROJECT}" >/dev/null 2>&1; then
  log "Image ${IMAGE_NAME} already exists — skipping create"
else
  log "Creating image ${IMAGE_NAME} (family=${IMAGE_FAMILY})..."
  gcloud compute images create "${IMAGE_NAME}" \
    --project="${PROJECT}" \
    --source-disk="${INSTANCE}" \
    --source-disk-zone="${ZONE}" \
    --family="${IMAGE_FAMILY}" \
    "${FORCE_FLAG[@]}"
fi

if [[ "${STOP_INSTANCE}" -eq 1 ]]; then
  log "Starting ${INSTANCE} again..."
  gcloud compute instances start "${INSTANCE}" \
    --project="${PROJECT}" --zone="${ZONE}"
fi

if gcloud compute instance-templates describe "${TEMPLATE_NAME}" \
  --project="${PROJECT}" >/dev/null 2>&1; then
  die "Template ${TEMPLATE_NAME} already exists. Delete it or set GCP_EDGE_TEMPLATE to a new name."
fi

log "Creating instance template ${TEMPLATE_NAME}..."
gcloud compute instance-templates create "${TEMPLATE_NAME}" \
  --project="${PROJECT}" \
  --machine-type="${MACHINE_TYPE}" \
  --image-family="${IMAGE_FAMILY}" \
  --image-project="${PROJECT}" \
  --boot-disk-size="${DISK_SIZE}GB" \
  --boot-disk-type=pd-balanced \
  --tags="${TAGS}" \
  --metadata-from-file=startup-script="${STARTUP_SCRIPT}" \
  --scopes=https://www.googleapis.com/auth/devstorage.read_only,https://www.googleapis.com/auth/logging.write,https://www.googleapis.com/auth/monitoring.write,https://www.googleapis.com/auth/service.management.readonly,https://www.googleapis.com/auth/servicecontrol,https://www.googleapis.com/auth/trace.append \
  --network=default

log "Done."
log "  Image:    ${IMAGE_NAME} (family ${IMAGE_FAMILY})"
log "  Template: ${TEMPLATE_NAME}"
log "Recreate (manual): see ${REPO_ROOT}/edge/gcp/README.md"
