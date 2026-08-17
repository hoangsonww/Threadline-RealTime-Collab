# Dev container image for Threadline.
#
# Based on the Microsoft TypeScript/Node image, which already provides a
# non-root `node` user, a sane shell setup, and the git/zsh plumbing the dev
# container spec expects. Everything added here is a tool one of this
# repository's checks actually invokes — nothing is installed speculatively.

ARG NODE_VERSION=22
FROM mcr.microsoft.com/devcontainers/typescript-node:1-${NODE_VERSION}-bookworm

# `mongosh` for inspecting the sidecar database, and `shellcheck` because
# scripts/lint-shell.mjs will use it when present and degrade to a bare syntax
# check when it is not — inside the container it should always be present.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      gnupg \
      jq \
      less \
      make \
      shellcheck \
      lsof \
    ; \
    curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc \
      | gpg --dearmor -o /usr/share/keyrings/mongodb-server-8.0.gpg; \
    echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/debian bookworm/mongodb-org/8.0 main" \
      > /etc/apt/sources.list.d/mongodb-org-8.0.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends mongodb-mongosh; \
    apt-get clean; \
    rm -rf /var/lib/apt/lists/*

# Playwright's browsers and their system libraries. `npm run test:browser` only
# uses Chromium (see the CI workflow), so only Chromium is installed — the full
# browser set roughly triples the image size for no benefit here.
ENV PLAYWRIGHT_BROWSERS_PATH=/home/node/.cache/ms-playwright
RUN set -eux; \
    npx --yes playwright@latest install --with-deps chromium; \
    chown -R node:node /home/node/.cache

# Wrangler writes its login and local state under the user's home directory,
# which must be writable by the non-root user the container actually runs as.
RUN mkdir -p /home/node/.wrangler /home/node/.npm && chown -R node:node /home/node

ENV NEXT_TELEMETRY_DISABLED=1 \
    DO_NOT_TRACK=1 \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

USER node
