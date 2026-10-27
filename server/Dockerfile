# Tabbary sync server
#
# Ciphertext-only store for Tabbary. It never sees a tab URL, a session name,
# or the user's key.
#
#   docker build -t tabbary-sync ./server
#   docker run -d --name tabbary-sync -p 8787:8787 \
#     -e TABBARY_PAIRING_SECRET="$(openssl rand -base64 32)" \
#     -v tabbary-data:/data tabbary-sync
#
# Put it behind TLS before using it from another machine.

FROM node:22-alpine

WORKDIR /app

# node:sqlite is built into Node 22; no native modules to compile.
COPY package.json ./
COPY index.mjs ./

RUN mkdir -p /data && chown -R node:node /app /data

USER node

ENV TABBARY_DB=/data/tabbary.db \
    PORT=8787 \
    HOST=0.0.0.0 \
    NODE_ENV=production

EXPOSE 8787
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "index.mjs"]
