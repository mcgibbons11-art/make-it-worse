import { ImageResponse } from "next/og";
import { loadPreview } from "./preview-data";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
// The preview is fetched, so it must not be baked at build time. Thirty minutes
// keeps a hot chain's numbers fresh without hitting the database on every
// unfurl - chat clients request this image once per person who sees the link.
export const revalidate = 1800;

const INK = "#171a2b";
const CREAM = "#fff8e8";
const YELLOW = "#ffd84d";
// Deeper than the in-app coral #ff5c65 on purpose. The wordmark sits over the
// darker end of the gradient, where #ff5c65 measures 1.83:1 - well under the
// 3:1 large-text floor - and a link preview is often rendered at thumbnail size
// where that is the first thing to fall apart. This clears 3.46:1 against the
// dark stop and 4.98:1 against the light one. It is not PALETTE.danger, which
// stays reserved for hazard markers in the 3D scene.
const WORDMARK = "#c81f31";

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const preview = await loadPreview(slug);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "linear-gradient(145deg,#79d5ff,#d8f5ff)",
          color: INK,
          padding: 70,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: 8, display: "flex" }}>
          MAKE IT&nbsp;<span style={{ color: WORDMARK }}>WORSE</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 54 }}>
          {/* The badge names the trap rather than shrugging with "?!". A link
              preview renders small, so this is one short word at a size that
              survives being thumbnailed. */}
          <div
            style={{
              width: 240,
              height: 240,
              borderRadius: 40,
              background: YELLOW,
              border: `16px solid ${INK}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
              padding: 18,
              fontSize: preview.badge ? (preview.badge.length > 11 ? 34 : 44) : 78,
              fontWeight: 900,
              lineHeight: 1.05,
            }}
          >
            {preview.badge || "?!"}
          </div>
          <div style={{ display: "flex", flexDirection: "column", maxWidth: 740 }}>
            <div style={{ fontSize: 64, fontWeight: 950, lineHeight: 1.02 }}>
              CAN YOU SURVIVE IT?
            </div>
            <div style={{ fontSize: 34, marginTop: 22, fontWeight: 700 }}>
              {preview.headline}
            </div>
            {preview.statLine ? (
              <div
                style={{
                  display: "flex",
                  marginTop: 20,
                  padding: "10px 22px",
                  borderRadius: 99,
                  background: CREAM,
                  border: `5px solid ${INK}`,
                  fontSize: 30,
                  fontWeight: 900,
                }}
              >
                {preview.statLine}
              </div>
            ) : null}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 24,
            fontWeight: 700,
          }}
        >
          <span>{preview.depthLine.toUpperCase()}</span>
          <span>BEAT IT · RUIN IT · SEND IT</span>
        </div>
      </div>
    ),
    size,
  );
}
