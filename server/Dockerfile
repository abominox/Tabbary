# Windrow sync server
#
# Ciphertext-only store for Windrow. It never sees a tab URL, a session name,
# or the user's key.
#
#   docker build -t windrow-sync ./server
#   docker run -d --name windrow-sync -p 8787:8787 \
#     -e WINDROW_PAIRING_SECRET="$(openssl rand -base64 32)" \
#     -v windrow-data:/data windrow-sync
#
# Put it behind TLS before using it from another machine.

FROM node:22-alpine

WORKDIR /app

# node:sqlite is built into Node 22; no native modules to compile.
COPY package.json ./
COPY index.mjs ./

RUN mkdir -p /data && chown -R node:node /app /data

USER node

ENV WINDROW_DB=/data/windrow.db \
    PORT=8787 \
    HOST=0.0.0.0 \
    NODE_ENV=production

EXPOSE 8787
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "index.mjs"]
