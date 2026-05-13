# =============================================================================
# DevSecOps platform — convenience targets (Phase 6 replicability)
# =============================================================================
# Requires: GNU Make, Bash, Docker. Run from repo root (same directory as
# docker-compose.yml).
# =============================================================================

SHELL := /bin/bash
ROOT := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))
BOOT := $(ROOT)bootstrap

.PHONY: help bootstrap smoke reset backup restore migrate-v1

help:
	@echo "Targets:"
	@echo "  make bootstrap     - ./bootstrap/bootstrap.sh (compose → k3d → vault auth → RBAC → seed → smoke)"
	@echo "  make smoke         - ./bootstrap/smoke-test.sh"
	@echo "  make reset         - not automated (see __DOCS__/01_infra/05_reset_from_zero.md)"
	@echo "  make backup        - not automated (archive .vols/ manually or extend Makefile)"
	@echo "  make restore       - not automated"
	@echo "  make migrate-v1    - not automated (operator-specific v1 cutover)"

bootstrap:
	@"$(BOOT)/bootstrap.sh"

smoke:
	@"$(BOOT)/smoke-test.sh"

reset backup restore migrate-v1:
	@echo >&2 "Target '$@' is not implemented in Make — see __DOCS__/01_infra/05_reset_from_zero.md and MIGRATION_PLAN_v2.md."; \
	exit 1
