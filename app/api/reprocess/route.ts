import { NextResponse, type NextRequest } from "next/server";
import { isLoggedIn } from "@/lib/auth";
import { reprocessAll } from "@/lib/store";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!(await isLoggedIn())) return NextResponse.redirect(new URL("/login", req.url), 303);
  const n = await reprocessAll();
  return NextResponse.redirect(new URL(`/?reprocessed=${n}`, req.url), 303);
}
