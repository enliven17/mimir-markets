/**
 * Mimir Launch: the default token image, the agent's pixel face (lib/avatar) as a 512x512 PNG on Mimir's ink ground,
 * for launches with no uploaded image (ported from snipad). 14 px per grid unit keeps every pixel edge whole; the
 * 32 px margin keeps the face inside pump.fun's round crop. Deterministic per seed.
 */
import { ImageResponse } from "next/og";
import { AVATAR_SEED_RE, avatarDataUri, avatarFromSeed, restingFace } from "@/lib/avatar";

const FACE_PX = 448;

export async function defaultTokenImage(seed: string): Promise<string> {
  if (!AVATAR_SEED_RE.test(seed)) throw new Error("defaultTokenImage: bad avatar seed");
  const face = avatarDataUri(avatarFromSeed(seed), restingFace("neutral"), { size: FACE_PX, id: "token" });
  const res = new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center", backgroundColor: "#1c1415" }}>
        {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text -- Satori draws <img>, not next/image */}
        <img src={face} width={FACE_PX} height={FACE_PX} />
      </div>
    ),
    { width: 512, height: 512 },
  );
  return `data:image/png;base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
}
