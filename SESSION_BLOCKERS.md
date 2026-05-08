# Session 3 — Blockers

## Bloqueador B1: Docker no instalado

**Afecta:** E2 (Docker + BD local), E3 (Prisma migration)
**Detectado:** 2026-05-08
**Severidad:** Alta — sin BD no se pueden aplicar migraciones ni probar la app localmente

**Síntomas:**
```
command not found: docker
```
Docker Desktop no está instalado en esta Mac. No hay PostgreSQL ni Redis nativos tampoco.

**Solución requerida (Jorge ejecuta):**
1. Instalar Docker Desktop: https://www.docker.com/products/docker-desktop/
2. Una vez instalado, desde la raíz del proyecto:
   ```bash
   docker compose up -d
   docker compose ps          # verificar que postgres y redis están running
   npx prisma migrate dev --name init
   npx prisma generate
   npm run dev                # verificar que la app arranca
   ```
3. Verificar tablas creadas:
   ```bash
   docker exec -it $(docker compose ps -q postgres) psql -U cerebro -d cerebro_seo -c "\dt"
   ```

**Impacto en el resto de la sesión:**
- E2 y E3: pendientes para Jorge
- E4 (provider layer): código implementado, no requiere BD para escribirse
- E5 (validation script): DataForSEO se llama directo por HTTP, no requiere BD.
  El log de ApiUsage se skipea con warning si la BD no está disponible.
  El reporte de validación SÍ se genera.

**Estado del docker-compose.yml:** ✅ Listo en la raíz del proyecto.
