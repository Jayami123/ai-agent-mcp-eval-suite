# The L4 mock channel (a Telegram Bot API-shaped server), run as a container on the shared qa-harness-p4 network so OpenClaw can
# reach it by alias. Build the TypeScript first (npm run build); this image only copies dist/mock-channel. No dependencies.
FROM node:22-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee
WORKDIR /app
COPY package.json ./package.json
COPY dist/mock-channel ./dist/mock-channel
ENV MOCK_CHANNEL_HOST=0.0.0.0 MOCK_CHANNEL_PORT=8788
USER node
EXPOSE 8788
HEALTHCHECK --interval=2s --timeout=3s --retries=30 CMD ["node", "-e", "fetch('http://127.0.0.1:8788/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "dist/mock-channel/main.js"]
