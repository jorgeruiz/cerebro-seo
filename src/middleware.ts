export { default } from "next-auth/middleware";

export const config = {
  matcher: [
    // Protege todas las rutas excepto login, API de auth, archivos estáticos
    "/((?!login|api/auth|_next/static|_next/image|favicon.ico).*)",
  ],
};
