import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Embed de reportes: sin auth por sesión (token firmado se verifica en la page).
  // Agregar CSP frame-ancestors para restringir qué origenes pueden embeber.
  if (pathname.startsWith("/reportes/") && pathname.includes("/embed")) {
    const response = NextResponse.next();
    response.headers.set(
      "Content-Security-Policy",
      "frame-ancestors https://constructor.clicksociety.com.mx"
    );
    return response;
  }

  // Para el resto de rutas protegidas, verificar sesión (NextAuth JWT).
  const token = await getToken({ req: request });
  if (!token) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Protege todas las rutas excepto:
    // - login: página pública de auth
    // - api/auth: callbacks de NextAuth
    // - api/jobs: endpoints internos con x-internal-secret propio
    // - api/internal: endpoints internos con Authorization: Bearer propio
    // - reportes/*/embed: embeds públicos con token firmado
    // - archivos estáticos de Next.js
    "/((?!login|api/auth|api/jobs|api/internal|_next/static|_next/image|favicon.ico).*)",
  ],
};
