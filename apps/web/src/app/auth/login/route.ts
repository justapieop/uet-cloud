import { NextResponse } from "next/server";
import { API_URL } from "@/shared/config";

export function GET(): NextResponse {
  const targetUrl: string = `${API_URL}/auth/login`;
  return NextResponse.redirect(targetUrl, 307);
}
