FROM node:22-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
RUN npm ci --workspace=@threadline/api --include-workspace-root

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=4000
COPY --chown=node:node --from=dependencies /app/node_modules ./node_modules
COPY --chown=node:node --from=dependencies /app/apps/api/node_modules ./apps/api/node_modules
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node apps/api ./apps/api
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
USER node
EXPOSE 4000
CMD ["node", "/app/node_modules/tsx/dist/cli.mjs", "apps/api/src/index.ts"]
