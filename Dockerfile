FROM node:20-bookworm-slim

WORKDIR /app

# Install Chromium (Puppeteer) and runtime libs needed by tesseract/@napi-rs/canvas
# Debian glibc is officially supported by sharp prebuilt binaries (no compilation needed)
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    ca-certificates \
    fonts-liberation \
    fonts-noto-color-emoji \
    fontconfig \
    libnss3 \
    libfreetype6 \
    libharfbuzz0b \
    && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer to use the installed Chromium instead of downloading its own
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Copy package files
COPY package.json yarn.lock ./

# Install dependencies (sharp will use prebuilt linux-x64 binary, no native build)
RUN yarn install --frozen-lockfile --network-timeout 600000

# Copy source code
COPY . .

# Build application
RUN yarn build

# Expose port
EXPOSE 3000

# Start application
CMD ["yarn", "start:prod"]
