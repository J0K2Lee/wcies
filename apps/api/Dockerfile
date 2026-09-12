# WCIES API containerization (no new deps).
#
# Dev profile (target: dev)  - `nest start --watch`, source bind-mounted by
#                              compose (docker-compose.yml api-dev service).
#                              Standalone on purpose: building it needs NO
#                              network, because the host's proxy DNS hands
#                              out unroutable fake IPs to builds at random.
#                              Dependencies are installed on the container's
#                              first start into compose volumes, where DNS
#                              is pinned to public resolvers (compose `dns:`)
#                              and the npmmirror CDN is directly reachable.
# Prod profile (default)     - multi-stage build; needs the registry at build
#                              time (retry if the fake-IP draw bites - see
#                              README troubleshooting).
#
# Build:
#   docker build --target dev -t wcies-api-dev .
#   docker build              -t wcies-api .

# ---- Dev image: nest start --watch (source bind-mounted by compose) ----
FROM node:24-alpine AS dev
ENV COREPACK_NPM_REGISTRY=https://registry.npmmirror.com
ENV npm_config_registry=https://registry.npmmirror.com
RUN corepack enable
WORKDIR /app
EXPOSE 3000
# Self-healing start: on the first run the compose node_modules volumes are
# empty, so this installs the workspace there (volumes only - the container
# never writes node_modules into the host working tree) and builds the
# @wcies/* dists that workspace imports need. Later starts are a no-op.
CMD ["sh", "-c", "pnpm install --frozen-lockfile && pnpm build:packages && pnpm --filter @wcies/api dev"]

# ---- Stage 1: build (prod target only) ----
FROM node:24-alpine AS build
ENV COREPACK_NPM_REGISTRY=https://registry.npmmirror.com
ENV npm_config_registry=https://registry.npmmirror.com
RUN corepack enable
WORKDIR /app

# Workspace-aware install: copy lockfile + manifests first for layer caching.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/api-client/package.json packages/api-client/
COPY packages/platform-contracts/package.json packages/platform-contracts/
RUN pnpm install --frozen-lockfile

# Build workspace packages, then the API itself.
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm build:packages && pnpm --filter @wcies/api build

# ---- Stage 2: production (default target) ----
FROM node:24-alpine AS production
ENV COREPACK_NPM_REGISTRY=https://registry.npmmirror.com
ENV npm_config_registry=https://registry.npmmirror.com
RUN corepack enable
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/api-client/package.json packages/api-client/
COPY packages/platform-contracts/package.json packages/platform-contracts/
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY database ./database
COPY scripts ./scripts
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
