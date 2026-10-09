FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npx playwright install --with-deps chromium
COPY server ./server
ENV NODE_ENV=production TRACE_HOSTED=1 TRACE_BROWSER_CHANNEL=chromium TRACE_DATA_DIR=/app/storage
EXPOSE 4310
CMD ["node", "server/index.mjs"]
