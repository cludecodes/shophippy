# Shophippy combined image: builds the React dashboard and serves it from the
# Rust API on one origin. Deploy from the repository root:
#   flyctl deploy -a <app> -c api/fly.toml

# ---- Dashboard build (Node) ----
FROM node:20-alpine AS dashboard
WORKDIR /app
COPY dashboard/package.json dashboard/package-lock.json ./
RUN npm ci
COPY dashboard/ .
# Same-origin API: the dashboard calls /v1/* on its own host.
ENV VITE_API_URL=""
RUN npm run build

# ---- API build (Rust) ----
FROM rust:1-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
COPY api/Cargo.toml api/Cargo.lock ./
RUN mkdir src && echo "fn main() {}" > src/main.rs && cargo build --release && rm -rf src
COPY api/src ./src
COPY api/migrations ./migrations
RUN touch src/main.rs && cargo build --release

# ---- Runtime ----
FROM debian:trixie-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV SHOPHIPPY_MIGRATIONS_DIR=/app/migrations
ENV SHOPHIPPY_DASHBOARD_DIR=/app/dashboard
COPY --from=build /app/target/release/shophippy-api /usr/local/bin/shophippy-api
COPY --from=build /app/migrations /app/migrations
COPY --from=dashboard /app/dist /app/dashboard
EXPOSE 8080
CMD ["shophippy-api"]
