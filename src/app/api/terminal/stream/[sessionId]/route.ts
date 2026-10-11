export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { redis } from "@/lib/redis";

/**
 * GET /api/terminal/stream/[sessionId]
 * SSE endpoint that reads from Redis stream and pushes events to the browser.
 * Reconnection supported via Last-Event-ID header → replays from that point.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { sessionId: string } }
) {
  const session = await getSession();
  if (session?.user?.role !== "ADMIN") {
    return new Response("Unauthorized", { status: 403 });
  }

  const { sessionId } = params;

  // Validate session exists and belongs to a plan the user can access
  const ts = await prisma.terminalSession.findUnique({
    where: { id: sessionId },
    select: { id: true, status: true },
  });

  if (!ts) {
    return new Response("Session not found", { status: 404 });
  }

  const streamKey = `terminal:${sessionId}`;
  const lastId = req.headers.get("last-event-id") ?? "0";

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      const send = (id: string, data: string) => {
        controller.enqueue(encoder.encode(`id: ${id}\ndata: ${data}\n\n`));
      };

      // Replay any messages after lastId
      try {
        const history = await redis.xrange(streamKey, lastId === "0" ? "-" : `(${lastId}`, "+");
        for (const [id, fields] of history) {
          send(id, fields[1] ?? "{}");
        }
      } catch {
        // Stream might not exist yet
      }

      // Poll for new messages
      let running = true;
      const abortHandler = () => { running = false; };
      req.signal.addEventListener("abort", abortHandler);

      let cursor = "+"; // read from latest
      while (running) {
        try {
          // XREAD with 15s block timeout
          const results = await redis.call(
            "XREAD", "BLOCK", "15000", "COUNT", "10",
            "STREAMS", streamKey, cursor === "+" ? "$" : cursor
          ) as Array<[string, Array<[string, string[]]>]> | null;

          if (results) {
            for (const [, entries] of results) {
              for (const [id, fields] of entries) {
                send(id, fields[1] ?? "{}");
                cursor = id;

                // Check if session closed
                try {
                  const parsed = JSON.parse(fields[1] ?? "{}");
                  if (parsed.type === "status" && parsed.status === "closed") {
                    running = false;
                  }
                } catch { /* ignore parse errors */ }
              }
            }
          } else {
            // Timeout — send heartbeat
            controller.enqueue(encoder.encode(": heartbeat\n\n"));
          }
        } catch (_err) {
          if (running) {
            send("error", JSON.stringify({ type: "error", message: "Stream error" }));
            await new Promise((r) => setTimeout(r, 5000));
          }
        }
      }

      controller.close();
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
