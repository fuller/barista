FROM --platform=linux/amd64 node:24-bookworm-slim

# The transport launches the installed Google Chrome channel, not bundled Chromium.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg xvfb tini \
 && install -d -m 0755 /etc/apt/keyrings \
 && curl -fsSL https://dl.google.com/linux/linux_signing_key.pub \
    | gpg --dearmor -o /etc/apt/keyrings/google-chrome.gpg \
 && echo 'deb [arch=amd64 signed-by=/etc/apt/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main' > /etc/apt/sources.list.d/google-chrome.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends google-chrome-stable \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --chown=node:node src/browser/ ./src/browser/
COPY --chown=node:node src/adapters/ ./src/adapters/
COPY --chown=node:node scripts/browser-pricing.mjs ./scripts/browser-pricing.mjs
COPY --chown=node:node --chmod=755 deploy/browser/start.sh ./deploy/browser/start.sh

ENV NODE_ENV=production \
    DISPLAY=:99 \
    BARISTA_BROWSER_HOST=0.0.0.0 \
    BARISTA_BROWSER_PORT=4174
USER node
EXPOSE 4174
ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/app/deploy/browser/start.sh"]
