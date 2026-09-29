import { readFileSync } from "fs";
import { join } from "path";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  const data = readFileSync(join(process.cwd(), "public", "apple-icon-180.png"));
  return new Response(data, {
    headers: { "Content-Type": "image/png" },
  });
}
