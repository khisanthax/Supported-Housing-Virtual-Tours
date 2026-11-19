# Supply an owner-reviewed official Node 24 image pinned by sha256 digest.
ARG NODE_IMAGE
FROM ${NODE_IMAGE}
WORKDIR /app
ENV NODE_ENV=production PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 WRANGLER_WRITE_LOGS=false WRANGLER_LOG_SANITIZE=true WRANGLER_SEND_METRICS=false LEVELTWO360_NO_DEV_VARS=1
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY . ./
RUN node cloudflare/prepare.mjs && mkdir -p /var/lib/leveltwo360 && chown node:node /var/lib/leveltwo360
USER node
ENV AGENCY_STATE_DIRECTORY=/var/lib/leveltwo360 AGENCY_BIND_HOST=0.0.0.0 AGENCY_CONTAINER_PROXY=1 PORT=4198
EXPOSE 4198
CMD ["node","agency/server.mjs"]
