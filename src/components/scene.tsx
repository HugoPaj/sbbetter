import type { CSSProperties, ReactNode } from "react";
import { cn } from "./ui";

type Variant = "lake" | "station" | "commute";

/**
 * Everything that changes between night and day is a `--sc-*` variable (see
 * `.scene` in globals.css): the dark theme shows the scene at night, the light
 * theme by day. People, the red of the trains and the signs keep their colours.
 * `--sc-night` / `--sc-day` are 1 or 0 and fade the lamps, glows and flowers.
 */
const fill = (name: string) => ({ fill: `var(--sc-${name})` });
const line = (name: string) => ({ stroke: `var(--sc-${name})` });
const stop = (name: string) => ({ stopColor: `var(--sc-${name})` });
const night = (k = 1) => ({ opacity: `calc(var(--sc-night) * ${k})` });
const day = (k = 1) => ({ opacity: `calc(var(--sc-day) * ${k})` });

const RED = "#d32f2f";
const GLOW = "#ffe9a8";

/** Deterministic star field (only the part of the sky a phone shows). */
const STARS = Array.from({ length: 34 }, (_, i) => ({
  x: (i * 97 + 31) % 400,
  y: 200 + ((i * 53) % 250),
  r: i % 5 === 0 ? 1.5 : i % 3 === 0 ? 1.1 : 0.7,
  twinkle: i % 3 === 1,
}));

const RANGE = "M0 478L40 430l26 16 66-80 38 54 26-22 36 42 30-32 40-28 44 56 26-18 28 22v84H0z";

/**
 * The scenes are drawn 400 wide (a phone); on desktop the SVG shows x -800…1200.
 * `Tile` repeats a background layer across that width, mirroring every other
 * copy so the edges meet. People and landmarks stay single, in the middle.
 */
function Tile({ children }: { children: ReactNode }) {
  return (
    <>
      <g transform="translate(-800 0)">{children}</g>
      <g transform="matrix(-1 0 0 1 0 0)">{children}</g>
      {children}
      <g transform="matrix(-1 0 0 1 800 0)">{children}</g>
      <g transform="translate(800 0)">{children}</g>
    </>
  );
}
/** x positions of a 400-periodic, mirrored layout (see `Tile`) for an item `w` wide at `x`. */
const tiled = (xs: number[], w = 0) => xs.flatMap((x) => [x - 800, -x - w, x, 800 - x - w, x + 800]);
/** Full-width band: x and width covering the desktop view. */
const WIDE = { x: -800, width: 2000 };

function Cloud({ x, y, s = 1, delay = 0 }: { x: number; y: number; s?: number; delay?: number }) {
  return (
    <g className="sc-drift" style={{ animationDelay: `${delay}s` }}>
      <g transform={`translate(${x} ${y}) scale(${s})`} style={{ ...fill("cloud"), opacity: "var(--sc-cloud-o)" }}>
        <rect x="-26" y="-5" width="52" height="11" rx="5.5" />
        <circle cx="-9" cy="-6" r="8" />
        <circle cx="5" cy="-9" r="10.5" />
        <circle cx="16" cy="-3" r="6.5" />
      </g>
    </g>
  );
}

/** Sky, moon or sun, clouds and the Alps: the backdrop of the outdoor scenes. */
function Backdrop({ id }: { id: string }) {
  return (
    <>
      <Tile>
        {STARS.map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#fff" className={s.twinkle ? "sc-twinkle" : undefined} style={{ opacity: "var(--sc-stars)", animationDelay: `${(i % 7) * 0.6}s` }} />
        ))}
      </Tile>
      {/* moon by night, sun by day */}
      <circle cx="322" cy="262" r="46" fill={`url(#halo-${id})`} />
      <circle cx="322" cy="262" r="15" style={fill("orb")} />
      <g fill="#b9b08f" style={night(0.45)}>
        <circle cx="316" cy="257" r="3.2" />
        <circle cx="327" cy="266" r="2.2" />
        <circle cx="320" cy="270" r="1.4" />
      </g>
      <Tile>
      <Cloud x={64} y={306} s={1.25} />
      <Cloud x={236} y={336} s={0.9} delay={-20} />
      <Cloud x={372} y={300} s={1.05} delay={-40} />
      <Cloud x={150} y={246} s={0.7} delay={-10} />

      {/* far range, main range with shaded faces and snow, wooded foothills */}
      <path d="M0 452l30-32 28 20 38-40 24 24 40-40 32 36 34-28 24 22 40-42 40 48 32-24 38 30v94H0z" style={fill("range-far")} />
      <path d={RANGE} fill={`url(#rock-${id})`} />
      <path
        d="M132 366l38 54 16 100h-68l20-88zM302 380l44 56 14 84h-70l16-80zM40 430l26 16 14 74H30l14-50zM196 398l36 42 8 80h-50l10-80zM372 418l28 22v80h-34l10-60z"
        style={fill("rock-shade")}
        opacity="0.55"
      />
      <path d="M132 366l16 23-8-3-4 12-8-10-8 12-6-12zM302 380l16 20-8-3-5 11-7-9-7 7-9-12zM196 398l10 12-6-2-4 7-6-6h-7z" style={fill("snow")} />
      <path d="M132 366l16 23-8-3-4 12zM302 380l16 20-8-3-5 11zM196 398l10 12-6-2-4 7z" style={fill("rock-shade")} opacity="0.28" />
      <rect y="400" width="400" height="130" fill={`url(#haze-${id})`} />
      <path d="M0 500q40-38 84-24t76-6q40-22 90 4t80-12q40-10 70 8v70H0z" style={fill("hills")} />
      <path d="M0 512q60-20 120-8t110-6q60-14 170 6v36H0z" style={fill("hills-2")} />
      </Tile>
      {/* chalet on the hill */}
      <g transform="translate(296 464)">
        <rect x="-7" y="-1" width="14" height="9" style={fill("chalet")} />
        <path d="M-10 0L0-8l10 8z" style={fill("roof")} />
        <rect x="-4" y="2" width="3" height="3" style={fill("train-window")} />
        <rect x="1.5" y="2" width="3" height="3" style={fill("train-window")} opacity="0.6" />
      </g>
    </>
  );
}

/**
 * A train drawn at the origin, 16 units tall, running left to right; `nose`
 * gives the last car a streamlined cab. Scale it with a transform on a parent.
 */
function Train({ cars, length = 96, nose = false, panto = 0 }: { cars: number; length?: number; nose?: boolean; panto?: number }) {
  const L = length;
  return (
    <g>
      {Array.from({ length: cars }, (_, c) => {
        const cab = nose && c === cars - 1;
        const end = cab ? L - 33 : L - 11;
        const n = Math.floor((end - 11 + 4) / 11);
        const x0 = 11 + (end - 11 - (n * 11 - 4)) / 2;
        return (
          <g key={c} transform={`translate(${c * (L + 3)} 0)`}>
            {c > 0 && <rect x="-3.5" y="2.5" width="4" height="12" style={fill("train-under")} />}
            <path d={`M9 16h20v2.6H9zM${L - 30} 16h20v2.6h-20z`} style={fill("train-under")} />
            <rect x="12" y="-1.1" width={L - (cab ? 40 : 24)} height="1.6" rx="0.8" style={fill("train-under")} opacity="0.55" />
            {c === panto && (
              <path d={`M${L / 2 - 9} -1l6-6.5h9M${L / 2 + 6} -7.5l-5 6.5M${L / 2 - 6} -8h15`} style={line("train-under")} strokeWidth="0.8" fill="none" />
            )}
            {cab ? (
              <path d={`M2.5 0H${L - 16}Q${L - 4} 1 ${L} 12v2.2q0 1.8-2 1.8H2.5Q0 16 0 13.5v-11Q0 0 2.5 0z`} style={fill("train")} />
            ) : (
              <rect width={L} height="16" rx="2.5" style={fill("train")} />
            )}
            <rect x="0.4" y="11.6" width={L - 0.9} height="1.7" fill={RED} />
            <rect x={x0 - 2} y="3.4" width={n * 11} height="6.2" rx="1.2" style={fill("train-band")} />
            {Array.from({ length: n }, (_, i) => (
              <rect key={i} x={x0 + i * 11} y="4.4" width="7" height="4.2" rx="0.6" style={fill("train-window")} opacity={(i + c) % 4 === 2 ? 0.4 : 0.95} />
            ))}
            {[3.4, end + 1.6].map((x) => (
              <g key={x}>
                <rect x={x} y="2.6" width="5.6" height="12.4" rx="0.9" fill={RED} />
                <rect x={x + 1.3} y="4.2" width="3" height="4.4" rx="0.5" style={fill("train-band")} />
              </g>
            ))}
            {cab && (
              <>
                <path d={`M${L - 22} 3.4h8.5q7.5 1 10.3 6.2H${L - 22}z`} style={fill("train-band")} />
                <ellipse cx={L + 1} cy="13.6" rx="5" ry="2.4" fill={GLOW} style={night(0.45)} />
                <circle cx={L - 1.7} cy="13.7" r="0.95" fill="#fff6d6" />
              </>
            )}
          </g>
        );
      })}
    </g>
  );
}

function Pine({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <rect x="-2" y="-2" width="4" height="13" style={fill("trunk")} />
      <path d="M0-62l11 26H5l10 20H7l11 16h-36l11-16h-8l10-20h-6z" style={fill("pine")} />
      <path d="M0-62l-11 26h6l-10 20h8l-11 16H0z" style={fill("pine-lit")} />
    </g>
  );
}

function Lake({ id }: { id: string }) {
  return (
    <>
      <Backdrop id={id} />
      {/* far shore with the railway line */}
      <Tile>
      <path d="M0 516q200-20 400 0v14H0z" style={fill("shore")} />
      <g style={line("rail")} fill="none" opacity="0.7">
        <path d="M0 491h400" strokeWidth="0.6" />
        <path d="M24 488v31M104 487v31M184 486v31M264 487v31M344 488v31" strokeWidth="1.3" />
        <path d="M24 491h7M104 490h7M184 489h7M264 490h7M344 491h7" strokeWidth="1" />
      </g>
      <path d="M0 520.5h400" style={line("rail")} strokeWidth="1.6" />
      <rect y="524" width="400" height="92" fill={`url(#water-${id})`} />
      {/* reflections: the range, then the moon or sun */}
      <path d={RANGE} transform="translate(0 524) scale(1 -0.5) translate(0 -524)" style={fill("rock-shade")} opacity="0.2" />
      </Tile>
      <g style={line("orb")} strokeWidth="1.8" strokeLinecap="round" opacity="0.55">
        <path d="M309 531h26M313 538h18M307 546h30M315 555h14M311 564h22M317 575h10M314 587h16" />
      </g>
      <g className="sc-pass">
        <g transform="translate(-46 502)">
          <Train cars={4} length={82} nose />
          <rect y="24" width="337" height="3.5" rx="1.5" style={fill("train")} opacity="0.22" />
          <rect x="8" y="29" width="300" height="1.5" rx="0.75" style={{ ...fill("train-window"), ...night(0.35) }} />
        </g>
      </g>
      <Tile>
        <g style={line("ripple")} strokeWidth="1" strokeLinecap="round" opacity="0.5">
          <path d="M30 546h52M196 556h66M132 572h44M22 584h38M236 590h54M352 566h38M150 600h30" />
        </g>
      </Tile>
      {/* sailing boat */}
      <g transform="translate(92 562)">
        <path d="M-9 8h18" style={line("ripple")} strokeWidth="1.2" strokeLinecap="round" opacity="0.7" />
        <path d="M0-2v-25l12 23z" style={fill("snow")} />
        <path d="M-2-4v-18l-9 18z" style={fill("snow")} opacity="0.75" />
        <path d="M-13 0h26l-4 5.5h-18z" style={fill("train")} />
        <rect x="-11" y="2.4" width="20" height="1.2" fill={RED} />
      </g>

      {/* near bank */}
      <Tile>
      <path d="M0 612q110-30 220-12t180-6v286H0z" fill={`url(#grass-${id})`} />
      <path d="M0 716q100-30 210-8t190-14v186H0z" style={fill("grass-fg")} opacity="0.75" />
      <g style={fill("pine-lit")}>
        {[
          [84, 664],
          [140, 688],
          [232, 676],
          [312, 668],
          [268, 706],
          [36, 700],
        ].map(([x, y]) => (
          <path key={x} d={`M${x} ${y}l2-8 1.6 8 2.6-10 1 10 3-7 .8 7z`} />
        ))}
      </g>
      <g style={day()}>
        {[
          [70, 676, "#fff"],
          [104, 694, "#ffd84d"],
          [158, 672, "#fff"],
          [246, 690, "#ff8a7a"],
          [298, 684, "#fff"],
          [330, 702, "#ffd84d"],
          [196, 700, "#fff"],
          [52, 712, "#ff8a7a"],
        ].map(([x, y, c]) => (
          <circle key={`${x}`} cx={x} cy={y} r="1.7" fill={c as string} />
        ))}
      </g>
      <Pine x={330} y={648} s={0.62} />
      <Pine x={66} y={652} s={0.72} />
      <Pine x={38} y={640} />
      <Pine x={354} y={636} s={0.92} />
      <Pine x={10} y={664} s={1.3} />
      <Pine x={388} y={660} s={1.25} />
      </Tile>

      {/* hiking signpost */}
      <rect x="117" y="594" width="3" height="68" rx="1" fill="#8b9099" />
      <path d="M121 598h22l5 4.5-5 4.5h-22z" fill="#f2c200" />
      <path d="M116 610H96l-5 4.5 5 4.5h20z" fill="#f2c200" />
      <path d="M124 602.5h14M99 614.5h13" stroke="#2a2a2a" strokeWidth="1.3" strokeLinecap="round" />

      {/* lamp */}
      <ellipse cx="282" cy="655" rx="36" ry="6" fill={GLOW} style={night(0.14)} />
      <circle cx="281" cy="562" r="30" fill={`url(#lamp-${id})`} style={night()} />
      <path d="M292.5 658v-88q0-11-10-11" style={line("post")} strokeWidth="2.6" fill="none" strokeLinecap="round" />
      <rect x="275" y="556" width="12" height="4.5" rx="2" style={fill("post")} />
      <rect x="277" y="560" width="8" height="2" rx="1" style={fill("lamp")} />

      {/* traveller on a bench, looking at the lake */}
      <path d="M165 636v20M251 636v20" style={line("bench")} strokeWidth="4" />
      <circle cx="200" cy="594" r="9" fill="#3a2a22" />
      <path d="M191 594a9 9 0 0 1 18 0v2h-18z" fill={RED} />
      <rect x="190.2" y="592.6" width="19.6" height="4.2" rx="2" fill="#b02525" />
      <circle cx="200" cy="584.6" r="2.4" fill="#f2f2f2" />
      <path d="M183 637l3-23q2-8 14-9 12 1 14 9l3 23z" fill="#d9a441" />
      <path d="M200 605v32" stroke="#b9862e" strokeWidth="1" />
      <rect x="226" y="608" width="21" height="27" rx="6.5" fill="#4f6b78" />
      <rect x="230" y="620" width="13" height="11" rx="3" fill="#3d5561" />
      <path d="M232 608v-3h9v3" stroke="#3d5561" strokeWidth="2" fill="none" />
      <g style={fill("bench")}>
        <rect x="156" y="612" width="104" height="5.5" rx="1.5" />
        <rect x="156" y="621" width="104" height="5.5" rx="1.5" />
        <rect x="153" y="632" width="110" height="6" rx="1.5" />
        <path d="M163 610h4v24h-4zM249 610h4v24h-4z" />
      </g>

      {/* fireflies */}
      <g fill={GLOW} style={night()}>
        {[
          [148, 652],
          [226, 664],
          [318, 640],
          [92, 632],
          [258, 646],
        ].map(([x, y], i) => (
          <circle key={x} cx={x} cy={y} r="1.3" className="sc-twinkle" style={{ animationDelay: `${i * 0.9}s` }} />
        ))}
      </g>
    </>
  );
}

/** Platform paving: lines fanning out towards the viewer from the middle of the platform. */
const PLATFORM_LINES = [
  ...Array.from({ length: 19 }, (_, k) => 200 + (k - 9) * 104).map((x) => `M${x} 652L${200 + (x - 200) * 1.17} 716`),
  ...Array.from({ length: 16 }, (_, k) => 200 + (k - 7.5) * 140).map((x) => `M${x} 716L${200 + (x - 200) * 1.31} 806`),
].join("");

function Station({ id }: { id: string }) {
  return (
    <>
      <Backdrop id={id} />
      {/* far wall and the track */}
      <rect {...WIDE} y="528" height="72" style={fill("wall")} />
      <path d="M-800 536h2000" style={line("wall-line")} strokeWidth="2" />
      <path d={tiled([40, 120, 200]).map((x) => `M${x} 537v54`).join("")} style={line("wall-line")} strokeWidth="1" opacity="0.7" />
      <rect {...WIDE} y="589" height="3" style={fill("rail")} />
      <path d="M372 584l28-12v24z" fill={GLOW} style={night(0.22)} />
      <g transform="translate(0 545.6) scale(2.9)">
        <g transform="translate(-95 0)">
          <Train cars={2} length={110} nose panto={-1} />
        </g>
      </g>

      {/* platform */}
      <rect {...WIDE} y="592" height="7" style={fill("edge")} />
      <rect {...WIDE} y="599" height="341" fill={`url(#floor-${id})`} />
      <rect {...WIDE} y="606" height="3.5" style={fill("marking")} opacity="0.85" />
      <path d="M-800 615.5h2000" style={line("marking")} strokeWidth="2.4" strokeDasharray="3 5" opacity="0.35" />
      <path d="M-800 652h2000M-800 716h2000M-800 806h2000" style={line("platform-line")} strokeWidth="1.2" />
      <path d={PLATFORM_LINES} style={line("platform-line")} strokeWidth="1.2" />

      {/* canopy with lamps, departure board, sector sign and clock */}
      {tiled([20, 160, 346]).map((x) => (
        <path key={x} d={`M${x - 9} 509l-30 90h78l-30-90z`} fill={GLOW} style={night(0.07)} />
      ))}
      {tiled([58, 262], 7).map((x) => (
        <g key={x} style={fill("post")}>
          <rect x={x} y="506" width="7" height="92" />
          <rect x={x - 3} y="593" width="13" height="6" rx="1" />
          <path d={`M${x} 507h7l8 0v3h-4l-4 8h-7l-4-8h-4v-3z`} />
        </g>
      ))}
      <rect {...WIDE} y="490" height="14" style={fill("canopy")} />
      <rect {...WIDE} y="490" height="2.5" style={fill("canopy-lit")} />
      <rect {...WIDE} y="504" height="3" style={fill("post")} />
      {tiled([20, 160, 346]).map((x) => (
        <rect key={x} x={x - 10} y="507" width="20" height="2.6" rx="1.3" style={fill("lamp")} />
      ))}

      <path d="M88 507v6M128 507v6" style={line("post")} strokeWidth="1.4" />
      <rect x="78" y="512" width="60" height="24" rx="2.5" fill="#10141d" />
      <rect x="78" y="512" width="60" height="5" rx="2.5" fill="#1f3a8a" />
      <path d="M83 521.5h8M95 521.5h24M83 526.5h8M95 526.5h18M83 531.5h8M95 531.5h28" stroke="#f5d98a" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M123 526.5h9" stroke="#ff6b5e" strokeWidth="1.7" strokeLinecap="round" />

      <path d="M186 507v6M218 507v6" style={line("post")} strokeWidth="1.4" />
      <rect x="176" y="512" width="52" height="20" rx="2.5" fill="#1f3a8a" />
      <path d="M185.5 517.5h5.5l-3 3.8q3.6.2 3.6 3.2 0 3-3.6 3-2.4 0-3.4-1.6" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M198 517v10" stroke="#fff" strokeWidth="0.8" opacity="0.6" />
      <path d="M203 519.5h18M203 524.5h12" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />

      <rect x="304.5" y="507" width="3" height="8" style={fill("post")} />
      <circle cx="306" cy="528" r="14.5" fill="#1b1f2a" />
      <circle cx="306" cy="528" r="12.4" fill="#fbfbf8" />
      {Array.from({ length: 12 }, (_, i) => (
        <rect key={i} x="305.3" y="516.8" width="1.4" height={i % 3 === 0 ? 3.6 : 2.2} fill="#1b1f2a" transform={`rotate(${i * 30} 306 528)`} />
      ))}
      <path d="M306 528l-5.6-4.2" stroke="#1b1f2a" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M306 528l7.4-6.6" stroke="#1b1f2a" strokeWidth="1.7" strokeLinecap="round" />
      <g className="sc-tick" style={{ transformBox: "fill-box", transformOrigin: "50% 77.1%" }}>
        <path d="M306 531v-11" stroke={RED} strokeWidth="0.9" />
        <circle cx="306" cy="519.6" r="1.7" fill={RED} />
      </g>
      <circle cx="306" cy="528" r="1.2" fill="#1b1f2a" />

      {/* two travellers holding phones */}
      <g>
        <path d="M28 940V758q0-68 50-78h30q46 10 48 78v182z" fill="#8a8f3a" />
        <path d="M78 680h30l-15 20z" fill="#6f7430" />
        <rect x="82" y="662" width="20" height="24" rx="6" fill="#b3764c" />
        <path d="M82 684q10 10 20 0v6q-10 9-20 0z" fill={RED} />
        <circle cx="92" cy="646" r="22" fill="#c98a5e" />
        <path d="M114 648q5 1 5 5t-5 4z" fill="#c98a5e" />
        <path d="M69 650q-4-32 23-32 24 0 23 24-12 2-20-9-6 11-17 11-5 0-9 6z" fill="#20242e" />
        <circle cx="168" cy="716" r="34" fill={`url(#lamp-${id})`} style={night(0.55)} />
        <path d="M126 724l20 54 21-38" stroke="#747a2e" strokeWidth="23" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <g transform="rotate(14 170 716)">
          <rect x="157" y="692" width="26" height="48" rx="5" fill="#1b1f2a" />
          <rect x="159" y="694" width="22" height="44" rx="3.5" fill="#f4f5f7" />
          <rect x="159" y="694" width="22" height="11" rx="3.5" fill={RED} />
          <path d="M163 712h14M163 717h10" stroke="#aeb4c0" strokeWidth="1.6" strokeLinecap="round" />
          <rect x="163" y="723" width="14" height="9" rx="2" fill={RED} />
        </g>
        <circle cx="166" cy="743" r="9.5" fill="#c98a5e" />
      </g>
      <g>
        <path d="M250 940V762q2-66 48-76h28q46 10 48 76v178z" fill="#3f5d63" />
        <path d="M298 686h28l-14 18z" fill="#f0e6d2" />
        <rect x="302" y="664" width="20" height="26" rx="6" fill="#cf9c7d" />
        <path d="M348 700l10 240" stroke="#2c444a" strokeWidth="7" />
        <circle cx="312" cy="650" r="20" fill="#e2b193" />
        <path d="M291 652q-3 22 6 34 4-14 0-34z" fill="#7a4a2c" />
        <path d="M286 642q26-38 52 0z" fill="#d9c7a0" />
        <path d="M276 644q36-11 72 0-36 9-72 0z" fill="#c9b48e" />
        <path d="M288 638q24-6 48 0" stroke="#3f5d63" strokeWidth="3" fill="none" />
        <circle cx="234" cy="720" r="34" fill={`url(#lamp-${id})`} style={night(0.55)} />
        <path d="M276 730l-20 54-20-38" stroke="#34505a" strokeWidth="22" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <g transform="rotate(-14 232 720)">
          <rect x="219" y="696" width="26" height="48" rx="5" fill="#1b1f2a" />
          <rect x="221" y="698" width="22" height="44" rx="3.5" fill="#f4f5f7" />
          <rect x="221" y="698" width="22" height="11" rx="3.5" fill={RED} />
          <path d="M226.5 722l4 4 7-8" stroke="#2e9e5b" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </g>
        <circle cx="236" cy="747" r="9" fill="#e2b193" />
      </g>
    </>
  );
}

/** The landscape outside scrolls left by 400 and repeats, so it is drawn from -800 to 1600. */
const PANS = [-800, -400, 0, 400, 800, 1200];
const SEATS = tiled([60, 200, 340]);
const WINDOWS = tiled([14, 144, 274], 112);

function Commute({ id }: { id: string }) {
  return (
    <>
      {/* carriage: ceiling with light strip, wall, luggage rack */}
      <rect {...WIDE} height="322" style={fill("ceiling")} />
      <rect {...WIDE} y="300" height="40" fill={`url(#strip-${id})`} style={night(0.5)} />
      <rect {...WIDE} y="296" height="5" style={fill("ceiling-light")} />
      <rect {...WIDE} y="322" height="200" style={fill("wall")} />
      <g>
        <rect x="52" y="314" width="64" height="26" rx="10" fill="#a8523f" />
        <path d="M68 314v26M100 314v26" stroke="#8a4031" strokeWidth="3" />
        <rect x="286" y="300" width="50" height="40" rx="5" fill="#3f5d63" />
        <path d="M298 300v-5h26v5" stroke="#2c444a" strokeWidth="3" fill="none" />
        <path d="M296 310v22M326 310v22" stroke="#2c444a" strokeWidth="2" />
      </g>
      <rect {...WIDE} y="339" height="5" rx="2" style={fill("trim")} />
      <path d={tiled([8, 136, 264]).map((x) => `M${x} 344v12`).join("")} style={line("trim")} strokeWidth="3" />

      {/* windows with the landscape rolling past */}
      {WINDOWS.map((x) => (
        <rect key={x} x={x - 5} y="361" width="122" height="146" rx="17" style={fill("trim")} />
      ))}
      <g clipPath={`url(#panes-${id})`}>
        <rect {...WIDE} y="366" height="136" fill={`url(#view-${id})`} />
        <Tile>
          {STARS.slice(0, 16).map((s, i) => (
            <circle key={i} cx={s.x} cy={370 + ((i * 29) % 70)} r={s.r * 0.8} fill="#fff" style={{ opacity: "var(--sc-stars)" }} />
          ))}
        </Tile>
        <circle cx="334" cy="398" r="22" fill={`url(#halo-${id})`} />
        <circle cx="334" cy="398" r="8" style={fill("orb")} />
        <g className="sc-pan-far">
          {PANS.map((o) => (
            <g key={o} transform={`translate(${o} 0)`}>
              <path d="M0 470l40-34 30 18 50-40 40 34 40-22 50 32 50-38 40 26 60 24v40H0z" style={fill("view")} />
              <path d="M120 414l12 10-5-1-4 6-5-5-6 4zM300 422l11 8-5-1-3 5-5-4-5 2z" style={fill("snow")} opacity="0.85" />
            </g>
          ))}
        </g>
        <g className="sc-pan">
          {PANS.map((o) => (
            <g key={o} transform={`translate(${o} 0)`}>
              <path d="M0 484q50-22 100-8t100-2q60-18 120 4t80 6v30H0z" style={fill("view-2")} />
              <g style={fill("view-3")}>
                <path d="M40 480l5-14 5 14zM52 480l4-11 4 11zM232 472l5-15 5 15zM246 474l4-11 4 11zM330 484l5-14 5 14z" />
                <rect x="150" y="468" width="12" height="8" />
                <path d="M147 469l9-7 9 7z" />
              </g>
              <rect x="153" y="470.5" width="2.6" height="2.6" fill={GLOW} style={night()} />
              <circle cx="92" cy="480" r="1.2" fill={GLOW} style={night()} />
              <circle cx="290" cy="482" r="1.2" fill={GLOW} style={night()} />
            </g>
          ))}
        </g>
        {WINDOWS.map((x) => (
          <path key={x} d={`M${x + 18} 366h22l-36 136h-22zM${x + 54} 366h8l-36 136h-8z`} fill="#fff" opacity="0.07" />
        ))}
      </g>
      <rect {...WIDE} y="514" height="5" style={fill("trim")} />
      <rect {...WIDE} y="519" height="421" style={fill("floor")} />

      {/* seats */}
      {SEATS.map((cx) => (
        <g key={cx}>
          <path d={`M${cx - 64} 940V560q0-34 30-38h68q30 4 30 38v380z`} style={fill("seat")} />
          <path d={`M${cx - 46} 940V574q0-22 20-24h52q20 2 20 24v366z`} style={fill("seat-lit")} />
          <rect x={cx - 40} y="504" width="80" height="38" rx="14" style={fill("headrest")} />
          <path d={`M${cx - 40} 522v-4a14 14 0 0 1 14-14h52a14 14 0 0 1 14 14v4z`} style={fill("cover")} />
        </g>
      ))}

      {/* backpack on the left seat */}
      <g>
        <path d="M44 632q0-14 16-14t16 14" stroke="#2c444a" strokeWidth="5" fill="none" />
        <rect x="22" y="628" width="76" height="110" rx="22" fill="#3f5d63" />
        <rect x="34" y="676" width="52" height="48" rx="10" fill="#34505a" />
        <path d="M40 690h40" stroke="#2c444a" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M22 664h76" stroke="#2c444a" strokeWidth="2.5" />
        <rect x="54" y="636" width="12" height="16" rx="3" fill={RED} />
      </g>

      {/* dozing passenger on the right seat */}
      <g>
        <path d="M282 940V716q2-86 44-96h28q44 10 46 96v224z" fill="#56627f" />
        <rect x="330" y="596" width="20" height="26" rx="6" fill="#b3764c" />
        <circle cx="340" cy="574" r="23" fill="#c98a5e" />
        <path d="M331 584q9 5 18 0" stroke="#8a5a3a" strokeWidth="1.8" fill="none" strokeLinecap="round" />
        <path d="M317 570q0-24 23-24t23 24z" fill="#2b3348" />
        <path d="M308 572q32-8 66 0-4 6-34 6t-32-6z" fill="#20283a" />
        <path d="M300 760q40-22 80 0" stroke="#465270" strokeWidth="22" strokeLinecap="round" fill="none" />
      </g>

      {/* commuter with headphones and a laptop */}
      <g>
        <path d="M138 940V708q2-96 50-106h24q48 10 50 106v232z" fill="#d39a3a" />
        <path d="M186 602h28l-14 20z" fill="#f4efe4" />
        <rect x="190" y="584" width="20" height="26" rx="6" fill="#cf9c7d" />
        <circle cx="200" cy="566" r="25" fill="#e2b193" />
        <path d="M175 566q-3-30 25-30t25 30q-8-16-25-16t-25 16z" fill="#4a3226" />
        <path d="M174 566q0-32 26-32t26 32" stroke="#20242e" strokeWidth="4" fill="none" />
        <rect x="167" y="556" width="11" height="22" rx="5" fill={RED} />
        <rect x="222" y="556" width="11" height="22" rx="5" fill={RED} />
        <g stroke="#20242e" strokeWidth="1.7">
          <circle cx="190.5" cy="568" r="6.2" fill="#cfe6ff" fillOpacity="0.35" />
          <circle cx="209.5" cy="568" r="6.2" fill="#cfe6ff" fillOpacity="0.35" />
          <path d="M196.7 568h6.6" fill="none" />
        </g>
        <path d="M194 580q6 4 12 0" stroke="#a86c4e" strokeWidth="1.8" fill="none" strokeLinecap="round" />
        <ellipse cx="200" cy="640" rx="64" ry="70" fill={`url(#screen-${id})`} style={night(0.6)} />
        <path d="M150 668l-4 62M250 668l4 62" stroke="#b9862e" strokeWidth="20" strokeLinecap="round" />
        <rect x="112" y="732" width="176" height="11" rx="5" style={fill("table")} />
        <path d="M152 664h96q5 0 5.5 5l5 63H141.5l5-63q.5-5 5.5-5z" fill="#aeb4c2" />
        <path d="M152 664h96q5 0 5.5 5l.4 5H146.1l.4-5q.5-5 5.5-5z" fill="#c6cbd6" />
        <circle cx="200" cy="700" r="6" fill="#8f96a6" />
        <g className="sc-steam" style={line("steam")} strokeWidth="1.8" fill="none" strokeLinecap="round">
          <path d="M268 700q-4-5 0-10t0-10M275 702q-4-5 0-9" />
        </g>
        <path d="M262 706h18l-2 26h-14z" fill="#f4f5f7" />
        <rect x="261" y="704" width="20" height="4.5" rx="2" fill="#20242e" />
        <rect x="263.3" y="714" width="15.4" height="8" fill={RED} />
      </g>
    </>
  );
}

/**
 * Original placeholder illustrations (lake shore, station platform, carriage)
 * used for empty states: at night in the dark theme, by day in the light one.
 * Swap for real artwork if you have it.
 */
export function Scene({ variant = "lake" }: { variant?: Variant }) {
  const id = variant;
  return (
    // On a phone the SVG is five times as wide as its box, so x 0…400 fills the screen as before; on desktop it fits the box and shows the whole panorama.
    <svg
      viewBox="-800 0 2000 880"
      preserveAspectRatio="xMidYMax slice"
      className={`scene scene-${variant} absolute top-0 left-[-200%] h-full w-[500%] lg:left-0 lg:w-full`}
      aria-hidden
    >
      <defs>
        <linearGradient id={`sky-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.2" style={stop("sky-top")} />
          <stop offset="0.6" style={stop("sky-bottom")} />
        </linearGradient>
        <linearGradient id={`haze-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={stop("haze")} stopOpacity="0" />
          <stop offset="1" style={stop("haze")} stopOpacity="0.5" />
        </linearGradient>
        <radialGradient id={`halo-${id}`}>
          <stop offset="0.25" style={stop("orb")} stopOpacity="0.45" />
          <stop offset="1" style={stop("orb")} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`lamp-${id}`}>
          <stop offset="0" stopColor={GLOW} stopOpacity="0.75" />
          <stop offset="1" stopColor={GLOW} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`screen-${id}`}>
          <stop offset="0" stopColor="#cfe6ff" stopOpacity="0.5" />
          <stop offset="1" stopColor="#cfe6ff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`rock-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={stop("rock-lit")} />
          <stop offset="1" style={stop("rock-shade")} />
        </linearGradient>
        <linearGradient id={`grass-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={stop("grass-top")} />
          <stop offset="0.6" style={stop("grass-bottom")} />
        </linearGradient>
        <linearGradient id={`water-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={stop("water-top")} />
          <stop offset="1" style={stop("water-bottom")} />
        </linearGradient>
        <linearGradient id={`floor-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={stop("platform-lit")} />
          <stop offset="0.35" style={stop("platform")} />
        </linearGradient>
        <linearGradient id={`strip-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={GLOW} stopOpacity="0.5" />
          <stop offset="1" stopColor={GLOW} stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`view-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={stop("window")} />
          <stop offset="0.8" style={stop("window-2")} />
        </linearGradient>
        <clipPath id={`panes-${id}`}>
          {WINDOWS.map((x) => (
            <rect key={x} x={x} y="366" width="112" height="136" rx="12" />
          ))}
        </clipPath>
      </defs>
      <rect {...WIDE} height="880" fill={`url(#sky-${id})`} />
      {variant === "lake" && <Lake id={id} />}
      {/* The station and the carriage sit higher, so the button on a phone clears the phones and the laptop. */}
      {variant === "station" && (
        <g transform="translate(0 -50)">
          <Station id={id} />
        </g>
      )}
      {variant === "commute" && (
        <g transform="translate(0 -40)">
          <Commute id={id} />
        </g>
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
      <div
        className="relative mx-[8.5px] mt-(--top) rounded-[19px] bg-[#10141d]/55 px-2 pt-[12.5px] text-white light:bg-white/80 light:text-fg pb-4 text-center backdrop-blur-[2px] lg:mx-auto lg:mt-10 lg:max-w-[520px] lg:px-6 lg:pt-4 lg:pb-5"
        style={{ "--top": `${top}px` } as CSSProperties}
      >
        <h2 className="text-[16px] font-bold">{title}</h2>
        <p className={cn("mt-[11.5px] leading-[20px] font-light tracking-tight hyphens-auto", compact ? "text-[13.5px]" : "text-[15.5px]")}>{text}</p>
      </div>
      {action && <div className="absolute inset-x-[8.5px] bottom-[calc(var(--home-inset)+84px)] lg:inset-x-0 lg:bottom-10 lg:mx-auto lg:w-[400px]">{action}</div>}
    </div>
  );
}
