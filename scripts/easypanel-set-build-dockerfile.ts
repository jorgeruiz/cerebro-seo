/**
 * Configura build type "dockerfile" + fuente GitHub en el servicio cerebro-seo.
 * Verifica configuración antes de deployar. Monitorea hasta respuesta HTTP.
 *
 * Requiere en .env.local:
 *   EP_USER=jorge.arm@gmail.com
 *   EP_PASS=ClickSociety12#
 *
 * Ejecutar:
 *   npx tsx scripts/easypanel-set-build-dockerfile.ts
 */
import { readFileSync } from "fs";
import { join } from "path";

// ── Cargar .env.local manualmente (tsx no lo carga automáticamente) ───────────
function loadDotEnvLocal(): Record<string, string> {
  const envPath = join(process.cwd(), ".env.local");
  const lines = readFileSync(envPath, "utf-8").split("\n");
  const env: Record<string, string> = {};
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const [k, ...rest] = t.split("=");
    env[k.trim()] = rest.join("=").trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

const dotenv = loadDotEnvLocal();
const EP_USER = dotenv.EP_USER ?? process.env.EP_USER;
const EP_PASS = dotenv.EP_PASS ?? process.env.EP_PASS;

if (!EP_USER || !EP_PASS) {
  console.error("❌ Faltan credenciales. Agrega a .env.local:");
  console.error("   EP_USER=jorge.arm@gmail.com");
  console.error("   EP_PASS=ClickSociety12#");
  process.exit(1);
}

const EP_URL      = "http://76.13.121.6:3000";
const PROJECT     = "apps";
const SERVICE     = "cerebro-seo";
const MONITOR_URL = "https://apps-cerebro-seo.6lk5jx.easypanel.host";

// ── tRPC helpers con reporte exacto de errores ────────────────────────────────

async function login(): Promise<string> {
  const res = await fetch(`${EP_URL}/api/trpc/auth.login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ json: { email: EP_USER, password: EP_PASS } }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`auth.login HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json() as { result?: { data?: { json?: { token?: string } } }; error?: unknown };
  if (data.error) throw new Error(`auth.login tRPC error: ${JSON.stringify(data.error)}`);
  const token = data?.result?.data?.json?.token;
  if (!token) throw new Error(`Token ausente en respuesta: ${JSON.stringify(data)}`);
  return token;
}

async function trpcPost(token: string, route: string, input: object): Promise<unknown> {
  const res = await fetch(`${EP_URL}/api/trpc/${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ json: input }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${route} HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json() as { error?: unknown };
  if (data.error) throw new Error(`${route} tRPC error: ${JSON.stringify(data.error)}`);
  return data;
}

async function trpcGet(token: string, route: string, input: object): Promise<unknown> {
  const params = new URLSearchParams({ input: JSON.stringify({ json: input }) });
  const res = await fetch(`${EP_URL}/api/trpc/${route}?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${route} HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  // 1. Auth
  console.log("1. Autenticando...");
  const token = await login();
  console.log("   ✓ Token obtenido");

  // 1.5. Validar que el proyecto "apps" existe
  console.log("1.5. Validando proyecto target...");
  const projectsResp = await trpcGet(token, "projects.listProjects", {}) as {
    result?: { data?: { json?: Array<{ name: string }> } };
  };
  const projectNames = projectsResp?.result?.data?.json?.map((p) => p.name) ?? [];
  if (!projectNames.includes(PROJECT)) {
    throw new Error(
      `Proyecto "${PROJECT}" no existe. Proyectos disponibles: ${JSON.stringify(projectNames)}`
    );
  }
  console.log(`   ✓ Proyecto "${PROJECT}" confirmado (${JSON.stringify(projectNames)})`);

  // 2. Configurar fuente GitHub primero (updateBuild requiere source configurado)
  console.log("2. Configurando fuente GitHub (jorgeruiz/cerebro-seo, main)...");
  await trpcPost(token, "services.app.updateSourceGithub", {
    projectName: PROJECT,
    serviceName: SERVICE,
    owner: "jorgeruiz",
    repo: "cerebro-seo",
    ref: "main",
    path: "/",
    autoDeploy: false,
  });
  console.log("   ✓ updateSourceGithub completado");

  // 3. Configurar build type: dockerfile (debe ir después de source)
  console.log("3. Configurando build type (dockerfile)...");
  await trpcPost(token, "services.app.updateBuild", {
    projectName: PROJECT,
    serviceName: SERVICE,
    build: { type: "dockerfile" },
  });
  console.log("   ✓ updateBuild completado");

  // 4. Verificación dura vía projects.inspectProject
  console.log("4. Verificando configuración...");
  const inspectResp = await trpcGet(token, "projects.inspectProject", { projectName: PROJECT }) as {
    result?: { data?: { json?: { services?: Array<Record<string, unknown>> } } };
  };
  const services = inspectResp?.result?.data?.json?.services ?? [];
  const svc = services.find((s) => s.name === SERVICE);
  if (!svc) {
    throw new Error(`Servicio "${SERVICE}" no encontrado en proyecto "${PROJECT}"`);
  }

  const build  = svc.build  as { type?: string } | undefined | null;
  const source = svc.source as { type?: string; owner?: string; repo?: string } | undefined | null;

  console.log(`   build:  ${JSON.stringify(build)}`);
  console.log(`   source: ${JSON.stringify(source)}`);

  if (build?.type !== "dockerfile") {
    throw new Error(
      `Build type no es dockerfile — es: ${JSON.stringify(build)}. Abortando antes de deploy.`
    );
  }
  if (source?.type !== "github" || source?.owner !== "jorgeruiz" || source?.repo !== "cerebro-seo") {
    throw new Error(
      `Source GitHub incorrecto: ${JSON.stringify(source)}. Abortando.`
    );
  }
  console.log("   ✓ Verificación OK — dockerfile + github/jorgeruiz/cerebro-seo");

  // 5. Deploy
  console.log("5. Disparando deploy...");
  await trpcPost(token, "services.app.deployService", {
    projectName: PROJECT,
    serviceName: SERVICE,
  });
  console.log("   ✓ Deploy disparado");
  console.log(`   Logs en: ${EP_URL}/projects/${PROJECT}/app/${SERVICE}/deployments`);

  // 6. Monitoreo — poll al dominio interno de Easypanel (no requiere DNS custom)
  console.log(`\n6. Monitoreando ${MONITOR_URL}`);
  console.log("   (máx 10 min, cada 15s — Ctrl+C para cancelar)\n");
  const deadline = Date.now() + 10 * 60 * 1000;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    await new Promise((r) => setTimeout(r, 15_000));
    try {
      const resp = await fetch(MONITOR_URL, { redirect: "manual" });
      const status = resp.status;
      console.log(`   [${attempt}] HTTP ${status}`);
      if (status >= 200 && status < 400) {
        console.log(`\n✅ App respondiendo (HTTP ${status}). Deploy exitoso.`);
        console.log(`   Dominio interno: ${MONITOR_URL}`);
        console.log(`   Dominio custom (requiere DNS A 76.13.121.6): https://seo.clicksociety.mx`);
        return;
      }
    } catch (e) {
      const msg = (e as Error).message?.slice(0, 80) ?? "error desconocido";
      console.log(`   [${attempt}] Sin respuesta — ${msg}`);
    }
  }
  throw new Error(
    `Timeout: ${MONITOR_URL} no respondió en 10 minutos. Revisar logs en Easypanel.`
  );
}

main().catch((err) => {
  console.error("\n❌ ERROR — parando aquí:");
  console.error(err.message ?? err);
  process.exit(1);
});
