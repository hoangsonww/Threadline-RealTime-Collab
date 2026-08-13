FROM node:22-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/realtime/package.json apps/realtime/package.json
RUN npm ci --workspace=@threadline/realtime --include-workspace-root

FROM node:22-alpine AS runtime
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
