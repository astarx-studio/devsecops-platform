# Local model runner for the AI MR reviewer.
#
# llama-swap is the only long-running process. It starts llama-server (PrismML's
# llama.cpp fork, needed for Bonsai PQ2_0/PTQ1_0/Q1_0 files) on the first request
# for a model and kills it after `ttl` idle seconds, which frees all VRAM and RAM.
#
# Prebuilt fork release for CUDA 12.8 (Blackwell / RTX 50xx needs >= 12.8).
# The tarball ships libggml-cuda but not the CUDA runtime, hence the CUDA base.
FROM nvidia/cuda:12.8.1-runtime-ubuntu24.04

ARG PRISM_TAG=prism-b12128-d7b2896
ARG PRISM_SHA256=d800a807295e73742d4dff7d3aa3a3438d6147882c9b609ef8bacba333bead01
ARG LLAMA_SWAP_VERSION=272
ARG LLAMA_SWAP_SHA256=3f21b4c13f55ea5576badcd6cc1d114ccdcf74a5d56346d3ac1e777d28e0fdf1

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl libgomp1 \
 && rm -rf /var/lib/apt/lists/*

RUN set -eux; \
  curl -fsSL -o /tmp/prism.tgz "https://github.com/PrismML-Eng/llama.cpp/releases/download/${PRISM_TAG}/llama-${PRISM_TAG}-bin-linux-cuda-12.8-x64.tar.gz"; \
  echo "${PRISM_SHA256}  /tmp/prism.tgz" | sha256sum -c -; \
  mkdir -p /opt/llama; \
  tar -xzf /tmp/prism.tgz -C /opt/llama --strip-components=1; \
  rm /tmp/prism.tgz; \
  curl -fsSL -o /tmp/ls.tgz "https://github.com/mostlygeek/llama-swap/releases/download/v${LLAMA_SWAP_VERSION}/llama-swap_${LLAMA_SWAP_VERSION}_linux_amd64.tar.gz"; \
  echo "${LLAMA_SWAP_SHA256}  /tmp/ls.tgz" | sha256sum -c -; \
  tar -xzf /tmp/ls.tgz -C /usr/local/bin llama-swap; \
  rm /tmp/ls.tgz; \
  chmod +x /usr/local/bin/llama-swap /opt/llama/llama-server

ENV LD_LIBRARY_PATH=/opt/llama:${LD_LIBRARY_PATH}
RUN useradd -r -u 10101 -m -d /home/llm llm
USER llm
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD curl -fsS http://127.0.0.1:8080/health || exit 1
ENTRYPOINT ["/usr/local/bin/llama-swap", "-config", "/config/llama-swap.yaml", "-listen", "0.0.0.0:8080", "-watch-config"]
