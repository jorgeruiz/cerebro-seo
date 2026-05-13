import { NextAuthOptions, getServerSession } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { prisma } from "@/lib/db";
import { UserRole } from "@prisma/client";

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),

  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: [
            "openid email profile",
            "https://www.googleapis.com/auth/webmasters.readonly",
            "https://www.googleapis.com/auth/analytics.readonly",
          ].join(" "),
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],

  // JWT strategy: el middleware de next-auth llama a getToken() que solo decodifica JWTs.
  // Con database strategy la cookie tiene un UUID opaco → getToken() falla → redirect a /login.
  session: {
    strategy: "jwt",
  },

  // Google Workspace usa POST redirect en el consent screen.
  // SameSite=lax bloquea cookies en POST cross-site — cambiamos a "none" para state y pkce.
  cookies: {
    pkceCodeVerifier: {
      name: "__Secure-next-auth.pkce.code_verifier",
      options: { httpOnly: true, sameSite: "none", path: "/", secure: true },
    },
    state: {
      name: "__Secure-next-auth.state",
      options: { httpOnly: true, sameSite: "none", path: "/", secure: true, maxAge: 900 },
    },
  },

  pages: {
    signIn: "/login",
    error: "/login",
  },

  callbacks: {
    async jwt({ token, user }) {
      // user solo existe en el primer login — persistir id y role en el token
      if (user) {
        token.id = user.id;
        token.role = (user as unknown as { role: UserRole }).role;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as UserRole;
      }
      return session;
    },
  },
};

export const getSession = () => getServerSession(authOptions);
