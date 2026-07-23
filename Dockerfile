# ============================================================
# LinguaTree / ByteCrystal — Full-Stack Docker Image
# Express serves both API (/api/*) and static frontend (public/)
# ============================================================

# ---------- Stage 1: Build frontend ----------
FROM node:18-bookworm-slim AS frontend-builder

WORKDIR /app/frontend

# Copy frontend package files
COPY frontend/package.json frontend/package-lock.json ./

# Install frontend dependencies
RUN npm ci

# Copy frontend source and Vite config
COPY frontend/ ./

# Build frontend → outputs to /app/public (per vite.config.js outDir: '../public')
RUN npm run build

# ---------- Stage 2: Runtime ----------
FROM node:18-bookworm-slim AS runtime

# Install system dependencies:
#   - ffmpeg: video processing (audio extraction, keyframe extraction)
#   - python3 + pip: ASR scripts (DashScope Paraformer)
#   - yt-dlp: video download (Douyin, Bilibili, etc.)
#   - curl: health checks
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    python3-pip \
    python3-requests \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && pip3 install --no-cache-dir --break-system-packages requests dashscope

# Install yt-dlp via pip (lightweight, no system package in Debian)
RUN pip3 install --no-cache-dir --break-system-packages yt-dlp

WORKDIR /app

# Copy backend package files and install dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy backend source
COPY src/ ./src/

# Copy built frontend from Stage 1
COPY --from=frontend-builder /app/public ./public

# Create temp directory for video processing
RUN mkdir -p /app/temp

# Expose port (Render sets PORT env var automatically)
ENV PORT=3000
ENV NODE_ENV=production
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:${PORT:-3000}/health || exit 1

# Start the server (initSchema() runs automatically on startup)
CMD ["node", "src/server.js"]
