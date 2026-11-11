FROM node:24.21.0-bookworm-slim
WORKDIR /app
COPY infra/simulation/server.mjs infra/simulation/providers.mjs ./infra/simulation/
COPY infra/n8n/workflows/providers/operational-*.mjs ./infra/n8n/workflows/providers/
USER node
CMD ["node","infra/simulation/server.mjs"]
