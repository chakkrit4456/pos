# FlexPOS server + web, for running on a shop server / cloud VM.
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=4100 FLEXPOS_DATA_DIR=/data FLEXPOS_WEB_DIR=/app/web FLEXPOS_FONTS_DIR=/app/server/fonts
RUN corepack enable
COPY --from=build /app/apps/server/dist /app/server
COPY --from=build /app/apps/web/dist /app/web
RUN cd /app/server && npm init -y >/dev/null && npm install --omit=dev better-sqlite3@12 pg@8 mysql2@3 @napi-rs/canvas@0.1 @node-rs/argon2@2 bonjour-service@1 exceljs@4 qrcode@1 && npm cache clean --force
VOLUME /data
EXPOSE 4100
HEALTHCHECK CMD node -e "fetch('http://localhost:4100/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "/app/server/main.js"]
