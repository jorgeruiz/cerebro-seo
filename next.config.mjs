/** @type {import('next').NextConfig} */
const nextConfig = {
  // Habilita instrumentation.ts para inicializar workers BullMQ al startup
  experimental: {
    instrumentationHook: true,
    // Reducir paralelismo de compilación para evitar OOM en build (servidor 3.8GB)
    cpus: 1,
  },
};

export default nextConfig;
