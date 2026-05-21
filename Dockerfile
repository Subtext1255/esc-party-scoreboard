FROM node:26-alpine

ENV NODE_ENV=production \
    ESC_DOCKER=1 \
    HOST=0.0.0.0 \
    PORT=4173 \
    DATA_DIR=/data \
    STORAGE_DRIVER=sqlite \
    DATABASE_FILE=/data/scoreboard.sqlite

WORKDIR /app

RUN mkdir -p /data && chown -R node:node /data

COPY --chown=node:node package.json ./
COPY --chown=node:node server.js storage.js app.js index.html entries.html entries.js styles.css vercel.json ./
COPY --chown=node:node entries ./entries

USER node

VOLUME ["/data"]
EXPOSE 4173

CMD ["npm", "start"]
