/**
 * Automatiza el setup de cerebro-seo en Easypanel.
 * Playwright: crea los servicios (no hay API para crear).
 * tRPC API: source GitHub, env vars, deploy.
 * Domains: UI (sin API documentada).
 *
 *   npx tsx scripts/easypanel-setup.ts
 */
import { chromium } from "playwright";

const EP_URL = "http://76.13.121.6:3000";
const EP_EMAIL = "jorge.arm@gmail.com";
const EP_PASSWORD = "ClickSociety12#";
const PROJECT = "apps";

async function loadEnv(): Promise<Record<string, string>> {
  const fs = await import("fs");
  const lines = fs.readFileSync(".env.local", "utf-8").split("\n");
  const env: Record<string, string> = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [k, ...rest] = trimmed.split("=");
    env[k.trim()] = rest.join("=").trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

// ── tRPC helpers ──────────────────────────────────────────────────────────────

async function getToken(): Promise<string> {
  const res = await fetch(`${EP_URL}/api/trpc/auth.login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ json: { email: EP_EMAIL, password: EP_PASSWORD } }),
  });
  const data = await res.json() as { result?: { data?: { json?: { token?: string } } } };
  const token = data?.result?.data?.json?.token;
  if (!token) throw new Error("No se pudo obtener token: " + JSON.stringify(data));
  return token;
}

async function trpcGet(token: string, route: string, input: object): Promise<unknown> {
  const params = new URLSearchParams({ input: JSON.stringify({ json: input }) });
  const res = await fetch(`${EP_URL}/api/trpc/${route}?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

async function trpcPost(token: string, route: string, input: object): Promise<unknown> {
  const res = await fetch(`${EP_URL}/api/trpc/${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ json: input }),
  });
  return res.json();
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  const localEnv = await loadEnv();

  const browser = await chromium.launch({ headless: false, slowMo: 200 });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();

  const nav = (url: string) => page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
  const settle = (ms = 1500) => page.waitForTimeout(ms);

  try {
    // ── 1. Login (Playwright) ────────────────────────────────────────────────
    console.log("1. Iniciando sesión...");
    await nav(EP_URL);
    await settle(2000);

    const loginForm = page.locator('input[type="email"]');
    if (await loginForm.isVisible({ timeout: 4000 }).catch(() => false)) {
      await loginForm.fill(EP_EMAIL);
      await page.fill('input[type="password"]', EP_PASSWORD);
      await page.click('button[type="submit"]');
      await settle(3000);
    }
    await page.locator('text=Logout').waitFor({ state: "visible", timeout: 15000 });
    console.log("   ✓ Login exitoso");

    // ── 2. Crear Redis (Playwright — no hay API) ──────────────────────────────
    console.log("2. Verificando/creando Redis (cerebro-seo-redis)...");
    await nav(`${EP_URL}/projects/${PROJECT}`);
    await settle(2000);

    const redisExists = await page.locator('a[href*="cerebro-seo-redis"]').count() > 0;
    if (redisExists) {
      console.log("   ℹ Redis ya existe");
    } else {
      await nav(`${EP_URL}/projects/${PROJECT}/create`);
      await settle(1500);

      await page.locator('button:has-text("Redis")').first().waitFor({ state: "visible", timeout: 8000 });
      await page.locator('button:has-text("Redis")').first().click();
      await settle(1000);

      const nameInput = page.getByLabel(/service name/i);
      await nameInput.waitFor({ state: "visible", timeout: 8000 });
      await nameInput.fill("cerebro-seo-redis");
      await page.locator('button:has-text("Create")').last().click();
      await settle(3000);
      console.log("   ✓ Redis creado");
    }

    // ── 3. Crear App cerebro-seo (Playwright) ────────────────────────────────
    console.log("3. Verificando/creando App (cerebro-seo)...");
    await nav(`${EP_URL}/projects/${PROJECT}`);
    await settle(2000);

    // Busca el link exacto al servicio cerebro-seo (no cerebro-seo-redis)
    const appExists = await page.locator('a[href="/projects/apps/app/cerebro-seo"]').count() > 0;
    if (appExists) {
      console.log("   ℹ Servicio ya existe");
    } else {
      await nav(`${EP_URL}/projects/${PROJECT}/create`);
      await settle(1500);

      // Match exacto "App" para no agarrar el dropdown "apps" del sidebar
      const appBtn = page.locator('button', { hasText: /^App$/ }).first();
      await appBtn.waitFor({ state: "visible", timeout: 8000 });
      await appBtn.click();
      await settle(1000);

      const nameInput = page.getByLabel(/service name/i);
      await nameInput.waitFor({ state: "visible", timeout: 8000 });
      await nameInput.fill("cerebro-seo");
      await page.locator('button:has-text("Create")').last().click();
      await settle(3000);
      console.log("   ✓ Servicio App creado");
    }

    // ── 4. Obtener token tRPC ─────────────────────────────────────────────────
    console.log("4. Autenticando en API tRPC...");
    const token = await getToken();
    console.log("   ✓ Token obtenido");

    // ── 5. Obtener contraseña de cerebro-db vía API ───────────────────────────
    console.log("5. Obteniendo password de cerebro-db...");
    let dbPassword = "";
    try {
      const webInspect = await trpcGet(token, "services.app.inspectService", {
        projectName: PROJECT,
        serviceName: "cerebro-web",
      }) as { result?: { data?: { json?: { env?: string } } } };
      const envStr = webInspect?.result?.data?.json?.env ?? "";
      const match = envStr.match(/DATABASE_URL=postgresql:\/\/[^:]+:([^@]+)@/);
      if (match) dbPassword = match[1];
    } catch (_e) { /* continuar */ }

    const redisUrl = "redis://cerebro-seo-redis:6379";
    const dbUrl = dbPassword
      ? `postgresql://cerebro:${dbPassword}@cerebro-db:5432/cerebro_seo`
      : "postgresql://cerebro:REEMPLAZAR@cerebro-db:5432/cerebro_seo";
    console.log(`   DB password: ${dbPassword ? "obtenida" : "no encontrada — completar manualmente"}`);

    // ── 6. Configurar fuente GitHub vía tRPC ─────────────────────────────────
    console.log("6. Configurando fuente GitHub...");
    await trpcPost(token, "services.app.updateSourceGithub", {
      projectName: PROJECT,
      serviceName: "cerebro-seo",
      owner: "jorgeruiz",
      repo: "cerebro-seo",
      ref: "main",
      autoDeploy: false,
    });
    console.log("   ✓ GitHub configurado");

    // ── 7. Configurar variables de entorno vía tRPC ───────────────────────────
    console.log("7. Configurando variables de entorno...");
    const fullEnv = [
      `DATABASE_URL=${dbUrl}`,
      `REDIS_URL=${redisUrl}`,
      `NEXTAUTH_URL=https://seo.clicksociety.mx`,
      `NEXTAUTH_SECRET=${localEnv.NEXTAUTH_SECRET}`,
      `GOOGLE_CLIENT_ID=${localEnv.GOOGLE_CLIENT_ID}`,
      `GOOGLE_CLIENT_SECRET=${localEnv.GOOGLE_CLIENT_SECRET}`,
      `DATAFORSEO_LOGIN=${localEnv.DATAFORSEO_LOGIN}`,
      `DATAFORSEO_PASSWORD=${localEnv.DATAFORSEO_PASSWORD}`,
      `ANTHROPIC_API_KEY=${localEnv.ANTHROPIC_API_KEY}`,
      `NOTION_API_KEY=${localEnv.NOTION_API_KEY}`,
      `SEO_INTERNAL_SECRET=${localEnv.SEO_INTERNAL_SECRET ?? ""}`,
    ].join("\n");

    const envResult = await trpcPost(token, "services.app.updateEnv", {
      projectName: PROJECT,
      serviceName: "cerebro-seo",
      env: fullEnv,  // campo correcto confirmado: "env" no "source"
    }) as { error?: unknown };
    if (envResult && typeof envResult === "object" && "error" in envResult) {
      console.log("   ⚠ Error env:", JSON.stringify(envResult));
    } else {
      console.log("   ✓ Env vars configuradas");
    }

    // ── 8. Agregar dominio (UI — sin tRPC documentado) ────────────────────────
    console.log("8. Agregando dominio seo.clicksociety.mx...");
    await nav(`${EP_URL}/projects/${PROJECT}/app/cerebro-seo/domains`);
    await settle(2500);

    const domainExists = await page.locator('text=seo.clicksociety.mx').count() > 0;
    if (domainExists) {
      console.log("   ℹ Dominio ya existe");
    } else {
      // Intentar via tRPC primero
      try {
        await trpcPost(token, "services.app.addDomain", {
          projectName: PROJECT,
          serviceName: "cerebro-seo",
          host: "seo.clicksociety.mx",
        });
        console.log("   ✓ Dominio agregado vía API");
      } catch (_e) {
        // Fallback UI
        const domainInput = page.locator('input').first();
        if (await domainInput.isVisible({ timeout: 3000 }).catch(() => false)) {
          await domainInput.fill("seo.clicksociety.mx");
          await page.locator('button:has-text("Add"), button:has-text("Create")').first().click();
          await settle(1500);
          console.log("   ✓ Dominio agregado vía UI");
        } else {
          console.log("   ⚠ No se pudo agregar dominio — configurar manualmente");
        }
      }
    }

    // ── 9. Trigger deploy vía tRPC ────────────────────────────────────────────
    console.log("9. Disparando deploy...");
    await trpcPost(token, "services.app.deployService", {
      projectName: PROJECT,
      serviceName: "cerebro-seo",
    });
    console.log("   ✓ Deploy iniciado");

    console.log("\n✅ Setup completado.");
    console.log("   Monitorea:", `${EP_URL}/projects/${PROJECT}/app/cerebro-seo`);
    if (!dbPassword) {
      console.log("\n⚠️  Actualiza DATABASE_URL con la contraseña real de cerebro-db.");
      console.log("   Obtén la contraseña en:", `${EP_URL}/projects/${PROJECT}/postgres/cerebro-db`);
    }

  } catch (err) {
    console.error("Error:", err);
    await page.screenshot({ path: "easypanel-error.png", fullPage: true });
    console.log("   Screenshot guardado en easypanel-error.png");
  } finally {
    await browser.close();
  }
}

main();
