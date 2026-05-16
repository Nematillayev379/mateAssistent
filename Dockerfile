FROM node:20-slim

# Install system dependencies for media processing
RUN apt-get update && apt-get install -y \
    python3 \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install yt-dlp
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

COPY package*.json ./
# BUG #150 Fix: Use npm ci for deterministic builds
RUN npm ci

COPY . .
# BUG #150 Fix: Install yt-dlp via script during build
RUN node scripts/install-ytdlp.js
RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
