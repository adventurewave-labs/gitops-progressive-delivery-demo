import { NextResponse } from "next/server";

// /showcase -> static /showcase/index.html (served from /public)
export async function GET() {
  return NextResponse.redirect(new URL("/showcase/index.html", process.env.URL ?? "http://localhost:3000"), 302);
}
