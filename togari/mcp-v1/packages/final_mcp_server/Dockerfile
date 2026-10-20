# Stage 1: Build
FROM node:20-slim AS builder

WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
RUN npm ci

COPY src/ ./src/
RUN npm run build

# Stage 2: Production
FROM node:20-slim

WORKDIR /app

COPY --from=builder /app/package.json /app/package-lock.json ./
RUN npm ci --production

COPY --from=builder /app/dist/ ./dist/

EXPOSE 3000
ENV PORT=3000

CMD ["node", "dist/index.js"]
