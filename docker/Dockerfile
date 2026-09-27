# napoland game server + web client in one small image.
#   build stage:   installs everything, builds the client (Vite) and bundles the server (esbuild)
#   runtime stage: Node + the bundle + static client files + content (maps, items, story) + SQL migrations
# The build stage runs on the builder's own CPU and makes only JavaScript, and the runtime stage has
# no RUN steps, so an arm64 image for the server builds fast on an x86 PC or CI without emulation.
FROM --platform=$BUILDPLATFORM node:24-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
RUN npm ci --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages packages
COPY apps apps
COPY content content
RUN npm run build -w @napoland/client && npm run build -w @napoland/server

FROM node:24-alpine AS runtime
# The commit this image was built from; /health reports it so a deploy can be checked from outside.
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION \
    NODE_ENV=production \
    PORT=8080 \
    CLIENT_DIR=/app/client \
    MAPS_DIR=/app/content/maps \
    ITEMS_FILE=/app/content/items.json \
    STORY_FILE=/app/content/story.json \
    MIGRATIONS_DIR=/app/migrations
WORKDIR /app
COPY --from=build /src/apps/server/dist ./server
COPY --from=build /src/apps/client/dist ./client
COPY --from=build /src/content ./content
COPY --from=build /src/apps/server/migrations ./migrations
USER node
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1:8080/health >/dev/null || exit 1
CMD ["node", "--enable-source-maps", "server/server.cjs"]
