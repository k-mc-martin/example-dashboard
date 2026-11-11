FROM node:24.21.0-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends chromium ca-certificates fonts-liberation && rm -rf /var/lib/apt/lists/*
WORKDIR /runner
COPY tests/browser/package*.json ./tests/browser/
RUN npm ci --prefix tests/browser --ignore-scripts --no-fund --no-audit && install -d -o node -g node /suite-jobs
COPY tests/browser/dashboard.test.mjs tests/browser/suite-observer.mjs ./tests/browser/
COPY lib/security-lab/catalog.ts ./lib/security-lab/
COPY lib/review/queue.ts lib/review/facts.ts ./lib/review/
COPY infra/suite/worker.mjs ./infra/suite/
ENV SECDASH_CHROME_PATH=/usr/bin/chromium HOME=/tmp
USER node
CMD ["node","infra/suite/worker.mjs"]
