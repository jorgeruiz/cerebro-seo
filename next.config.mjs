/** @type {import('next').NextConfig} */
const nextConfig = {
  // Habilita instrumentation.ts para inicializar workers BullMQ al startup
  experimental: {
    instrumentationHook: true,
  },
};

export default nextConfig;
