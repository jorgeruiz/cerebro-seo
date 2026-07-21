import { ImageResponse } from "next/og";
import { type NextRequest } from "next/server";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const sizeParam = Number(searchParams.get("size") || "512");
  const s = Math.min(Math.max(sizeParam, 64), 1024);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "20%",
          background: "linear-gradient(135deg, #6366f1, #3b82f6, #ec4899)",
        }}
      >
        <span
          style={{
            fontSize: s * 0.65,
            fontWeight: 800,
            color: "white",
            lineHeight: 1,
          }}
        >
          C
        </span>
      </div>
    ),
    { width: s, height: s }
  );
}
