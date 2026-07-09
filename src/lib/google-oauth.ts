import { google } from "googleapis";
import { prisma } from "@/lib/db";

export async function getOAuth2Client(userId: string) {
  const account = await prisma.account.findFirst({
    where: { userId, provider: "google" },
  });

  if (!account?.access_token) return null;

  return buildOAuth2Client(account);
}

/**
 * Token de servicio para consultas GSC/GA4.
 * Usa el token OAuth de la cuenta configurada en GSC_SERVICE_EMAIL
 * (debe ser un usuario que tenga acceso a todas las propiedades de GSC/GA4).
 * Si no está configurada, retorna null.
 */
export async function getServiceOAuth2Client() {
  const email = process.env.GSC_SERVICE_EMAIL;
  if (!email) return null;

  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true },
  });
  if (!user) return null;

  const account = await prisma.account.findFirst({
    where: { userId: user.id, provider: "google" },
  });
  if (!account?.access_token) return null;

  return buildOAuth2Client(account);
}

// ─── Shared builder ─────────────────────────────────────────────────────────

function buildOAuth2Client(account: {
  id: string;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: number | null;
}) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.NEXTAUTH_URL}/api/auth/callback/google`
  );

  oauth2Client.setCredentials({
    access_token: account.access_token!,
    refresh_token: account.refresh_token ?? undefined,
    expiry_date: account.expires_at ? account.expires_at * 1000 : undefined,
  });

  // Auto-persist refreshed tokens so they stay valid across requests
  oauth2Client.on("tokens", async (tokens) => {
    await prisma.account.update({
      where: { id: account.id },
      data: {
        access_token: tokens.access_token ?? account.access_token,
        ...(tokens.refresh_token && { refresh_token: tokens.refresh_token }),
        ...(tokens.expiry_date && {
          expires_at: Math.floor(tokens.expiry_date / 1000),
        }),
      },
    });
  });

  return oauth2Client;
}
