FROM --platform=linux/amd64 node:24-bookworm-slim
WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --chown=node:node src/services/ ./src/services/
COPY --chown=node:node src/adapters/ ./src/adapters/
COPY --chown=node:node src/domain/store-query.mjs ./src/domain/store-query.mjs
COPY --chown=node:node scripts/pricing-service.mjs ./scripts/pricing-service.mjs
ENV NODE_ENV=production PRICING_SERVICE_HOST=0.0.0.0 PRICING_SERVICE_PORT=4174
USER node
RUN node --input-type=module -e "await import('./src/services/pricing-api.mjs'); await import('./src/adapters/starbucks-guest-session.mjs')"
EXPOSE 4174
CMD ["node", "scripts/pricing-service.mjs"]
