import { createHash, randomBytes } from "node:crypto";
import { DEMO } from "./types";

export const DEMO_COOKIE = "mimir_demo";
export function sessionHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
export function newDemoToken(): string { return randomBytes(32).toString("hex"); }
export function readDemoToken(request: Request): string | null {
  const token = request.headers.get("cookie")?.split(";").map((s) => s.trim()).find((s) => s.startsWith(`${DEMO_COOKIE}=`))?.slice(DEMO_COOKIE.length + 1);
  return token && /^[a-f0-9]{64}$/.test(token) ? token : null;
}
export function demoCookie(token: string, secure: boolean): string {
  return `${DEMO_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/api/demo; Max-Age=${DEMO.sessionMs / 1000}${secure ? "; Secure" : ""}`;
}
export function sameDemoOrigin(request: Request): boolean {
  return request.headers.get("origin") === new URL(request.url).origin && request.headers.get("sec-fetch-site") !== "cross-site";
}
export function expiredDemoError(error: unknown): boolean {
  const data = (error as { data?: { code?: string } } | null)?.data;
  return data?.code === "demo_session_expired";
}
