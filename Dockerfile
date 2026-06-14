FROM node:20-alpine
WORKDIR /app

# OpenSSL requerido por Prisma en Alpine
RUN apk add --no-cache libc6-compat openssl

# ── Capa de dependencias (cached a menos que cambie package.json) ─────────────
COPY package.json package-lock.json ./
RUN npm ci

# ── Capa de Prisma (cached a menos que cambie prisma/schema.prisma) ──────────
# COPY prisma ANTES de COPY . . para que esta capa sea independiente del código.
# Garantiza que prisma generate siempre ve el schema actualizado.
COPY prisma ./prisma
RUN npx prisma generate

# ── Capa de código fuente (invalidada cuando CUALQUIER archivo del repo cambia) ─
COPY . .

# Vars placeholder para que next build no falle por validación de env.
# Con SKIP_ENV_VALIDATION=1 no se validan, pero deben existir como strings.
ARG DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
ARG REDIS_URL="redis://localhost:6379"
ARG NEXTAUTH_URL="https://placeholder.example.com"
ARG NEXTAUTH_SECRET="placeholder-secret-for-build-only"
ENV DATABASE_URL=$DATABASE_URL
ENV REDIS_URL=$REDIS_URL
ENV NEXTAUTH_URL=$NEXTAUTH_URL
ENV NEXTAUTH_SECRET=$NEXTAUTH_SECRET
ENV NEXT_TELEMETRY_DISABLED=1

RUN SKIP_ENV_VALIDATION=1 NODE_OPTIONS="--max-old-space-size=4096" npm run build

# Limpiar vars placeholder — las reales vienen de Easypanel en runtime
ENV DATABASE_URL=""
ENV REDIS_URL=""
ENV NEXTAUTH_URL=""
ENV NEXTAUTH_SECRET=""

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# startup.mjs crea BD si no existe, corre prisma migrate deploy, arranca Next.js
CMD ["node", "startup.mjs"]
