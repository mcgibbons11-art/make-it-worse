import Link from "next/link";

const assets = [
  ["Cartoon Hammer", "Blender Books", "4b3a4821679d4adea988c2f3134d71c3"],
  ["Refrigerator (low-poly)", "Vladimir_kizx (kizx3d)", "1b0d689a926244e9a72b50e25c7e2a45"],
  ["Standing Fan", "Low-poly Blast", "278f541dba99412aa5435134e06cac5b"],
  ["Soap Dish / Duck Soap Dish", "murattd3v", "fb7a4f1e7ea24c5296998b0761b21054"],
  ["V2701-JumpPad", "Zaxel", "1ccc8fed930e45fd88b22532bad32ee2"],
  ["Toilet", "Kevin Johnson / Sushi Burgerrr (Pittree)", "868beb5a0e6840d7a1d647a42a5e5a8c"],
  ["Beach Ball - Low Poly", "raduursache9", "40949184dcbc4d5cba5f115b1c0dcf6f"],
] as const;

export default function Credits() {
  return (
    <main className="legal-shell">
      <article className="panel legal">
        <div className="eyebrow">THE GOOD KIND OF BLAME</div>
        <h1>Art credits</h1>
        <p>
          These Sketchfab models are used under the Creative Commons Attribution
          4.0 license and were normalized and optimized in Blender for the game.
        </p>
        <ul>
          {assets.map(([title, creator, uid]) => (
            <li key={uid}>
              <a href={`https://sketchfab.com/3d-models/${uid}`}>
                {title}
              </a>{" "}
              by {creator}
            </li>
          ))}
        </ul>
        <p>
          <a href="https://creativecommons.org/licenses/by/4.0/">
            Creative Commons Attribution 4.0
          </a>
        </p>
        <Link className="button secondary" href="/">
          Back to the game
        </Link>
      </article>
    </main>
  );
}
