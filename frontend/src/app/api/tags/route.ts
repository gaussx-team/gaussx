import { connection } from "next/server";
import { handle } from "@/lib/server/handle";
import { getTags } from "@/lib/server/store";

export async function GET() {
  await connection();
  return handle(() => getTags());
}
