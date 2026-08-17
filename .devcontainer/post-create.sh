#!/usr/bin/env bash
# Runs once, when the dev container is first created.
#
# Kept separate from scripts/bootstrap.sh on purpose: bootstrap targets a host
# machine and probes for tools that may be missing, whereas in here the image
# guarantees the toolchain and the only open questions are the repository's own
# state. What the two share is the outcome — a checkout you can immediately run.

set -euo pipefail

cd /workspaces/threadline

printf '\n\033[1m▸ Threadline dev container — first-run setup\033[0m\n\n'

# ── Dependencies ──────────────────────────────────────────────────────────────
printf '· installing dependencies (npm ci)\n'
npm ci --no-fund --no-audit

# ── Git hooks ─────────────────────────────────────────────────────────────────
# The bind mount can carry hook files from the host with host permissions, so
# re-assert both the hooks path and the executable bits inside the container.
printf '· wiring git hooks\n'
npm run --silent prepare
chmod +x .husky/pre-commit .husky/commit-msg .husky/pre-push 2>/dev/null || true
chmod +x scripts/*.sh scripts/*.mjs scripts/lib/*.sh 2>/dev/null || true

# `..` inside the container is not the host's checkout, so git's ownership
# heuristics flag the bind mount as untrusted. This is the documented fix.
git config --global --add safe.directory /workspaces/threadline

# ── Local environment files ───────────────────────────────────────────────────
printf '· seeding local environment files\n'
seed() {
  if [ -f "$2" ]; then
    printf '  %s already exists\n' "$2"
  elif [ -f "$1" ]; then
    cp "$1" "$2"
    printf '  created %s\n' "$2"
  fi
}

seed apps/web/.env.example apps/web/.env.local
seed apps/realtime/.dev.vars.example apps/realtime/.dev.vars

# ── Verify ────────────────────────────────────────────────────────────────────
printf '\n· verifying\n'
if npm run --silent typecheck; then
  printf '  \033[32m✓\033[0m typecheck passes\n'
else
  printf '  \033[31m✖\033[0m typecheck failed — the container is usable, but something is wrong upstream\n'
fi

if command -v mongosh >/dev/null 2>&1; then
  if mongosh --quiet --eval 'db.adminCommand("ping").ok' "mongodb://mongo:27017/admin" >/dev/null 2>&1; then
    printf '  \033[32m✓\033[0m MongoDB sidecar reachable at mongodb://mongo:27017\n'
  else
    printf '  \033[33m!\033[0m MongoDB sidecar not answering yet — it may still be starting\n'
  fi
fi

# ── What next ─────────────────────────────────────────────────────────────────
cat <<'EOF'

  Ready.

    npm run dev      api :4000 · realtime :8787 · web :3000
    make help        every available target
    make check       what CI gates a merge on
    npm run doctor   diagnose the environment

  MONGODB_URI is already pointed at the sidecar — the API persists by default
  in here, rather than falling back to the in-memory repository.

EOF
