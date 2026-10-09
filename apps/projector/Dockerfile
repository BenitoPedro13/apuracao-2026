# Build context: the repo root (infra/lib/projector-stack.ts). ARM64 for Fargate Graviton.
FROM node:24.21.0-slim AS build
RUN npm install -g pnpm@11.25.0
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter "@apuracao/projector..."
RUN pnpm turbo run build --filter "@apuracao/projector..."
# --legacy: pnpm 10+ deploys injected workspaces only; this copies built workspace deps.
RUN pnpm --filter @apuracao/projector deploy --prod --legacy /app

FROM node:24.21.0-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app .
USER node
CMD ["node", "dist/main.js", "run"]
