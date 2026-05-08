"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState<"google" | "email" | null>(null);
  const [emailSent, setEmailSent] = useState(false);

  async function handleGoogle() {
    setLoading("google");
    await signIn("google", { callbackUrl: "/clientes" });
  }

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setLoading("email");
    await signIn("email", { email, redirect: false });
    setLoading(null);
    setEmailSent(true);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-white to-indigo-50">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-[#6366f1] via-[#3b82f6] to-[#ec4899] mb-4 shadow-lg shadow-indigo-200" />
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
            Cerebro <span className="text-[#6366f1]">SEO</span>
          </h1>
          <p className="text-sm text-gray-500 mt-1">Click Society</p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 space-y-6">
          {emailSent ? (
            <div className="text-center py-4 space-y-2">
              <div className="text-3xl">📬</div>
              <p className="font-medium text-gray-900">Revisa tu correo</p>
              <p className="text-sm text-gray-500">
                Enviamos un link de acceso a <strong>{email}</strong>
              </p>
            </div>
          ) : (
            <>
              {/* Google OAuth — para equipo interno */}
              <Button
                type="button"
                variant="outline"
                className="w-full gap-3 h-11"
                onClick={handleGoogle}
                disabled={loading !== null}
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24">
                  <path
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    fill="#4285F4"
                  />
                  <path
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    fill="#34A853"
                  />
                  <path
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    fill="#FBBC05"
                  />
                  <path
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    fill="#EA4335"
                  />
                </svg>
                {loading === "google" ? "Conectando..." : "Continuar con Google"}
              </Button>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-100" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-white px-3 text-gray-400">o acceso por correo</span>
                </div>
              </div>

              {/* Magic link — para clientes */}
              <form onSubmit={handleEmail} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-xs text-gray-600">
                    Correo electrónico
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="correo@empresa.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="h-10"
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full h-10 bg-[#6366f1] hover:bg-[#4f52d4] text-white"
                  disabled={loading !== null}
                >
                  {loading === "email" ? "Enviando..." : "Enviar link de acceso"}
                </Button>
              </form>
            </>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          Click Society — Monterrey, México
        </p>
      </div>
    </div>
  );
}
