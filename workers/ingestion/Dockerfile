FROM node:20-alpine

WORKDIR /app

# Copy root workspace files
COPY package.json package-lock.json* turbo.json tsconfig.json ./

# Copy workspace packages the worker depends on
COPY packages/shared/ ./packages/shared/
COPY packages/business-rules/ ./packages/business-rules/
COPY packages/db/ ./packages/db/

# Copy the worker itself
COPY workers/ingestion/ ./workers/ingestion/

# Install all dependencies (workspace-aware)
RUN npm install --workspace=workers/ingestion

# Run
CMD ["npx", "tsx", "workers/ingestion/src/index.ts"]
