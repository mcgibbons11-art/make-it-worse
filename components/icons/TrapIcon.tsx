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
  }
}

export function TrapIcon({ type }: { type: TrapType }) {
  return <span className={`trap-icon trap-icon-${type}`} aria-hidden="true"><svg viewBox="0 0 64 64" width="72" height="72"><Glyph type={type}/></svg></span>;
}
