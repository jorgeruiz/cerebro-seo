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

# Vars de build para que módulos que las lean durante compilación no fallen.
# Con SKIP_ENV_VALIDATION=1 no se validan, pero deben existir como strings.
ARG DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
ARG REDIS_URL="redis://localhost:6379"
ARG NEXTAUTH_URL="https://placeholder.example.com"
ARG NEXTAUTH_SECRET="placeholder-secret-for-build-only"
ENV DATABASE_URL=$DATABASE_URL
ENV REDIS_URL=$REDIS_URL
ENV NEXTAUTH_URL=$NEXTAUTH_URL
ENV NEXTAUTH_SECRET=$NEXTAUTH_SECRET

RUN SKIP_ENV_VALIDATION=1 npm run build

# Limpiar vars placeholder antes del runtime (las reales vienen de Easypanel)
ENV DATABASE_URL=""
ENV REDIS_URL=""
ENV NEXTAUTH_URL=""
ENV NEXTAUTH_SECRET=""

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

COPY startup.mjs ./

# startup.mjs: crea BD si no existe, corre migraciones, arranca Next.js
CMD ["node", "startup.mjs"]
