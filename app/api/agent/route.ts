import { NextResponse } from "next/server";
import { runAgent } from "@/lib/agent/runAgent";

export async function POST(req: Request) {
  const { query } = await req.json();
  const result = await runAgent(query);
  return NextResponse.json({ result });
}
