FROM node:22-slim AS builder
WORKDIR /build
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
RUN cd dist && zip -r "/build/windrow-$(node -p 'require(\"./package.json\").version').zip" .

FROM scratch AS output
COPY --from=builder /build/windrow-*.zip /
COPY --from=builder /build/dist/ /dist/