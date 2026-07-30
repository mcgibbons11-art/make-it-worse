import type { TrapType } from "@/lib/game/types";

function Glyph({ type }: { type: TrapType }) {
  const common = { stroke: "#171a2b", strokeWidth: 4, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (type) {
    case "swinging_hammer":
      return <><path d="M30 12l8 3-12 35-8-3z" fill="#ffd84d" {...common}/><path d="M23 9l26 10-6 16-27-10z" fill="#ff5964" {...common}/></>;
    case "rolling_fridge":
      return <><rect x="15" y="7" width="34" height="50" rx="7" fill="#bfe8ff" {...common}/><path d="M15 30h34M40 15v10M40 36v12" {...common}/><circle cx="22" cy="18" r="3" fill="#ff5964"/></>;
    case "floor_fan":
      return <><circle cx="32" cy="28" r="21" fill="#6bbcff" {...common}/><circle cx="32" cy="28" r="4" fill="#ff5964" {...common}/><path d="M32 24c-3-13 10-14 10-5 0 5-5 8-10 9M36 30c13-3 14 10 5 10-5 0-8-5-9-10M29 32c3 13-10 14-10 5 0-5 5-8 10-9M27 26c-13 3-14-10-5-10 5 0 8 5 9 10M27 49l-4 9M37 49l4 9" {...common}/></>;
    case "soap_slick":
      return <><path d="M9 40c5-11 13-5 17-14 5-12 13 1 20-4 7-5 13 5 7 13-5 7 1 12-9 17-11 5-14-5-23 0-10 5-17-2-12-12z" fill="#73dff2" {...common}/><circle cx="43" cy="16" r="5" fill="#fff3cf" {...common}/><circle cx="53" cy="10" r="3" fill="#fff3cf" {...common}/></>;
    case "spring_pad":
      return <><path d="M19 47h26v10H19zM18 16h28v11H18z" fill="#54d69a" {...common}/><path d="M22 45l19-16M42 45L23 29" {...common}/><path d="M32 13V4M25 10l7-7 7 7" {...common}/></>;
    case "angry_vacuum":
      return <><rect x="10" y="22" width="34" height="26" rx="13" fill="#b9a7ff" {...common}/><path d="M17 31l7 3M37 31l-7 3M20 42h14M42 28c13 1 4 15 13 17M55 45l-4 10" {...common}/><circle cx="16" cy="50" r="5" fill="#ff5964" {...common}/><circle cx="38" cy="50" r="5" fill="#ff5964" {...common}/></>;
    case "rotating_toilet":
      return <><rect x="18" y="6" width="28" height="21" rx="5" fill="#b9a7ff" {...common}/><path d="M14 26h36c0 19-5 30-18 30S14 45 14 26z" fill="#fff3cf" {...common}/><ellipse cx="32" cy="29" rx="12" ry="5" fill="#73dff2" {...common}/></>;
    case "giant_beach_ball":
      return <><circle cx="32" cy="32" r="25" fill="#ffd84d" {...common}/><path d="M32 7c-8 10-8 40 0 50M32 7c17 7 17 43 0 50M8 32h48" fill="none" {...common}/><circle cx="32" cy="32" r="5" fill="#ff5964" {...common}/></>;
    case "toaster_launcher":
      return <><rect x="11" y="27" width="42" height="26" rx="7" fill="#fff3cf" {...common}/><rect x="9" y="49" width="46" height="8" rx="4" fill="#ff5964" {...common}/><path d="M20 27h24" {...common}/><rect x="24" y="4" width="16" height="16" rx="3" fill="#ffd84d" {...common}/><path d="M32 20v6" {...common}/><rect x="45" y="33" width="8" height="7" rx="2" fill="#ffd84d" {...common}/></>;
    case "ceiling_fan":
      return <><path d="M32 6v10" {...common}/><circle cx="32" cy="24" r="6" fill="#ff5964" {...common}/><path d="M28 22C16 14 6 22 12 29c4 5 12 2 16-3M36 26c12 8 22 0 16-7-4-5-12-2-16 3M30 30c-4 13 8 20 12 12 3-6-4-11-9-12" fill="#6bbcff" {...common}/></>;
    case "banana_peel":
      return <><path d="M12 44c0-16 12-28 28-28 4 0 6 3 3 6-10 9-14 15-15 24-1 5-6 5-9 3-4-2-7-3-7-5z" fill="#ffd84d" {...common}/><path d="M40 22c8 2 12 9 10 16M18 47c-6 3-11 1-11-4" {...common}/></>;
    case "robot_mop":
      return <><ellipse cx="32" cy="34" rx="24" ry="16" fill="#b9a7ff" {...common}/><ellipse cx="32" cy="30" rx="24" ry="16" fill="#73dff2" {...common}/><circle cx="24" cy="28" r="3" fill="#171a2b"/><circle cx="40" cy="28" r="3" fill="#171a2b"/><path d="M10 46c6 4 12 5 22 5s16-1 22-5" {...common}/></>;
    case "mousetrap":
      return <><rect x="8" y="38" width="48" height="16" rx="4" fill="#ffd84d" {...common}/><path d="M12 38V18h40v20" fill="none" {...common}/><circle cx="32" cy="46" r="5" fill="#ff5964" {...common}/><path d="M12 18l8-8M52 18l-8-8" {...common}/></>;
    case "sprinkler":
      return <><rect x="27" y="34" width="10" height="22" rx="3" fill="#b9a7ff" {...common}/><circle cx="32" cy="30" r="7" fill="#73dff2" {...common}/><path d="M32 23c0-9 9-14 15-10M32 23c0-9-9-14-15-10M39 30c9 2 12 11 8 16M25 30c-9 2-12 11-8 16" fill="none" {...common}/></>;
    case "laundry_basket":
      return <><path d="M14 24h36l-4 30H18z" fill="#6bbcff" {...common}/><path d="M22 30v18M32 30v18M42 30v18" {...common}/><circle cx="22" cy="16" r="7" fill="#ff5964" {...common}/><circle cx="42" cy="13" r="6" fill="#ffd84d" {...common}/></>;
    case "fridge_magnet":
      return <><path d="M18 50V28a14 14 0 0 1 28 0v22" fill="none" strokeWidth={11} stroke="#ff5964" strokeLinecap="round"/><path d="M18 50V28a14 14 0 0 1 28 0v22" fill="none" {...common}/><rect x="12" y="47" width="13" height="10" rx="2" fill="#fff3cf" {...common}/><rect x="39" y="47" width="13" height="10" rx="2" fill="#fff3cf" {...common}/></>;
    case "paint_bucket":
      return <><path d="M18 22h28l-4 32H22z" fill="#fff3cf" {...common}/><path d="M18 22c0-8 28-8 28 0" fill="none" {...common}/><path d="M20 14a12 12 0 0 1 24 0" fill="none" {...common}/><path d="M22 34h20l-2 20H24z" fill="#b9a7ff" {...common}/><circle cx="32" cy="59" r="4" fill="#b9a7ff" {...common}/></>;
    case "spin_cycle":
      return <><rect x="10" y="10" width="44" height="46" rx="6" fill="#fff3cf" {...common}/><circle cx="32" cy="36" r="14" fill="#73dff2" {...common}/><circle cx="32" cy="36" r="7" fill="#171a2b"/><circle cx="17" cy="18" r="3" fill="#ff5964"/><circle cx="26" cy="18" r="3" fill="#ffd84d"/><path d="M44 15h6" {...common}/></>;
    case "sticky_gum":
      return <><ellipse cx="32" cy="46" rx="24" ry="10" fill="#ff9bd0" {...common}/><path d="M20 44c2-14 8-20 12-30M32 44c1-12 6-18 12-24" fill="none" {...common}/><circle cx="32" cy="13" r="5" fill="#ff9bd0" {...common}/><circle cx="45" cy="19" r="4" fill="#ff9bd0" {...common}/></>;
    case "cord_trip":
      return <><path d="M8 30c8 12 20 12 24 4s14-10 24 2" fill="none" strokeWidth={6} stroke="#171a2b" strokeLinecap="round"/><rect x="4" y="20" width="12" height="14" rx="3" fill="#fff3cf" {...common}/><rect x="48" y="26" width="14" height="14" rx="3" fill="#ffd84d" {...common}/><path d="M18 52h28" strokeWidth={5} stroke="#ff5964" strokeLinecap="round"/></>;
    case "drawer_slam":
      return <><rect x="8" y="8" width="48" height="20" rx="4" fill="#ff9b4a" {...common}/><rect x="4" y="30" width="56" height="22" rx="4" fill="#fff3cf" {...common}/><path d="M14 41h36" strokeWidth={5} stroke="#6e7487" strokeLinecap="round"/><path d="M22 16h8M34 16h8" {...common}/><path d="M28 58h8" {...common}/></>;
    case "rug_pull":
      return <><path d="M8 24h48l-6 22H14z" fill="#b9a7ff" {...common}/><path d="M18 30h28l-3 10H21z" fill="#ffd84d" {...common}/><ellipse cx="32" cy="35" rx="6" ry="4" fill="#fff3cf" {...common}/><path d="M9 50l3 8M20 50l3 8M31 50l3 8M42 50l3 8M52 50l3 8" {...common}/></>;
    case "conveyor_strip":
      return <><rect x="5" y="26" width="54" height="18" rx="9" fill="#6e7487" {...common}/><circle cx="16" cy="35" r="5" fill="#fff3cf" {...common}/><circle cx="48" cy="35" r="5" fill="#fff3cf" {...common}/><path d="M22 30l7 5-7 5M34 30l7 5-7 5" fill="none" stroke="#ffd84d" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round"/><path d="M14 51h36" {...common}/></>;
    case "tilt_plate":
      return <><path d="M6 40l52-14" fill="none" stroke="#b9a7ff" strokeWidth={9} strokeLinecap="round"/><path d="M6 40l52-14" fill="none" {...common}/><path d="M32 36l-6 16h12z" fill="#6e7487" {...common}/><path d="M14 52h36" {...common}/><path d="M52 14v8M46 10l6 6 6-6" {...common}/></>;
    case "motion_sensor":
      return <><rect x="22" y="8" width="20" height="14" rx="4" fill="#fff3cf" {...common}/><circle cx="32" cy="15" r="3" fill="#ff5964"/><path d="M32 24L10 54h44z" fill="#73dff2" {...common}/><path d="M26 40h12M22 48h20" {...common}/></>;
    case "domino_line":
      return <><rect x="6" y="16" width="12" height="34" rx="3" fill="#fff3cf" {...common}/><rect x="22" y="16" width="12" height="34" rx="3" fill="#fff3cf" {...common}/><rect x="40" y="22" width="12" height="30" rx="3" fill="#fff3cf" transform="rotate(22 46 37)" {...common}/><circle cx="12" cy="26" r="2.5" fill="#171a2b"/><circle cx="12" cy="40" r="2.5" fill="#171a2b"/><circle cx="28" cy="26" r="2.5" fill="#171a2b"/><circle cx="28" cy="40" r="2.5" fill="#171a2b"/></>;
    case "bunting_line":
      return <><path d="M4 14c14 10 42 10 56 0" fill="none" {...common}/><path d="M13 18l8 1-3 12z" fill="#ff5964" {...common}/><path d="M28 21l9 0-4 13z" fill="#ffd84d" {...common}/><path d="M43 19l8-2-2 13z" fill="#57dfa1" {...common}/><path d="M20 52h24" strokeWidth={5} stroke="#171a2b" strokeLinecap="round"/><path d="M32 46v-6" {...common}/></>;
    case "steam_vents":
      return <><rect x="4" y="42" width="16" height="12" rx="3" fill="#6e7487" {...common}/><rect x="24" y="42" width="16" height="12" rx="3" fill="#6e7487" {...common}/><rect x="44" y="42" width="16" height="12" rx="3" fill="#6e7487" {...common}/><path d="M32 38c-6-6 6-10 0-18" fill="none" strokeWidth={5} stroke="#73dff2" strokeLinecap="round"/><path d="M26 34c-4-4 4-7 0-12M38 34c4-4-4-7 0-12" fill="none" strokeWidth={4} stroke="#73dff2" strokeLinecap="round"/></>;
    case "pipe_burst":
      return <><path d="M6 22h44v12H6z" fill="#6e7487" {...common}/><circle cx="12" cy="28" r="7" fill="#ffd84d" {...common}/><path d="M50 28c8 0 8 22 0 22" fill="none" strokeWidth={9} stroke="#6e7487" strokeLinecap="round"/><path d="M50 46c-5 4-3 12 3 12s8-7 4-12" fill="#73dff2" {...common}/></>;
    case "ankle_weight":
      return <><rect x="10" y="30" width="18" height="20" rx="5" fill="#6e7487" {...common}/><rect x="36" y="30" width="18" height="20" rx="5" fill="#6e7487" {...common}/><path d="M19 30V16M45 30V16" {...common}/><path d="M14 40h10M40 40h10" strokeWidth={5} stroke="#ff5964" strokeLinecap="round"/><path d="M8 56h48" {...common}/></>;
    case "chute_drop":
      return <><path d="M14 6h36v20H14z" fill="#6e7487" {...common}/><path d="M18 26h28l-8 30H26z" fill="#4b8dff" {...common}/><path d="M22 14h20" strokeWidth={5} stroke="#fff3cf" strokeLinecap="round"/><path d="M32 34v14M26 42l6 7 6-7" {...common}/></>;
    case "cart_blocker":
      return <><path d="M12 18h36l-5 24H18z" fill="#6e7487" {...common}/><path d="M12 18L6 10" {...common}/><circle cx="22" cy="52" r="5" fill="#171a2b"/><circle cx="42" cy="52" r="5" fill="#171a2b"/><path d="M20 24h24M20 32h24" {...common}/></>;
    case "dust_bunny":
      return <><path d="M32 10c6 2 5 8 11 9s10 7 6 12c-3 5 2 9-4 13s-13-2-19 1-15 1-15-6c0-6-6-7-3-13s9-4 12-9 6-9 12-7z" fill="#b9a7ff" {...common}/><circle cx="26" cy="32" r="3" fill="#171a2b"/><circle cx="39" cy="30" r="3" fill="#171a2b"/><path d="M8 52c8-4 14-4 20 0" fill="none" {...common}/></>;
    case "flood_puddle":
      return <><path d="M16 8h32v16H16z" fill="#fff3cf" {...common}/><path d="M32 24v8" strokeWidth={6} stroke="#73dff2" strokeLinecap="round"/><path d="M6 46c0-8 12-12 26-12s26 4 26 12-12 12-26 12S6 54 6 46z" fill="#73dff2" {...common}/><path d="M22 42c4-3 12-3 18 0" fill="none" {...common}/></>;
    case "updraft_vent":
      return <><rect x="12" y="44" width="40" height="12" rx="4" fill="#6e7487" {...common}/><path d="M20 44v12M32 44v12M44 44v12" {...common}/><path d="M32 38V10M22 20l10-11 10 11" fill="none" strokeWidth={5} stroke="#73dff2" strokeLinecap="round" strokeLinejoin="round"/><path d="M18 36V22M46 36V22" fill="none" strokeWidth={4} stroke="#73dff2" strokeLinecap="round"/></>;
    case "mattress_rebound":
      return <><rect x="16" y="6" width="30" height="50" rx="8" fill="#bfe8ff" {...common}/><path d="M16 20h30M16 34h30M16 46h30" {...common}/><path d="M8 16l-4-6M8 32H2M8 48l-4 6" strokeWidth={5} stroke="#ff5964" strokeLinecap="round"/><path d="M56 26l6 6-6 6" fill="none" strokeWidth={5} stroke="#ff5964" strokeLinecap="round" strokeLinejoin="round"/></>;
    case "plate_shards":
      return <><ellipse cx="32" cy="18" rx="18" ry="7" fill="#fff3cf" {...common}/><path d="M14 18c0 5 8 9 18 9s18-4 18-9" fill="none" {...common}/><path d="M8 44l10-6 3 9zM26 50l10-8 4 10zM44 42l10 2-4 10z" fill="#fff3cf" {...common}/></>;
    case "cat_flap":
      // Cream surround, purple leaf: the colours of the prop, which takes them
      // from assets/reference/trap-cat-flap.png.
      return <><rect x="8" y="4" width="48" height="56" rx="5" fill="#fff3cf" {...common}/><rect x="18" y="18" width="28" height="34" rx="4" fill="#171a2b" {...common}/><path d="M18 20h28v26H20z" fill="#b9a7ff" {...common}/><path d="M18 20h28" strokeWidth={5} stroke="#6e7487" strokeLinecap="round"/></>;
    case "paparazzi":
      return <><rect x="6" y="24" width="42" height="28" rx="6" fill="#6e7487" {...common}/><path d="M18 24l4-7h14l4 7" fill="#6e7487" {...common}/><circle cx="27" cy="38" r="9" fill="#73dff2" {...common}/><circle cx="27" cy="38" r="3" fill="#171a2b"/><rect x="44" y="14" width="14" height="10" rx="3" fill="#fff3cf" {...common}/><path d="M51 12V4M58 10l5-5M44 10l-5-5" strokeWidth={5} stroke="#ffd84d" strokeLinecap="round"/></>;
    case "bathroom_scales":
      return <><rect x="8" y="18" width="48" height="34" rx="6" fill="#fff3cf" {...common}/><path d="M20 52v5M44 52v5" {...common}/><circle cx="32" cy="33" r="11" fill="#bfe8ff" {...common}/><path d="M32 33l7-6" strokeWidth={5} stroke="#ff5964" strokeLinecap="round"/><path d="M23 29v-2M41 29v-2M32 24v-2" {...common}/></>;
    case "slow_fuse":
      return <><circle cx="32" cy="38" r="20" fill="#ff5964" {...common}/><circle cx="32" cy="38" r="12" fill="#fff3cf" {...common}/><path d="M32 38V30M32 38l7 5" {...common}/><rect x="26" y="10" width="12" height="8" rx="3" fill="#6e7487" {...common}/><path d="M32 18v3" {...common}/></>;
    case "pile_on":
      return <><rect x="10" y="6" width="30" height="48" rx="4" fill="#ff9b4a" transform="rotate(14 25 30)" {...common}/><path d="M12 22h30M15 38h30" strokeWidth={4} stroke="#171a2b" strokeLinecap="round" transform="rotate(14 25 30)"/><rect x="16" y="10" width="6" height="10" rx="1" fill="#73dff2" transform="rotate(14 25 30)" {...common}/><rect x="26" y="10" width="6" height="10" rx="1" fill="#ffd84d" transform="rotate(14 25 30)" {...common}/><path d="M4 58h56" {...common}/></>;
    case "bin_pedal":
      return <><path d="M18 26h28l-4 28H22z" fill="#57dfa1" {...common}/><path d="M14 20h36" strokeWidth={6} stroke="#6e7487" strokeLinecap="round" transform="rotate(-14 32 20)"/><path d="M26 32v14M32 32v14M38 32v14" {...common}/><path d="M18 54h-8" strokeWidth={5} stroke="#171a2b" strokeLinecap="round"/><rect x="4" y="50" width="10" height="8" rx="2" fill="#ffd84d" {...common}/></>;
    case "swing_door":
      return <><rect x="8" y="6" width="10" height="52" rx="2" fill="#6e7487" {...common}/><path d="M18 10l32 8v34l-32 6z" fill="#ff9b4a" {...common}/><circle cx="26" cy="34" r="3" fill="#ffd84d" {...common}/><path d="M52 22c8 6 8 18 0 24" fill="none" strokeWidth={4} stroke="#73dff2" strokeLinecap="round"/><path d="M50 44l4 4 4-6" fill="none" strokeWidth={4} stroke="#73dff2" strokeLinecap="round" strokeLinejoin="round"/></>;
    case "ball_machine":
      return <><rect x="10" y="28" width="34" height="26" rx="6" fill="#b9a7ff" {...common}/><path d="M14 28l4-12h22l4 12z" fill="#6e7487" {...common}/><circle cx="22" cy="20" r="4" fill="#ffd84d" {...common}/><circle cx="33" cy="20" r="4" fill="#73dff2" {...common}/><rect x="44" y="34" width="12" height="10" rx="3" fill="#6e7487" {...common}/><circle cx="59" cy="39" r="4" fill="#ff5964" {...common}/><path d="M18 54v4M38 54v4" {...common}/></>;
    case "cuckoo_clock":
      return <><path d="M32 4l22 16H10z" fill="#ff9b4a" {...common}/><rect x="12" y="20" width="40" height="30" rx="4" fill="#ff9b4a" {...common}/><rect x="22" y="26" width="20" height="16" rx="3" fill="#171a2b" {...common}/><circle cx="46" cy="34" r="5" fill="#ffd84d" {...common}/><path d="M22 50l-4 10M42 50l4 10" {...common}/><ellipse cx="32" cy="34" rx="6" ry="5" fill="#73dff2" {...common}/></>;
    case "fish_bowl":
      return <><path d="M10 30a22 22 0 1 0 44 0 22 22 0 0 0-44 0z" fill="#bfe8ff" {...common}/><path d="M11 32c8 6 14 6 21 2s16-4 21 1" fill="none" strokeWidth={4} stroke="#4b8dff" strokeLinecap="round"/><path d="M24 40c4-4 10-4 13 0-3 4-9 4-13 0z" fill="#ff9b4a" {...common}/><path d="M37 40l6-4v8z" fill="#ff9b4a" {...common}/><path d="M22 16h20" strokeWidth={5} stroke="#6e7487" strokeLinecap="round"/></>;
    case "shoe_rack":
      return <><path d="M10 22h44M10 38h44" strokeWidth={5} stroke="#ff9b4a" strokeLinecap="round"/><path d="M12 14v40M52 14v40" strokeWidth={5} stroke="#6e7487" strokeLinecap="round"/><path d="M16 22c8-1 8 6 14 6v-6z" fill="#ff5964" {...common}/><path d="M34 38c8-1 8 6 14 6v-6z" fill="#73dff2" {...common}/></>;
    case "hot_potato":
      return <><ellipse cx="32" cy="42" rx="21" ry="15" fill="#ff9b4a" {...common}/><circle cx="24" cy="40" r="2.5" fill="#171a2b"/><circle cx="39" cy="38" r="2.5" fill="#171a2b"/><path d="M25 48c4 3 10 3 14 0" fill="none" {...common}/><path d="M22 22c-4-5 4-8 0-13M32 20c-4-5 4-8 0-13M42 22c-4-5 4-8 0-13" fill="none" strokeWidth={4} stroke="#ff5964" strokeLinecap="round"/></>;
    case "stove_ring":
      return <><circle cx="32" cy="34" r="24" fill="#6e7487" {...common}/><circle cx="32" cy="34" r="10" fill="#fff3cf" {...common}/><path d="M32 20c-3-5 3-7 0-10M20 30c-4-4 2-7-1-10M44 30c-4-4 2-7-1-10" fill="none" strokeWidth={4} stroke="#ff5964" strokeLinecap="round"/><path d="M18 44c3 5 9 8 14 8s11-3 14-8" fill="none" strokeWidth={4} stroke="#ffd84d" strokeLinecap="round"/></>;
    case "clothes_airer":
      return <><path d="M20 8L10 58M44 8l10 50" strokeWidth={5} stroke="#6e7487" strokeLinecap="round"/><path d="M17 22h30M15 34h34M13 46h38" strokeWidth={4} stroke="#b9a7ff" strokeLinecap="round"/><path d="M22 22c0 8 6 8 6 0" fill="#73dff2" {...common}/><path d="M36 34c0 9 7 9 7 0" fill="#ffd84d" {...common}/></>;
    case "ice_dispenser":
      return <><rect x="10" y="4" width="44" height="56" rx="6" fill="#bfe8ff" {...common}/><rect x="20" y="16" width="24" height="20" rx="4" fill="#171a2b" {...common}/><path d="M24 36l4 8M32 36v10M40 36l-4 8" strokeWidth={4} stroke="#73dff2" strokeLinecap="round"/><rect x="24" y="46" width="8" height="8" rx="2" fill="#73dff2" {...common}/><rect x="35" y="48" width="7" height="7" rx="2" fill="#73dff2" {...common}/></>;
    case "kettle_boil":
      return <><path d="M14 30h32l-3 24H17z" fill="#6e7487" {...common}/><path d="M46 34c8 2 8 12 0 14" fill="none" strokeWidth={5} stroke="#6e7487" strokeLinecap="round"/><path d="M18 30c0-8 28-8 28 0" fill="none" {...common}/><rect x="26" y="20" width="12" height="6" rx="3" fill="#ff5964" {...common}/><path d="M24 16c-4-5 4-8 0-13M40 16c-4-5 4-8 0-13" fill="none" strokeWidth={4} stroke="#73dff2" strokeLinecap="round"/></>;
    case "junk_drift":
      return <><path d="M4 52c2-10 10-8 12-16s12-6 14 2 10-2 14 4 12 2 16 10z" fill="#b9a7ff" {...common}/><rect x="18" y="30" width="11" height="9" rx="2" fill="#ff9b4a" transform="rotate(-18 23 34)" {...common}/><path d="M36 34l9-3 2 8-9 2z" fill="#fff3cf" {...common}/><circle cx="52" cy="44" r="4" fill="#ffd84d" {...common}/><path d="M4 58h56" {...common}/></>;
    case "charles_murder_baby":
      return <><circle cx="29" cy="24" r="15" fill="#f3bd91" {...common}/><path d="M17 38c5-8 20-8 27 0l-3 15H18z" fill="#f3ad22" {...common}/><path d="M20 46h20l-2 10H22z" fill="#fff3cf" {...common}/><ellipse cx="24" cy="23" rx="2.5" ry="4" fill="#171a2b"/><ellipse cx="34" cy="23" rx="2.5" ry="4" fill="#171a2b"/><path d="M20 17l7 3M38 17l-7 3M24 32c3-3 7-3 10 0" fill="none" {...common}/><path d="M44 40l11-20 5 24z" fill="#c9d1da" {...common}/><circle cx="55" cy="45" r="5" fill="#ff5964" {...common}/></>;
    default:
      // Same invariant TrapRenderer's dispatch carries: a roster entry with no
      // glyph draws an empty box on the choice screen rather than failing, so
      // `never` turns the omission into a compile error.
      return unglyphed(type);
  }
}

function unglyphed(type: never): null {
  console.error(`TrapIcon has no glyph for ${String(type)}`);
  return null;
}

export function TrapIcon({ type }: { type: TrapType }) {
  return <span className={`trap-icon trap-icon-${type}`} aria-hidden="true"><svg viewBox="0 0 64 64" width="72" height="72"><Glyph type={type}/></svg></span>;
}
