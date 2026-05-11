FROM node:20-alpine
WORKDIR /app

# OpenSSL requerido por Prisma en Alpine
RUN apk add --no-cache libc6-compat openssl

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Genera el Prisma client (no necesita DATABASE_URL)
RUN npx prisma generate

ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

COPY startup.mjs ./

# startup.mjs: crea BD si no existe, corre migraciones, arranca Next.js
CMD ["node", "startup.mjs"]
