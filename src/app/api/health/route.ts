import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_MODEL } from "@/lib/anthropic-config";

export async function GET() {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  try {
    await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    });
    return NextResponse.json({ ok: true, model: CLAUDE_MODEL });
  } catch (err: unknown) {
    const error = err as { status?: number; error?: { type?: string } };
    if (
      error?.status === 404 &&
      error?.error?.type === "not_found_error"
    ) {
      console.error(`[health] MODEL DEPRECATED: ${CLAUDE_MODEL}`);
      return NextResponse.json(
        { ok: false, model: CLAUDE_MODEL, error: "model_deprecated" },
        { status: 503 }
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
