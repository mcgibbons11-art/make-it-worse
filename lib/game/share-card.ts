import { TRAP_CATALOG } from "./trap-catalog";
import type { ChallengeDTO } from "./types";
export async function generateShareCard(
  challenge: ChallengeDTO,
): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 630;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Share card canvas is unavailable.");
  const gradient = context.createLinearGradient(0, 0, 1200, 630);
  gradient.addColorStop(0, "#79d5ff");
  gradient.addColorStop(1, "#d8f5ff");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 1200, 630);
  context.fillStyle = "#171a2b";
  context.font = "900 38px system-ui";
  context.fillText("MAKE IT", 70, 82);
  context.fillStyle = "#ff5c65";
  context.fillText("WORSE", 265, 82);
  context.save();
  context.translate(220, 305);
  context.rotate(-0.08);
  context.fillStyle = "#ffd84d";
  context.strokeStyle = "#171a2b";
  context.lineWidth = 16;
  context.beginPath();
  context.roundRect(-112, -112, 224, 224, 54);
  context.fill();
  context.stroke();
  context.fillStyle = "#171a2b";
  context.font = "900 38px system-ui";
  context.textAlign = "center";
  context.fillText(
    challenge.addedTrap
      ? TRAP_CATALOG[challenge.addedTrap.type].iconKey.toUpperCase()
      : "CLEAN",
    0,
    14,
  );
  context.restore();
  context.textAlign = "left";
  context.fillStyle = "#171a2b";
  context.font = "950 70px system-ui";
  context.fillText("CAN YOU SURVIVE IT?", 400, 260);
  context.font = "750 32px system-ui";
  const newest = challenge.addedTrap
    ? `${challenge.createdByName} added ${TRAP_CATALOG[challenge.addedTrap.type].articleName}.`
    : "A clean level. For now.";
  context.fillText(newest.slice(0, 54), 400, 322);
  context.font = "800 26px system-ui";
  context.fillStyle = "#6e7487";
  context.fillText(
    `CHAIN DEPTH ${challenge.depth}  ·  ${challenge.stats.attempts} ATTEMPTS`,
    400,
    372,
  );
  context.fillStyle = "#171a2b";
  context.font = "900 28px system-ui";
  context.fillText("BEAT IT · RUIN IT · SEND IT", 70, 570);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (value) =>
        value
          ? resolve(value)
          : reject(new Error("Share card could not be rendered.")),
      "image/png",
    ),
  );
  return new File([blob], "make-it-worse.png", { type: "image/png" });
}
