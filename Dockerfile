FROM node:20-alpine

WORKDIR /app

# Install Chromium (Puppeteer) and native libs needed by sharp/@napi-rs/canvas/tesseract
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    vips-dev \
    fontconfig \
    python3 \
    make \
    g++

# Tell Puppeteer to use the installed Chromium instead of downloading its own
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Copy package files
COPY package.json yarn.lock ./

# Install dependencies (yarn picks the correct sharp prebuilt binary for linuxmusl)
RUN yarn install --frozen-lockfile --network-timeout 600000

# Copy source code
COPY . .

# Build application
RUN yarn build

# Expose port
EXPOSE 3000

# Start application
CMD ["yarn", "start:prod"]

