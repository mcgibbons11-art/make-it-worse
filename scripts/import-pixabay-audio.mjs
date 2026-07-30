import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const sourceDirectory = path.join(root, "sound effects");
const outputDirectory = path.join(root, "public", "audio");
const creditsPath = path.join(outputDirectory, "CREDITS.json");

const jobs = [
  ["spin_cycle", "freesound_community-waching-machine-spin-cycle-66595.mp3", "Waching Machine (Spin Cycle)", "freesound_community", 38.5, 1.6],
  ["sticky_gum", "universfield-wet-squelch-276679.mp3", "Wet Squelch", "Universfield", 0, 2, "", true],
  ["cord_trip", "universfield-whip-snap-242215.mp3", "Whip Snap", "Universfield", 0, 0.7],
  ["drawer_slam", "soundreality-door-slam-172171.mp3", "Door Slam", "SoundReality", 0, 0.8],
  ["rug_pull", "freesound_community-heavy-cloth-rustle-106346.mp3", "Heavy Cloth Rustle", "freesound_community", 0, 0.9],
  ["conveyor_strip", "freesound_community-conveyor-belt-in-an-airport-59829.mp3", "Conveyor Belt in an Airport", "freesound_community", 60, 3, "", true],
  ["tilt_plate", "sumaga123-wood-hit-432148.mp3", "Wood Hit", "sumaga123", 0, 0.9],
  ["motion_sensor", "u_edtmwfwu7c-beep-329314.mp3", "Beep", "u_edtmwfwu7c", 0, 0.35],
  ["domino_line", "freesound_community-dominos-falling-47488.mp3", "Dominos Falling", "freesound_community", 0, 1.6],
  ["bunting_line", "freesound_community-waving-flag-6179.mp3", "Waving Flag", "freesound_community", 0.2, 0.9],
  ["steam_vents", "dragon-studio-steam-hissing-2-386162.mp3", "Steam Hissing 2", "DRAGON-STUDIO", 0, 1.097],
  ["pipe_burst", "universfield-water-splash-199583.mp3", "Water Splash", "Universfield", 0, 1.2],
  ["ankle_weight", "freesound_community-metal-chain-7056.mp3", "Metal Chain", "freesound_community", 1.35, 0.9],
  ["chute_drop", "dragon-studio-simple-whoosh-382724.mp3", "Simple Whoosh", "DRAGON-STUDIO", 0, 1, "atempo=0.575"],
  ["cart_blocker", "freesound_community-pushing-grocery-cart-63821.mp3", "Pushing Grocery Cart", "freesound_community", 27.5, 1],
  ["dust_bunny", "freesound_community-poof-80161.mp3", "Poof", "freesound_community", 0, 1.8, "atempo=0.65", true],
  ["flood_puddle", "spinopel-foot-stepping-on-a-puddle-290821.mp3", "Foot Stepping on a Puddle", "Spinopel", 0.35, 2.5, "", true],
  ["updraft_vent", "dragon-studio-simple-whoosh-382724 (1).mp3", "Simple Whoosh", "DRAGON-STUDIO", 0, 2, "atempo=0.5,atempo=0.5", true],
  ["mattress_rebound", "universfield-cartoon-spring-boing-140378.mp3", "Cartoon Spring Boing", "Universfield", 0, 0.9],
  ["plate_shards", "freesound_community-glass-broken-43626.mp3", "Glass Broken", "freesound_community", 0, 1.3],
  ["cat_flap", "freesound_community-wing-flap-1-6434.mp3", "Wing Flap 1", "freesound_community", 0, 0.6],
  ["paparazzi", "malarbrush-camera-flash-204151.mp3", "Camera Flash", "MalarBrush", 0, 1.2, "atempo=1.458333"],
  ["bathroom_scales", "matthewvakaliuk73627-mouse-click-290204.mp3", "Mouse Click", "MatthewVakaliuk73627", 0, 0.45, "apad=pad_dur=0.084"],
  ["slow_fuse", "dragon-studio-steam-hissing-2-386162 (1).mp3", "Steam Hissing 2", "DRAGON-STUDIO", 0, 2, "atempo=0.5", true],
  ["pile_on", "freesound_community-clatter-25599.mp3", "Clatter", "freesound_community", 14.5, 1.6],
  ["bin_pedal", "freesound_community-trash-can-101339.mp3", "Trash Can", "freesound_community", 0, 0.8],
  ["swing_door", "dragon-studio-door-slam-478362.mp3", "Door Slam", "DRAGON-STUDIO", 0, 1.1],
  ["ball_machine", "universfield-cannon-shot-352459.mp3", "Cannon Shot", "Universfield", 0, 0.7],
  ["cuckoo_clock", "freesound_community-cuckoo-clock-76410.mp3", "Cuckoo Clock", "freesound_community", 4.1, 2.4],
  ["fish_bowl", "freesound_community-water-splash-46402.mp3", "Water Splash", "freesound_community", 0, 0.936],
  ["shoe_rack", "freesound_community-metal-clatter-1-103065.mp3", "Metal Clatter 1", "freesound_community", 0, 1.3],
  ["hot_potato", "freesound_community-stovetop-burner-60723.mp3", "Stovetop Burner", "freesound_community", 0, 0.9],
  ["stove_ring", "spinopel-using-a-gas-burner-411775.mp3", "Using a Gas Burner", "Spinopel", 10, 3, "", true],
  ["clothes_airer", "freesound_community-pots-and-pans-clatter-1-87352.mp3", "Pots and Pans Clatter 1", "freesound_community", 0, 1.3],
  ["ice_dispenser", "freesound_community-ice-dispenser-31762.mp3", "Ice Dispenser", "freesound_community", 4.2, 1.4],
  ["kettle_boil", "audiopapkin-whistling-kettle-302354.mp3", "Whistling Kettle", "AudioPapkin", 19.5, 5, "", true],
  ["junk_drift", "lordsonny_two-debris-break-253779.mp3", "Debris Break", "LordSonny_Two", 0.5, 3, "", true],
].map(([trap, originalFilename, title, author, start, duration, pre = "", bed = false]) => ({
  trap,
  file: `${trap}.mp3`,
  originalFilename,
  title,
  author,
  start,
  duration,
  pre,
  bed,
}));

function runFfmpeg(job) {
  const source = path.join(sourceDirectory, job.originalFilename);
  const output = path.join(outputDirectory, job.file);
  if (!existsSync(source)) throw new Error(`Missing source: ${source}`);

  const normalize = "aresample=44100,loudnorm=I=-18:LRA=11:TP=-1.5";
  const args = ["-y", "-loglevel", "error", "-ss", String(job.start), "-i", source];
  if (job.bed) {
    const fade = 0.08;
    const prefix = job.pre ? `${job.pre},` : "";
    const graph =
      `[0:a]${prefix}atrim=duration=${job.duration + fade},asetpts=N/SR/TB,asplit=3[mid0][tail0][head0];` +
      `[mid0]atrim=start=${fade}:end=${job.duration},asetpts=N/SR/TB[mid];` +
      `[tail0]atrim=start=${job.duration}:end=${job.duration + fade},asetpts=N/SR/TB[tail];` +
      `[head0]atrim=start=0:end=${fade},asetpts=N/SR/TB[head];` +
      `[tail][head]acrossfade=d=${fade}:c1=tri:c2=tri[seam];` +
      `[mid][seam]concat=n=2:v=0:a=1,${normalize}[out]`;
    args.push("-filter_complex", graph, "-map", "[out]");
  } else {
    const prefix = job.pre ? `${job.pre},` : "";
    const fadeOut = Math.max(0, job.duration - 0.01);
    args.push(
      "-af",
      `${prefix}atrim=duration=${job.duration},asetpts=N/SR/TB,${normalize},afade=t=in:st=0:d=0.005,afade=t=out:st=${fadeOut}:d=0.01`,
    );
  }
  args.push(
    "-t",
    String(job.duration),
    "-ac",
    "2",
    "-ar",
    "44100",
    "-codec:a",
    "libmp3lame",
    "-b:a",
    "192k",
    output,
  );
  const result = spawnSync("ffmpeg", args, { encoding: "utf8" });
  if (result.status !== 0)
    throw new Error(`ffmpeg failed for ${job.trap}: ${result.stderr || result.stdout}`);
}

for (const job of jobs) runFfmpeg(job);

const manifest = JSON.parse(readFileSync(creditsPath, "utf8"));
const planned = new Map(manifest.planned.map((row) => [row.trap, row]));
const existing = new Map(manifest.files.map((row) => [row.file, row]));
const importedFiles = new Set(jobs.map((job) => job.file));
manifest.files = manifest.files.filter((row) => !importedFiles.has(row.file));
for (const job of jobs) {
  const plan = planned.get(job.trap);
  const source = plan?.url ?? existing.get(job.file)?.source;
  if (!source) throw new Error(`No recorded source URL for ${job.trap}`);
  manifest.files.push({
    file: job.file,
    source,
    title: job.title,
    author: job.author,
    originalFilename: job.originalFilename,
    license: "Pixabay Content License",
    note:
      `downloaded 2026-07-29 via the user's browser; ` +
      `${job.duration.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}s excerpt from ${job.start.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}s` +
      `${job.pre ? `; time processing: ${job.pre}` : ""}` +
      `${job.bed ? "; seam crossfaded for looping" : ""}; resampled to 44.1 kHz stereo`,
  });
}
manifest.planned = [];
manifest._readme = [
  "Provenance for every recorded sound in this folder.",
  "The original files predate this manifest and retain null sources rather than guessed attribution.",
  "All later Pixabay files record the selected page/search URL, title, author, original filename, license, and processing note.",
  "The 2026-07-29 import completed every planned trap recording; `planned` is intentionally empty.",
];
manifest.latestImport = {
  date: "2026-07-29",
  sourceDirectory: "sound effects/",
  imported: jobs.length,
  processing: "Purposeful excerpts, 44.1 kHz stereo MP3, -18 LUFS/-1.5 dBTP target; sustained beds use an 80 ms tail-to-head seam crossfade.",
};
manifest.playbackGateResolution = [
  "RECORDED_TRAPS is derived from the trap catalog, so every correctly named file is reachable without a hand-maintained permission list.",
  "The imported sustained recordings are registered in SUSTAINED_TRAPS so repeated hazard reports hold one looping voice instead of stacking long one-shots.",
];
delete manifest.blockerBeforeAnyOfThisPlays;
writeFileSync(creditsPath, `${JSON.stringify(manifest, null, 1)}\n`);

console.log(`Imported ${jobs.length} Pixabay recordings into public/audio.`);
