import type { ReactNode } from "react";
import { cn } from "./ui";

type Variant = "lake" | "station" | "commute";

const SKY: Record<Variant, [string, string]> = {
  lake: ["#222c44", "#55617f"],
  station: ["#1a2233", "#4a5674"],
  commute: ["#0c111c", "#262d45"],
};

/** Deterministic star field. */
const STARS = Array.from({ length: 22 }, (_, i) => ({
  x: (i * 97 + 31) % 400,
  y: 150 + ((i * 53) % 260),
  r: i % 5 === 0 ? 1.5 : 0.8,
}));

function Train({ x, y, cars, length = 96 }: { x: number; y: number; cars: number; length?: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      {Array.from({ length: cars }, (_, c) => (
        <g key={c} transform={`translate(${c * (length + 3)} 0)`}>
          <rect width={length} height="13" rx="3" fill="#d9dce3" />
          <rect y="9.5" width={length} height="2.5" fill="#d32f2f" />
          {Array.from({ length: Math.floor((length - 10) / 11) }, (_, i) => (
            <rect key={i} x={6 + i * 11} y="3" width="7" height="4.5" rx="0.5" fill="#f5d98a" opacity={i % 4 === 2 ? 0.35 : 0.9} />
          ))}
        </g>
      ))}
    </g>
  );
}

/**
 * Original placeholder illustrations (night sky, mountains, train) used for
 * empty states. Swap for real artwork if you have it.
 */
export function Scene({ variant = "lake" }: { variant?: Variant }) {
  const [top, bottom] = SKY[variant];
  return (
    <svg viewBox="0 0 400 880" preserveAspectRatio="xMidYMax slice" className="absolute inset-0 size-full" aria-hidden>
      <defs>
        <linearGradient id={`sky-${variant}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={top} />
          <stop offset="0.7" stopColor={bottom} />
        </linearGradient>
        <linearGradient id={`rock-${variant}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8b93a8" />
          <stop offset="1" stopColor="#4b5368" />
        </linearGradient>
        <linearGradient id={`grass-${variant}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#35502f" />
          <stop offset="1" stopColor="#111f14" />
        </linearGradient>
        <linearGradient id={`water-${variant}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4c6a80" />
          <stop offset="1" stopColor="#2b4257" />
        </linearGradient>
      </defs>
      <rect width="400" height="880" fill={`url(#sky-${variant})`} />

      {variant !== "commute" && (
        <>
          {STARS.map((s, i) => (
            <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#fff" opacity={0.8} />
          ))}
          {/* far and near ranges */}
          <path d="M0 470l42-52 30 26 58-82 44 60 34-34 46 58 52-74 46 62 48-40v116H0z" fill={`url(#rock-${variant})`} />
          <path d="M130 362l16 22-10 6-14 18-6-24zM306 364l12 20-8 4-10 16-6-22z" fill="#e6eaf2" opacity="0.75" />
          <path d="M0 500l70-44 62 30 76-42 84 48 108-40v88H0z" fill="#3d465c" />
        </>
      )}

      {variant === "lake" && (
        <>
          <path d="M0 512q200-26 400 0v30H0z" fill="#2b4329" />
          <Train x={-30} y={505} cars={5} />
          <rect y="524" width="400" height="80" fill={`url(#water-${variant})`} />
          <path d="M40 548h60M210 560h80M120 574h50M300 584h60" stroke="#86a3b5" strokeWidth="1" opacity="0.45" />
          <path d="M0 610q110-30 220-12t180-6v168H0z" fill={`url(#grass-${variant})`} />
          <rect y="759" width="400" height="121" fill="#111f14" />
          {/* pines */}
          <g fill="#16291b">
            <path d="M38 628l16-46 16 46zM42 604l12-36 12 36zM52 628h4v14h-4z" />
            <path d="M342 622l13-38 13 38zM345 602l10-30 10 30zM353 622h4v12h-4z" />
          </g>
          {/* bench with a traveller looking at the lake */}
          <g>
            <circle cx="206" cy="596" r="8" fill="#c98a5e" />
            <path d="M193 610q13-8 26 0l3 26h-32z" fill="#27365a" />
            <rect x="160" y="628" width="96" height="6" rx="1.5" fill="#1a1512" />
            <rect x="160" y="614" width="96" height="5" rx="1.5" fill="#1a1512" />
            <path d="M168 634h5v20h-5zM243 634h5v20h-5z" fill="#1a1512" />
            <rect x="262" y="622" width="18" height="24" rx="4" fill="#3a2a24" />
            <path d="M266 622v-8h10v8" stroke="#3a2a24" strokeWidth="2" fill="none" />
          </g>
        </>
      )}

      {variant === "station" && (
        <>
          <rect y="528" width="400" height="232" fill="#232a3a" />
          {/* canopy */}
          <path d="M-10 500h300l24 10H-10z" fill="#39425a" />
          <rect x="150" y="510" width="6" height="110" fill="#2b3348" />
          <rect x="178" y="520" width="58" height="16" rx="2" fill="#1f3a8a" />
          <path d="M184 526h30M184 531h20" stroke="#fff" strokeWidth="2" />
          <g transform="translate(0 20)">
            <Train x={-110} y={540} cars={2} length={230} />
          </g>
          <path d="M350 548q22 0 34 26h-34z" fill="#d9dce3" />
          <rect y="592" width="400" height="6" fill="#4a5674" />
          <rect y="598" width="400" height="282" fill="#2c3448" />
          <path d="M0 606h400" stroke="#e9ecf3" strokeWidth="3" strokeDasharray="18 10" opacity="0.6" />
          {/* two travellers holding phones */}
          <g transform="translate(0 6)">
            <circle cx="92" cy="640" r="22" fill="#c98a5e" />
            <path d="M68 632q24-34 48 0-24-10-48 0z" fill="#20242e" />
            <path d="M44 760q0-90 48-94t50 94z" fill="#8a8f3a" />
            <rect x="150" y="690" width="26" height="46" rx="5" transform="rotate(18 163 713)" fill="#f2f2f2" />
            <rect x="150" y="690" width="26" height="12" rx="5" transform="rotate(18 163 713)" fill="#d32f2f" />
          </g>
          <g transform="translate(0 6)">
            <circle cx="312" cy="646" r="20" fill="#e2b193" />
            <path d="M280 640q32-30 64 0-4 6-32 4t-32-4z" fill="#c9b48e" />
            <path d="M264 760q0-84 48-88t48 88z" fill="#3f5d63" />
            <rect x="228" y="694" width="26" height="46" rx="5" transform="rotate(-18 241 717)" fill="#f2f2f2" />
            <rect x="228" y="694" width="26" height="12" rx="5" transform="rotate(-18 241 717)" fill="#d32f2f" />
          </g>
        </>
      )}

      {variant === "commute" && (
        <>
          {/* carriage interior: ceiling, windows, seats */}
          <path d="M0 250L400 330v70H0z" fill="#1b2133" />
          <path d="M0 330h400v180H0z" fill="#2a3149" />
          {[20, 150, 280].map((x) => (
            <g key={x}>
              <rect x={x} y="356" width="104" height="120" rx="12" fill="#3b4666" />
              <path d={`M${x} 440l34-22 30 14 40-26v58a12 12 0 0 1-12 12H${x + 12}a12 12 0 0 1-12-12z`} fill="#2f3a57" />
              <circle cx={x + 78} cy="382" r="6" fill="#dfe5f2" opacity="0.7" />
            </g>
          ))}
          <rect y="500" width="400" height="380" fill="#141a2a" />
          {[-20, 120, 260].map((x, i) => (
            <g key={x}>
              <rect x={x} y={520 + (i % 2) * 14} width="124" height="380" rx="22" fill="#1d2f5c" />
              <rect x={x + 22} y={506 + (i % 2) * 14} width="80" height="26" rx="10" fill="#24386b" />
            </g>
          ))}
          {/* commuter with a laptop */}
          <circle cx="216" cy="560" r="26" fill="#e2b193" />
          <path d="M190 552q26-36 52 0-26-12-52 0z" fill="#c8ccd6" />
          <path d="M150 880V760q4-140 66-146t66 146v120z" fill="#161b26" />
          <path d="M150 716h124l10 44H140z" fill="#8f96a6" />
        </>
      )}
    </svg>
  );
}

/** `top` is the caption offset below the header (px at 393pt); `compact` shrinks the body text for long copy, like the native app. */
export function EmptyState({
  variant,
  title,
  text,
  action,
  top = 28.5,
  compact = false,
}: {
  variant: Variant;
  title: string;
  text: string;
  action?: ReactNode;
  top?: number;
  compact?: boolean;
}) {
  return (
    <div className="relative flex-1 overflow-hidden">
      <Scene variant={variant} />
      <div className="relative mx-[8.5px] rounded-[19px] bg-[#10141d]/55 px-2 pt-[12.5px] pb-4 text-center backdrop-blur-[2px]" style={{ marginTop: top }}>
        <h2 className="text-[16px] font-bold">{title}</h2>
        <p className={cn("mt-[11.5px] leading-[20px] font-light tracking-tight hyphens-auto", compact ? "text-[13.5px]" : "text-[15.5px]")}>{text}</p>
      </div>
      {action && <div className="absolute inset-x-[8.5px] bottom-[calc(var(--home-inset)+101px)]">{action}</div>}
    </div>
  );
}
