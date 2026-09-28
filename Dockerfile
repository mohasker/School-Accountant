FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
# Outside demo mode every uploaded document must pass a virus scan. Signatures are fetched at
# build time: rebuild the image regularly (or run freshclam in the container) to refresh them.
ARG WITH_CLAMAV=true
RUN if [ "$WITH_CLAMAV" = "true" ]; then \
      apt-get update && apt-get install -y --no-install-recommends clamav ca-certificates && \
      (freshclam --stdout || echo "freshclam failed: run it again after start") && \
      rm -rf /var/lib/apt/lists/*; \
    fi
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3000 3001
CMD ["npm","run","start:api"]
