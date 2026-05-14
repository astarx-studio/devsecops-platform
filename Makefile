# =============================================================================
# DevSecOps platform — convenience targets (Phase 6 replicability)
# =============================================================================
# Requires: GNU Make, Bash, Docker. Run from repo root (same directory as
# docker-compose.yml).
# =============================================================================

SHELL := /bin/bash
ROOT := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))
BOOT := $(ROOT)bootstrap

.PHONY: help bootstrap smoke smoke-deploy reset backup restore migrate-v1

help:
	@echo "Targets:"
	@echo "  make bootstrap     - ./bootstrap/bootstrap.sh (compose → k3d → vault auth → RBAC → seed → smoke)"
	@echo "  make smoke         - ./bootstrap/smoke-test.sh (lightweight infra checks)"
	@echo "  make smoke-deploy  - ./bootstrap/smoke-deploy.sh (full provision + pipeline + URL; optional --cleanup via script)"
	@echo "  make reset         - ./bootstrap/reset.sh (k3d only; pass ARGS=--all for compose down -v)"
	@echo "  make backup        - ./bootstrap/backup.sh → backups/platform-<timestamp>.tar.gz"
	@echo "  make restore       - requires ARCHIVE=backups/platform-....tar.gz (compose stack must be down)"
	@echo "  make migrate-v1    - prints __DOCS__/01_infra/07_v1_migration.md (manual operator workflow)"

bootstrap:
	@"$(BOOT)/bootstrap.sh"

smoke:
	@"$(BOOT)/smoke-test.sh"

smoke-deploy:
	@"$(BOOT)/smoke-deploy.sh"

backup:
	@"$(BOOT)/backup.sh"

restore:
	@if [ -z "$(ARCHIVE)" ]; then \
	  echo "Usage: make restore ARCHIVE=backups/platform-YYYYMMDD-HHMMSS.tar.gz" >&2; \
	  exit 1; \
	fi
	@"$(BOOT)/restore.sh" "$(ARCHIVE)"

reset:
	@"$(BOOT)/reset.sh" $(ARGS)

migrate-v1:
	@echo "v1 → Auto DevOps migration is a rare, manual workflow (no bundled script)."
	@echo "See: $(ROOT)__DOCS__/01_infra/07_v1_migration.md"
