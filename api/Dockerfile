# ---- Build stage ----
FROM rust:1-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo "fn main() {}" > src/main.rs && cargo build --release && rm -rf src
COPY src ./src
COPY migrations ./migrations
RUN touch src/main.rs && cargo build --release

# ---- Runtime stage ----
FROM debian:trixie-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV SHOPHIPPY_MIGRATIONS_DIR=/app/migrations
COPY --from=build /app/target/release/shophippy-api /usr/local/bin/shophippy-api
COPY migrations /app/migrations
EXPOSE 8080
CMD ["shophippy-api"]
