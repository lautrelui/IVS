FROM node:20-alpine

WORKDIR /app

# Install dependencies first (layer caching)
COPY package.json ./
RUN npm install --omit=dev

# Copy application
COPY src/ ./src/
COPY public/ ./public/
COPY keys/ ./keys/

# Non-root user
RUN addgroup -g 1001 ivs && adduser -u 1001 -G ivs -s /bin/sh -D ivs
RUN chown -R ivs:ivs /app
USER ivs

EXPOSE 3011

ENV NODE_ENV=production
ENV PORT=3011

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:3011/api/v1/health || exit 1

CMD ["node", "src/index.js"]
