# Stage 1 — builder
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json ./
RUN npm install

COPY src/ ./src/
COPY index.html ./
COPY tsconfig.json ./
COPY tsconfig.node.json ./
COPY vite.config.ts ./

RUN npm run build

# Stage 2 — runner
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
