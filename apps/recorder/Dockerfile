# Build context: the repo root (infra/lib/recorder-stack.ts). ARM64 for Fargate Graviton.
FROM node:24-slim AS build
RUN npm install -g pnpm@11.25.0
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter "@apuracao/recorder..."
RUN pnpm turbo run build --filter "@apuracao/recorder..."
# --legacy: pnpm 10+ deploys injected workspaces only; this copies built workspace deps.
RUN pnpm --filter @apuracao/recorder deploy --prod --legacy /app

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app .
USER node
CMD ["node", "dist/main.js"]
