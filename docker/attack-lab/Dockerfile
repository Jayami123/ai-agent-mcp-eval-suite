# The attack-lab MCP server as a container on the shared qa-harness-p4 network, so LibreChat can reach it at
# http://p4-attack-lab:9010/mcp. Build context is the repo root (see docker/p4-lab.compose.yml).
# Three stages, all on the same digest-pinned base the fixture stub uses. The image holds only the lab's own runtime files:
# no tests, no harness, no root node_modules. Its manifest is docker/attack-lab/package.json (see that file).

FROM node:22-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS deps
WORKDIR /deps
COPY docker/attack-lab/package.json docker/attack-lab/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM node:22-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS build
WORKDIR /build
COPY docker/attack-lab/package.json docker/attack-lab/package-lock.json ./
RUN npm ci --ignore-scripts
COPY docker/attack-lab/tsconfig.json ./tsconfig.json
COPY src/attack-lab ./src/attack-lab
COPY src/stub/canonical.ts ./src/stub/canonical.ts
RUN npx tsc -p tsconfig.json

FROM node:22-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS runtime
WORKDIR /app
COPY docker/attack-lab/package.json ./package.json
COPY --from=deps /deps/node_modules ./node_modules
COPY --from=build /build/dist ./dist
# 0.0.0.0 only inside the container; the compose file publishes the ports on 127.0.0.1 only.
# LAB_CONTROL_TOKEN is NOT set here: it is passed at run time as an environment variable (never a build arg).
ENV LAB_HOST=0.0.0.0 LAB_MCP_PORT=9010 LAB_CONTROL_PORT=9011 LAB_SINK_PORT=9012
USER node
EXPOSE 9010 9011 9012
HEALTHCHECK --interval=2s --timeout=3s --retries=30 CMD ["node", "-e", "fetch('http://127.0.0.1:9012/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "dist/attack-lab/main.js"]
