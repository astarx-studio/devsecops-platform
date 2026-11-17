#!/bin/sh
# One-shot: download the GGUF files llama-swap.yaml refers to into /models.
# Idempotent: a file already there with the right size is skipped. This is the
# only step that needs internet; devtools-llm itself has no egress.
set -eu

log() { echo "[devtools-llm-pull] $*"; }

MODELS="${LLM_MODELS:-prism-ml/Ternary-Bonsai-2-27B-gguf:Ternary-Bonsai-2-27B-PQ2_0.gguf prism-ml/Ternary-Bonsai-2-9B-gguf:Ternary-Bonsai-2-9B-PQ2_0.gguf nomic-ai/nomic-embed-text-v1.5-GGUF:nomic-embed-text-v1.5.Q8_0.gguf}"

for spec in ${MODELS}; do
  repo="${spec%%:*}"
  file="${spec#*:}"
  dest="/models/${file}"
  url="https://huggingface.co/${repo}/resolve/main/${file}"
  want="$(curl -fsSIL "${url}" | tr -d '\r' | awk 'tolower($1)=="content-length:"{n=$2} END{print n}')"
  have="$(stat -c %s "${dest}" 2>/dev/null || echo 0)"
  if [ -n "${want}" ] && [ "${have}" = "${want}" ]; then
    log "${file}: present (${have} bytes)"
    continue
  fi
  log "${file}: downloading ${want:-?} bytes from ${repo}"
  curl -fL --retry 5 --retry-delay 5 -C - -o "${dest}.part" "${url}"
  mv "${dest}.part" "${dest}"
  log "${file}: done"
done
log "models ready:"
ls -la /models
