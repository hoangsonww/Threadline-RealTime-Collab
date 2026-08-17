FROM node:26-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
RUN npm ci --workspace=@threadline/api --include-workspace-root

FROM node:26-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=4000
COPY --chown=node:node --from=dependencies /app/node_modules ./node_modules
COPY --chown=node:node --from=dependencies /app/apps/api/node_modules ./apps/api/node_modules
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node apps/api ./apps/api
USER node
EXPOSE 4000
CMD ["npm", "run", "start", "--workspace=@threadline/api"]
