# =============================================================================
# DevSecOps platform — convenience targets (Phase 6 replicability)
# =============================================================================
# Requires: GNU Make, Bash, Docker. Run from repo root (same directory as
# docker-compose.yml).
#
# On Windows, prefer running make from Git Bash. GnuWin32 Make 3.81 breaks
# recipes when SHELL resolves to a path with spaces (e.g. Program Files/Git).
# =============================================================================

# MSYS path has no spaces; avoids GnuWin32 sh -c quoting failures on Windows.
SHELL := /usr/bin/bash
ROOT := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))

.PHONY: help bootstrap update-dso-configs smoke smoke-deploy smoke-cleanup reset backup restore migrate-v1 verify-sonar

help:
	@echo "Targets:"
	@echo "  make bootstrap          - ./bootstrap/bootstrap.sh (compose + Sonar init → k3d → vault auth → RBAC → seed → smoke)"
	@echo "  make update-dso-configs - ./bootstrap/seed-platform-projects.sh (push configs/* to GitLab; no full bootstrap)"
	@echo "  make verify-sonar  - scripts/verify-sonar-setup.sh (Sonar .env, properties, containers)"
	@echo "  make smoke         - ./bootstrap/smoke-test.sh (lightweight infra checks)"
	@echo "  make smoke-deploy  - ./bootstrap/smoke-deploy.sh (smoke-api + smoke-web; ARGS='--cleanup' tears down)"
	@echo "  make smoke-cleanup - ./bootstrap/smoke-cleanup.sh (hard-delete smoke group only)"
	@echo "  make reset         - ./bootstrap/reset.sh (k3d only; pass ARGS=--all for compose down -v)"
	@echo "  make backup        - ./bootstrap/backup.sh → backups/platform-<timestamp>.tar.gz"
	@echo "  make restore       - requires ARCHIVE=backups/platform-....tar.gz (compose stack must be down)"
	@echo "  make migrate-v1    - prints __DOCS__/01_infra/07_v1_migration.md (manual operator workflow)"

bootstrap:
	@cd "$(ROOT)" && bash ./bootstrap/bootstrap.sh

update-dso-configs:
	@cd "$(ROOT)" && bash ./bootstrap/seed-platform-projects.sh

verify-sonar:
	@cd "$(ROOT)" && bash ./scripts/verify-sonar-setup.sh

smoke:
	@cd "$(ROOT)" && bash ./bootstrap/smoke-test.sh

smoke-deploy:
	@cd "$(ROOT)" && bash ./bootstrap/smoke-deploy.sh $(ARGS)

smoke-cleanup:
	@cd "$(ROOT)" && bash ./bootstrap/smoke-cleanup.sh

backup:
	@cd "$(ROOT)" && bash ./bootstrap/backup.sh

restore:
	@if [ -z "$(ARCHIVE)" ]; then \
	  echo "Usage: make restore ARCHIVE=backups/platform-YYYYMMDD-HHMMSS.tar.gz" >&2; \
	  exit 1; \
	fi
	@cd "$(ROOT)" && bash ./bootstrap/restore.sh "$(ARCHIVE)"

reset:
	@cd "$(ROOT)" && bash ./bootstrap/reset.sh $(ARGS)

migrate-v1:
	@echo "v1 → Auto DevOps migration is a rare, manual workflow (no bundled script)."
	@echo "See: $(ROOT)__DOCS__/01_infra/07_v1_migration.md"
