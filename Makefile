# Threadline — task runner.
#
# `make` with no target prints every target and what it does. The npm scripts in
# package.json remain the source of truth for what each task actually runs; this
# file is a discoverable front door to them, plus the multi-step workflows that
# would be awkward as one-line npm scripts.
#
#   make help          every target, grouped
#   make setup         fresh clone → running environment
#   make dev           all three services locally
#   make check         what CI gates a merge on
#
# Requires GNU make 3.81+ (the version macOS ships) and bash.

SHELL := /usr/bin/env bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help

# Every target here is a verb, not a file, so none of them should be skipped
# because a directory of the same name happens to exist.
.PHONY: help setup install doctor clean clean-all \
        dev dev-api dev-realtime dev-web \
        check check-fix fast-check format format-check lint lint-fix lint-shell \
        typecheck test test-watch test-browser test-coverage coverage \
        build docs docs-serve docs-watch docs-check docs-links \
        docker-up docker-down docker-build docker-logs \
        k8s-validate openapi release-plan release-notes \
        hooks verify-commit verify-staged \
        ci audit outdated update-check \
        ports kill-ports info

# ── Presentation ──────────────────────────────────────────────────────────────
BOLD  := $(shell tput bold 2>/dev/null || true)
DIM   := $(shell tput dim 2>/dev/null || true)
RESET := $(shell tput sgr0 2>/dev/null || true)
CYAN  := $(shell tput setaf 6 2>/dev/null || true)

##@ Getting started

help: ## Show this help
	@printf '\n$(BOLD)Threadline$(RESET) — a real-time collaboration platform\n'
	@printf '$(DIM)  apps/api (Node) · apps/realtime (workerd) · apps/web (Next.js)$(RESET)\n\n'
	@awk 'BEGIN { FS = ":.*##" } \
		/^##@/ { printf "\n$(BOLD)%s$(RESET)\n", substr($$0, 5); next } \
		/^[a-zA-Z0-9_-]+:.*?##/ { printf "  $(CYAN)%-18s$(RESET) %s\n", $$1, $$2 }' $(MAKEFILE_LIST)
	@printf '\n$(DIM)  Full documentation: README.md and docs/$(RESET)\n\n'

setup: ## Fresh clone → running environment (idempotent)
	@./scripts/bootstrap.sh

install: ## Install dependencies exactly as the lockfile specifies
	@npm ci

doctor: ## Diagnose the local environment and say what to fix
	@npm run --silent doctor

info: ## Print versions and repository state
	@printf '\n$(BOLD)Toolchain$(RESET)\n'
	@printf '  node       %s\n' "$$(node -v)"
	@printf '  npm        %s\n' "$$(npm -v)"
	@printf '  docker     %s\n' "$$(docker --version 2>/dev/null || echo 'not installed')"
	@printf '  kubectl    %s\n' "$$(kubectl version --client -o yaml 2>/dev/null | awk '/gitVersion/{print $$2; exit}' || echo 'not installed')"
	@printf '\n$(BOLD)Repository$(RESET)\n'
	@printf '  branch     %s\n' "$$(git rev-parse --abbrev-ref HEAD)"
	@printf '  commit     %s\n' "$$(git rev-parse --short HEAD)"
	@printf '  status     %s file(s) changed\n' "$$(git status --porcelain | wc -l | tr -d ' ')"
	@printf '\n'

##@ Development

dev: ## Run all three services (api :4000, realtime :8787, web :3000)
	@npm run dev

dev-api: ## Run apps/api only, on :4000
	@npm run dev:api:local

dev-realtime: ## Run apps/realtime only, on :8787
	@npm run dev:realtime:local

dev-web: ## Run apps/web only, on :3000
	@npm run dev:web:local

ports: ## Show what is listening on the development ports
	@for port in 3000 4000 8787 27017; do \
		owner=$$(lsof -nP -iTCP:$$port -sTCP:LISTEN 2>/dev/null | awk 'NR==2 {print $$1" (pid "$$2")"}'); \
		printf '  %-6s %s\n' "$$port" "$${owner:-free}"; \
	done

kill-ports: ## Free the development ports (asks first)
	@printf 'This kills every process listening on 3000, 4000, and 8787.\n'
	@read -r -p 'Continue? [y/N] ' reply; \
	case "$$reply" in [yY]*) \
		for port in 3000 4000 8787; do \
			pids=$$(lsof -ti:$$port 2>/dev/null || true); \
			if [ -n "$$pids" ]; then echo "$$pids" | xargs kill && printf '  killed %s on %s\n' "$$pids" "$$port"; fi; \
		done ;; \
	*) printf '  cancelled\n' ;; esac

##@ Quality gates

check: ## Everything CI gates a merge on — format, lint, typecheck, test, build
	@./scripts/check.sh

check-fix: ## Fix formatting and lint, then run the full check
	@./scripts/check.sh --fix

fast-check: ## The full check without the build (the slowest step)
	@./scripts/check.sh --fast

format: ## Rewrite every file with prettier
	@npm run format

format-check: ## Verify formatting without rewriting
	@npm run format:check

lint: ## eslint, warnings treated as failures
	@npm run lint

lint-fix: ## eslint with --fix
	@npm run lint:fix

lint-shell: ## bash -n on every shell script, plus shellcheck when installed
	@node scripts/lint-shell.mjs

typecheck: ## tsc --noEmit across all three workspaces
	@npm run typecheck

##@ Tests

test: ## Run the api and realtime suites
	@npm test

test-watch: ## Re-run tests on change
	@npm run test:watch

test-browser: ## Run the Playwright suite
	@npm run test:browser

test-coverage: ## Run tests with a coverage report
	@npm run test:coverage

coverage: test-coverage ## Alias for test-coverage

##@ Build and documentation

build: ## Production build for every workspace
	@npm run build

docs: ## Generate the TypeDoc reference into docs/api-reference/
	@npm run docs

docs-serve: ## Generate the reference and serve it on :8080
	@npm run docs:serve

docs-watch: ## Regenerate the reference on change
	@npm run docs:watch

docs-check: ## Verify the reference builds without writing it
	@npm run docs:check

docs-links: ## Verify every relative markdown link resolves
	@npm run docs:links

openapi: ## Write the OpenAPI specification to openapi.json
	@npm run --silent openapi

##@ Releases

release-plan: ## Show what the next release would be, and why
	@npm run --silent release:plan

release-notes: ## Print just the generated release notes for the next release
	@npm run --silent release:notes

##@ Containers and deployment

docker-up: ## Build and start the full stack in Docker, with Mongo
	@npm run docker:up

docker-down: ## Stop the Docker stack and remove orphans
	@npm run docker:down

docker-build: ## Build the container images without starting them
	@npm run docker:build

docker-logs: ## Follow the Docker stack logs
	@npm run docker:logs

k8s-validate: ## Render both kustomize overlays to prove they are valid
	@npm run k8s:validate

##@ Git and hygiene

hooks: ## (Re)install the husky git hooks
	@npm run prepare
	@printf '  pre-commit, commit-msg, pre-push installed\n'

verify-commit: ## Validate a message — make verify-commit MSG="feat(web): add a thing"
	@node scripts/verify-commit-message.mjs --message "$(MSG)"

verify-staged: ## Run the pre-commit guard against what is staged now
	@node scripts/guard-staged.mjs

audit: ## Report known vulnerabilities in dependencies
	@npm audit --audit-level=high || true

outdated: ## Show dependencies behind their latest release
	@npm outdated || true

update-check: audit outdated ## audit + outdated together

##@ Cleaning

clean: ## Remove build output, caches, and generated docs
	@npm run clean

clean-all: ## The above, plus every node_modules
	@npm run clean:all

##@ CI

ci: ## Exactly what the CI pipeline runs, in order
	@npm ci
	@npm run format:check
	@npm run lint
	@npm run typecheck
	@npm test
	@npm run build
	@npm run docs:check
