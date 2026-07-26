FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

# Generate a production-only node_modules tree. Prisma is a runtime dependency
# because the deploy job runs `prisma migrate deploy` from this image.
FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY package*.json ./
COPY --from=builder /app/prisma ./prisma
RUN npm ci --omit=dev && ./node_modules/.bin/prisma generate && npm cache clean --force

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nestjs
COPY --from=prod-deps --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/prisma ./prisma
COPY --chown=nestjs:nodejs package*.json ./
USER nestjs
EXPOSE 3001
CMD ["node", "dist/main.js"]
