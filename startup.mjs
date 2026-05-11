/**
 * Script de inicio para producción.
 * 1. Crea la base de datos cerebro_seo si no existe.
 * 2. Corre prisma migrate deploy.
 * 3. Arranca Next.js.
 *
 * Se necesita porque cerebro-db puede no tener la BD creada en el primer deploy.
 */
import { Client } from "pg";
import { execSync } from "child_process";

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) throw new Error("DATABASE_URL no definido");

// Reemplaza el nombre de la BD por 'postgres' para conectar como admin
const adminUrl = dbUrl.replace(/\/[^/?#]+(\?.*)?$/, "/postgres$1");

const client = new Client({ connectionString: adminUrl });
await client.connect();
await client.query("CREATE DATABASE cerebro_seo").catch((e) => {
  if (!String(e.message).includes("already exists")) {
    console.error("Error creando BD:", e.message);
  }
});
await client.end();
console.log("✓ BD cerebro_seo lista");

execSync("node_modules/.bin/prisma migrate deploy", { stdio: "inherit" });
execSync("node_modules/.bin/next start", { stdio: "inherit" });
