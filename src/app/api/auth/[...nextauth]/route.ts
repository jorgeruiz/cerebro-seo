import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth";
import { type NextRequest } from "next/server";

const handler = NextAuth(authOptions);

// Logging temporal para diagnosticar OAuthCallbackError: State cookie was missing
async function wrappedHandler(req: NextRequest, ctx: { params: { nextauth: string[] } }) {
  const segments = ctx?.params?.nextauth ?? [];
  if (segments[0] === "callback") {
    const cookieNames = req.cookies.getAll().map((c) => c.name);
    console.log("[AUTH] callback cookies present:", JSON.stringify(cookieNames));
  }
  return (handler as Function)(req, ctx);
}

export { wrappedHandler as GET, wrappedHandler as POST };
