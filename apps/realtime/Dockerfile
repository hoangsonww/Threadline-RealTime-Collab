# Debian rather than Alpine, unlike apps/api and apps/web.
#
# This is the one image in the repository that runs a native binary. `wrangler
# dev --local` spawns workerd from @cloudflare/workerd-linux-<arch>, and those
# builds are dynamically linked against glibc. On Alpine (musl) the binary
# installs and looks entirely correct — 130 MB, executable, right path — but
# `execve` fails because its ELF interpreter, /lib/ld-linux-<arch>.so.1, does
# not exist there. Linux reports a missing interpreter as ENOENT on the binary
# itself, so the symptom is a "file not found" error naming a file that is
# plainly present:
#
#   Error: spawn /app/node_modules/@cloudflare/workerd-linux-arm64/bin/workerd ENOENT
#
# Note that the image still *builds* on Alpine — nothing fails until the
# container is started — which is why `docker compose build` alone cannot catch
# this. The CI containers job starts the stack and waits for health for exactly
# that reason.
FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/realtime/package.json apps/realtime/package.json
RUN npm ci --workspace=@threadline/realtime --include-workspace-root

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=development
COPY --chown=node:node --from=dependencies /app/node_modules ./node_modules
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node apps/realtime ./apps/realtime
# This fixture has deliberately non-production values. Cloudflare secrets stay
# in Cloudflare; production images never run this local Durable Object emulator.
COPY --chown=node:node infra/docker/realtime.dev.vars /app/apps/realtime/.dev.vars
USER node
EXPOSE 8787
CMD ["npm", "exec", "--workspace=@threadline/realtime", "--", "wrangler", "dev", "--local", "--ip", "0.0.0.0", "--port", "8787", "--persist-to", "/tmp/threadline-wrangler-state"]
