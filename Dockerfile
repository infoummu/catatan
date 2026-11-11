# ============================================================
# markdown.gg — zero-knowledge markdown editor (Next.js 16)
# Build : docker compose up -d --build
# Akses : http://<ip-host>:8089
# ============================================================

# ---- stage 1: dependencies + build ----
FROM node:22-bookworm-slim AS builder

# alat kompilasi: jaring pengaman bila prebuilt better-sqlite3 gagal diunduh
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

# dependency dulu (layer cache)
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# source + build produksi
COPY . .
RUN npm run build

# ---- stage 2: runtime ----
FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATABASE_URL=file:/app/data/sqlite.db

# server standalone (sudah termasuk node_modules hasil tracing Next)
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

# modul native SQLite: pastikan binary .node ikut terbawa tracing
COPY --from=builder --chown=node:node /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=builder --chown=node:node /app/node_modules/bindings ./node_modules/bindings
COPY --from=builder --chown=node:node /app/node_modules/file-uri-to-path ./node_modules/file-uri-to-path

# folder data SQLite (bind mount menimpa ini saat runtime)
RUN mkdir -p /app/data && chown -R node:node /app/data

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
