FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/realtime/package.json apps/realtime/package.json
RUN npm ci --workspace=@threadline/realtime --include-workspace-root

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=development
COPY --chown=node:node --from=dependencies /app/node_modules ./node_modules
COPY --chown=node:node --from=dependencies /app/apps/realtime/node_modules ./apps/realtime/node_modules
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node apps/realtime ./apps/realtime
# This fixture has deliberately non-production values. Cloudflare secrets stay
# in Cloudflare; production images never run this local Durable Object emulator.
COPY --chown=node:node infra/docker/realtime.dev.vars /app/apps/realtime/.dev.vars
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
USER node
EXPOSE 8787
CMD ["node", "/app/apps/realtime/node_modules/wrangler/bin/wrangler.js", "dev", "--local", "--ip", "0.0.0.0", "--port", "8787", "--persist-to", "/tmp/threadline-wrangler-state"]
