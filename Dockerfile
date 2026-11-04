# syntax=docker/dockerfile:1
FROM node:20-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache dumb-init openssl curl ca-certificates
RUN addgroup -g 1001 -S app && adduser -u 1001 -S app -G app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY backend/src ./backend/src
COPY .env.example ./
USER app
EXPOSE 8080
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "backend/src/server.js"]
