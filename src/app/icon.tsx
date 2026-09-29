import { readFileSync } from "fs";
import { join } from "path";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  const data = readFileSync(join(process.cwd(), "public", "favicon-32.png"));
  return new Response(data, {
    headers: { "Content-Type": "image/png" },
  });
}
