FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

# VITE_API_URL is injected at build time — set it in Railway service variables
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
RUN npm install -g serve@14

COPY --from=builder /app/dist ./dist

EXPOSE 3000
CMD ["sh", "-c", "serve -s dist -l ${PORT:-3000}"]
