FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core util-linux && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY server.mjs render.mjs ./
ENV HIGHLIGHT_DATA_DIR=/data/highlights
CMD ["sh", "-c", "mkdir -p /data/highlights && chown node:node /data/highlights && exec runuser -u node -- node server.mjs"]
