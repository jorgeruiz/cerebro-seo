import { NextResponse } from "next/server";
import { initJobs } from "@/server/jobs/init";

// Solo accesible con el secret interno — no exponer públicamente
export async function GET(request: Request): Promise<NextResponse> {
  const secret = request.headers.get("x-internal-secret");
  if (secret !== process.env.CEREBRO_INTERNAL_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await initJobs();
  return NextResponse.json({ ok: true, ts: new Date().toISOString() });
}
