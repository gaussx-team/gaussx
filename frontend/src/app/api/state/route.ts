import { connection } from "next/server";
import { handle } from "@/lib/server/handle";
import { getState } from "@/lib/server/store";

export async function GET() {
  await connection();
  return handle(() => getState());
}
