# Build context: repository root (Cargo workspace lives here).

FROM rust:1.89-bookworm AS builder
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
RUN cargo build --release --locked -p server

FROM debian:bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /cache
COPY --from=builder /app/target/release/server /usr/local/bin/server
ENV CACHE_DIR=/cache
EXPOSE 3100
ENTRYPOINT ["/usr/local/bin/server"]
