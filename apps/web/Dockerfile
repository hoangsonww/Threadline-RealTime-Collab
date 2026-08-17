FROM node:26-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
RUN npm ci --workspace=@threadline/web --include-workspace-root

FROM node:26-alpine AS builder
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY apps/web ./apps/web

# Public values are embedded by Next.js at build time. Keep credentials out of
# these arguments; use the API's runtime environment and Kubernetes Secrets.
# NEXT_PUBLIC_SENTRY_DSN is not a credential — it's a public client key already
# shipped to every browser that loads the page — but it's still build-time-only
# like every other NEXT_PUBLIC_* value, so it belongs here, not in the runtime
# container env. Left unset, the build is inert (see apps/web/sentry.*.config.ts).
ARG NEXT_PUBLIC_API_ORIGIN=/api/identity
ARG NEXT_PUBLIC_REALTIME_ORIGIN=http://localhost:8787
ARG NEXT_PUBLIC_ICE_SERVERS
ARG NEXT_PUBLIC_SENTRY_DSN
ARG THREADLINE_API_ORIGIN
ENV NEXT_PUBLIC_API_ORIGIN=${NEXT_PUBLIC_API_ORIGIN} \
    NEXT_PUBLIC_REALTIME_ORIGIN=${NEXT_PUBLIC_REALTIME_ORIGIN} \
    NEXT_PUBLIC_ICE_SERVERS=${NEXT_PUBLIC_ICE_SERVERS} \
    NEXT_PUBLIC_SENTRY_DSN=${NEXT_PUBLIC_SENTRY_DSN} \
    THREADLINE_API_ORIGIN=${THREADLINE_API_ORIGIN}
RUN npm run build --workspace=@threadline/web

FROM node:26-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --chown=node:node --from=builder /app/apps/web/.next/standalone ./
COPY --chown=node:node --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --chown=node:node --from=builder /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
