/**
 * GET /.well-known/assetlinks.json (rewritten here, next.config.js): Digital Asset Links, the proof that this site
 * and the Android app belong together. With it the app opens full screen, without the browser's address bar.
 * ANDROID_CERT_SHA256 holds the signing certificate's SHA-256 fingerprint(s), comma separated (the release key, and
 * Google Play's app signing key once the app is on Play).
 */
import { NextResponse } from "next/server";

import { APP_RELEASE } from "@/lib/app-release";

export function GET() {
  const fingerprints = (process.env.ANDROID_CERT_SHA256 ?? "").split(",").map((f) => f.trim().toUpperCase()).filter(Boolean);
  const body = fingerprints.length
    ? [{ relation: ["delegate_permission/common.handle_all_urls"], target: { namespace: "android_app", package_name: APP_RELEASE.packageId, sha256_cert_fingerprints: fingerprints } }]
    : [];
  return NextResponse.json(body, { headers: { "cache-control": "public, max-age=3600" } });
}
