#!/usr/bin/env bash
# One command to take a fresh clone to a running development environment.
#
#   ./scripts/bootstrap.sh
#
# Idempotent: safe to re-run after pulling, after switching branches, or when
# something feels stale. It never overwrites an existing local env file.

# shellcheck source=scripts/lib/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

cd "$REPO_ROOT" || die "Cannot enter the repository root at $REPO_ROOT"

printf '%s\n' "$C_BOLD"
cat <<'BANNER'
  Threadline — bootstrap
  Three services: apps/api (Node), apps/realtime (workerd), apps/web (Next.js)
BANNER
printf '%s\n' "$C_RESET"

# ── Toolchain ─────────────────────────────────────────────────────────────────
heading "Checking the toolchain"

check_node
ok "node $(node -v)"

require npm
ok "npm $(npm -v)"

if has docker; then
  ok "docker $(docker --version | sed 's/Docker version //; s/,.*//')"
else
  warn "docker not found — \`npm run docker:up\` and the container CI job will not work locally."
  note "Everything else, including \`npm run dev\`, works without it."
fi

if has kubectl; then
  ok "kubectl $(kubectl version --client -o json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).clientVersion.gitVersion)}catch{console.log("(unknown)")}})' 2>/dev/null || echo "(unknown)")"
else
  warn "kubectl not found — \`npm run k8s:validate\` will not work locally."
fi

# ── Dependencies ──────────────────────────────────────────────────────────────
heading "Installing dependencies"

if [ -f package-lock.json ]; then
  step "npm ci (lockfile is authoritative)"
  # `npm ci` deletes node_modules and reinstalls from the lockfile exactly. It
  # is both faster and more reproducible than `npm install` for a clean setup,
  # and it fails loudly if package.json and the lockfile disagree.
  npm ci
else
  step "npm install (no lockfile found)"
  npm install
fi
ok "dependencies installed"

# ── Git hooks ─────────────────────────────────────────────────────────────────
heading "Wiring git hooks"

# `npm ci` runs `prepare`, which runs husky. This is belt-and-braces for the
# case where someone installed with --ignore-scripts.
npm run --silent prepare
for hook in pre-commit commit-msg pre-push; do
  if [ -x ".husky/$hook" ]; then
    ok ".husky/$hook"
  else
    warn ".husky/$hook is missing or not executable"
  fi
done

# ── Local environment files ───────────────────────────────────────────────────
heading "Local environment files"

seed_env() {
  local example="$1" target="$2"

  if [ ! -f "$example" ]; then
    warn "$example is missing — skipping $target"
    return
  fi

  if [ -f "$target" ]; then
    ok "$target already exists (left untouched)"
    return
  fi

  cp "$example" "$target"
  ok "created $target from $(basename "$example")"
  note "Review it before starting the stack — the defaults are placeholders, not secrets."
}

seed_env "apps/web/.env.example" "apps/web/.env.local"
seed_env "apps/realtime/.dev.vars.example" "apps/realtime/.dev.vars"

# ── Verification ──────────────────────────────────────────────────────────────
heading "Verifying the install"

if npm run --silent typecheck; then
  ok "typecheck passes"
else
  err "typecheck failed on a fresh install — this is a repository problem, not yours."
  note "Please open an issue with the output above."
  exit 1
fi

# ── What next ─────────────────────────────────────────────────────────────────
heading "Ready"

cat <<EOF

  ${C_BOLD}Start everything${C_RESET}
    npm run dev             api :4000, realtime :8787, web :3000
    npm run docker:up       the same three services in containers, with Mongo

  ${C_BOLD}Before you push${C_RESET}
    npm run check           format, lint, typecheck, test, build — what CI gates on
    make help               every available target, with descriptions

  ${C_BOLD}Read next${C_RESET}
    README.md               what Threadline is
    docs/architecture.md    how the three services fit together
    CONTRIBUTING.md         conventions, and what a good PR looks like

EOF
