import { NextAuthOptions, getServerSession } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import EmailProvider from "next-auth/providers/email";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { prisma } from "@/lib/db";
import { UserRole } from "@prisma/client";

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),

  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    // Magic link para clientes — sin password
    EmailProvider({
      server: process.env.EMAIL_SERVER!,
      from: process.env.EMAIL_FROM!,
    }),
  ],

  session: {
    strategy: "database",
  },

  pages: {
    signIn: "/login",
    error: "/login",
  },

  callbacks: {
    // Inyecta id y role en el session object para que el cliente no necesite
    // una query extra para saber quién es
    async session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
        session.user.role = (user as unknown as { role: UserRole }).role;
      }
      return session;
    },
  },
};

// Helper para server components y route handlers
export const getSession = () => getServerSession(authOptions);
