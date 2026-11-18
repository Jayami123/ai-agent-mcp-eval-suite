# The suite's fixture stub, run as a container on the shared qa-harness-p4 network so LiteLLM can reach it by alias.
# Build the TypeScript first (npm run build); this image only copies dist/stub and the fixtures. No dependencies.
FROM node:22-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee
WORKDIR /app
COPY package.json ./package.json
COPY dist/stub ./dist/stub
COPY src/stub/fixtures ./src/stub/fixtures
ENV STUB_HOST=0.0.0.0 STUB_PORT=8787
USER node
EXPOSE 8787
HEALTHCHECK --interval=2s --timeout=3s --retries=30 CMD ["node", "-e", "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "dist/stub/main.js"]
