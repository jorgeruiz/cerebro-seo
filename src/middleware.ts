export { default } from "next-auth/middleware";

export const config = {
  matcher: [
    // Protege todas las rutas excepto:
    // - login: página pública de auth
    // - api/auth: callbacks de NextAuth
    // - api/jobs: endpoints internos con x-internal-secret propio
    // - api/internal: endpoints internos con Authorization: Bearer propio
    // - archivos estáticos de Next.js
    "/((?!login|api/auth|api/jobs|api/internal|_next/static|_next/image|favicon.ico).*)",
  ],
};
