/**
 * Configura el build type (Dockerfile) y re-dispara deploy.
 *   npx tsx scripts/configure-build.ts
 */
const EP_URL = "http://76.13.121.6:3000";
const PROJECT = "apps";

async function main() {
  const loginRes = await fetch(`${EP_URL}/api/trpc/auth.login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ json: { email: "jorge.arm@gmail.com", password: "ClickSociety12#" } }),
  });
  const loginData = await loginRes.json() as { result?: { data?: { json?: { token?: string } } } };
  const token = loginData?.result?.data?.json?.token ?? "";
  console.log("Token:", token ? "OK" : "FALLO");

  // Configurar build type: Dockerfile
  const buildRes = await fetch(`${EP_URL}/api/trpc/services.app.updateBuild`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ json: {
      projectName: PROJECT,
      serviceName: "cerebro-seo",
      type: "dockerfile",
      file: "Dockerfile",
    }}),
  });
  const buildData = await buildRes.json();
  console.log("updateBuild:", JSON.stringify(buildData).slice(0, 150));

  // Disparar deploy
  const deployRes = await fetch(`${EP_URL}/api/trpc/services.app.deployService`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ json: { projectName: PROJECT, serviceName: "cerebro-seo" } }),
  });
  const deployData = await deployRes.json();
  console.log("deploy:", JSON.stringify(deployData).slice(0, 100));
  console.log("\nMonitorea el build en:", `${EP_URL}/projects/${PROJECT}/app/cerebro-seo/deployments`);
}

main().catch(console.error);
