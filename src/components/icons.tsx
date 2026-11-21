import type { ReactNode, SVGProps } from "react";

/**
 * Hand-drawn icons for places where lucide has no close match to the
 * reference UI. All are original approximations on a 24×24 grid, not
 * official SBB pictograms.
 */

type IconProps = SVGProps<SVGSVGElement> & { strokeWidth?: number };

function Line({ strokeWidth = 1.25, children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      {children}
    </svg>
  );
}

/* ---------- Tab bar ---------- */

/** Timetable rows with a clock. */
export function PlanIcon(props: IconProps) {
  return (
    <Line {...props}>
      <path d="M3 4.5h4M9.5 4.5h4M16 4.5h4M3 8.5h4M9.5 8.5h4M16 8.5h4M3 12.5h4M3 16.5h4M3 20.5h4" />
      <circle cx="15.5" cy="16.5" r="5" />
      <path d="M15.5 13.7v2.8h2.4" />
    </Line>
  );
}

/** Side view of a train with a pantograph. */
export function TripsIcon(props: IconProps) {
  return (
    <Line {...props}>
      <path d="M2.5 18v-7.5A1.5 1.5 0 0 1 4 9h11c1.8 0 3 .8 3.9 2.4l2.6 4.6v2z" />
      <path d="M5 11.8h3.2v3H5zM10.2 11.8h3.2v3h-3.2zM15.4 11.8H17l1.7 3h-3.3z" />
      <path d="M8 9l3.5-3.5L15 9M9.5 5.5h4" />
      <path d="M1.5 21.5h21M5.5 18v1.7h4V18M14.5 18v1.7h4V18" />
    </Line>
  );
}

/** QR code symbol. */
export function QrIcon(props: IconProps) {
  return (
    <Line {...props}>
      <rect x="3.5" y="3.5" width="6" height="6" />
      <rect x="14.5" y="3.5" width="6" height="6" />
      <rect x="3.5" y="14.5" width="6" height="6" />
      <path d="M6.5 6.5h.01M17.5 6.5h.01M6.5 17.5h.01" strokeWidth={2} />
      <path d="M12 3.5v3M12 9v3H9.5M3.5 12h3M14.5 12h3M20.5 11.5v1M14.5 14.5h2v2h-2zM19 14.5h1.5M14.5 19v1.5h2M19 17.5v3h1.5" />
    </Line>
  );
}

/** Three sliders (search options). */
export function SlidersIcon(props: IconProps) {
  return (
    <Line {...props}>
      <path d="M3 6h9M16 6h5M3 12h3M10 12h11M3 18h11M18 18h3" />
      <circle cx="14" cy="6" r="2" />
      <circle cx="8" cy="12" r="2" />
      <circle cx="16" cy="18" r="2" />
    </Line>
  );
}

/* ---------- Journey ---------- */

/** Current location: ring with a crosshair. */
export function TargetIcon(props: IconProps) {
  return (
    <Line strokeWidth={1.5} {...props}>
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="3.6" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </Line>
  );
}

/** A stop: two concentric rings. */
export function StopIcon(props: IconProps) {
  return (
    <Line strokeWidth={1.5} {...props}>
      <circle cx="12" cy="12" r="6.5" />
      <circle cx="12" cy="12" r="3" />
    </Line>
  );
}

/** "from": stop symbol with a line leaving to the right. */
export function FromIcon(props: IconProps) {
  return (
    <Line {...props}>
      <circle cx="9" cy="12" r="6" />
      <circle cx="9" cy="12" r="2.8" />
      <path d="M15 12h7" />
    </Line>
  );
}

/** "to": line arriving at a filled stop symbol. */
export function ToIcon(props: IconProps) {
  return (
    <Line {...props}>
      <path d="M2 12h7" />
      <circle cx="15" cy="12" r="6" />
      <circle cx="15" cy="12" r="3" fill="currentColor" stroke="none" />
    </Line>
  );
}

/** Thin long arrow between origin and destination, set inline with text. */
export function LongArrow({ className = "mx-[3.5px]" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 22 12"
      className={`inline-block h-2.5 w-[19px] ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label="to"
    >
      <path d="M1 6h20M16.5 1.5L21 6l-4.5 4.5" />
    </svg>
  );
}

/** Walking figure. */
export function WalkIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <circle cx="13" cy="3.6" r="2" fill="currentColor" stroke="none" />
      <path d="M12.6 8.2l-1.4 6M11.2 14.2l3 3.2.6 4.2M11.2 14.2l-1.4 3.6-2.6 3.4M12.6 8.6l2.6 2.6 2.6.6M12.4 8.4l-3.4 1.4-.8 3.4" />
    </svg>
  );
}

/** Occupancy figure (head + body), filled. */
export function PersonGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 6 14" fill="currentColor" className={className} aria-hidden>
      <circle cx="3" cy="1.9" r="1.7" />
      <path d="M0.3 5.4a1 1 0 0 1 1-1h3.4a1 1 0 0 1 1 1V14H0.3z" />
    </svg>
  );
}

/** Dog, side view. */
export function DogIcon(props: IconProps) {
  return (
    <Line {...props}>
      <path d="M3 8.5l2.5 2.5h8.5l2.5-3.5h2.5l2 2.5-2.5 1.5v2h-1.5v6h-2v-5h-6v5H7v-7.5" />
      <path d="M16.5 7.5l-.5-2.5 2 1.5" />
    </Line>
  );
}

/** Folded map with a magnifier ("pick on map"). */
export function MapSearchIcon(props: IconProps) {
  return (
    <Line {...props}>
      <path d="M12 18.4L9 17l-6 2.5v-13L9 4l6 2.5L21 4v8" />
      <path d="M9 4v13M15 6.5V11" />
      <circle cx="17" cy="16.5" r="3" />
      <path d="M19.2 18.8l2.3 2.4" />
    </Line>
  );
}

/** Folded map with a location pin ("show on map"). */
export function MapPinIcon(props: IconProps) {
  return (
    <Line {...props}>
      <path d="M13.2 5.8L9 4 3 6.5v13L9 17l6 2.5 6-2.5v-3.5" />
      <path d="M9 4v13M15 14v5.5" />
      <path d="M18 12.5c2-2.3 3-3.9 3-5.4a3 3 0 0 0-6 0c0 1.5 1 3.1 3 5.4z" />
      <circle cx="18" cy="7" r="0.6" fill="currentColor" />
    </Line>
  );
}

/** Itinerary list: stops on a line with text rows ("show as list"). */
export function ItineraryIcon(props: IconProps) {
  return (
    <Line {...props}>
      <path d="M5 6.5v11" />
      <circle cx="5" cy="4.5" r="2" fill="currentColor" />
      <circle cx="5" cy="19.5" r="2" fill="currentColor" />
      <path d="M10 4.5h11M10 8.5h11M12.5 12h8.5M12.5 15.5h8.5M10 19.5h11" />
    </Line>
  );
}

/** Departure board: panel with rows and a small clock. */
export function BoardIcon(props: IconProps) {
  return (
    <Line {...props}>
      <rect x="2.5" y="5" width="19" height="14.5" rx="0.5" />
      <path d="M5 8.5h9M5 11.5h9M5 14.5h14M5 16.8h14" />
      <rect x="16" y="7.5" width="3.5" height="4" />
    </Line>
  );
}

/** QR symbol struck through (expired ticket). */
export function QrOffIcon(props: IconProps) {
  return (
    <Line {...props}>
      <rect x="4" y="4" width="5.5" height="5.5" />
      <rect x="14.5" y="4" width="5.5" height="5.5" />
      <rect x="4" y="14.5" width="5.5" height="5.5" />
      <path d="M12 4v3M12 9.5h.01M14.5 12h2.5M19.5 12h.5M12 12v2.5M14.5 14.5v2.5h2.5M20 15v5h-2.5M12 17v3h3" />
      <path d="M2.5 2.5l19 19" strokeWidth={1.5} />
    </Line>
  );
}

/** Phone showing a QR code (empty ticket state). */
export function PhoneTicketIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 64 80" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <ellipse cx="32" cy="74" rx="24" ry="4" fill="currentColor" stroke="none" opacity="0.35" />
      <g transform="rotate(-10 32 36)">
        <rect x="14" y="4" width="34" height="62" rx="5" />
        <path d="M26 9h10M27 60h8" />
        <g strokeWidth={1.2}>
          <rect x="20" y="18" width="6" height="6" />
          <rect x="36" y="18" width="6" height="6" />
          <rect x="20" y="34" width="6" height="6" />
          <path d="M31 18v4M31 26h.01M20 28h4M29 28h3M36 28v3h6M30 33v7h5M39 36v4" />
        </g>
      </g>
    </svg>
  );
}

/* ---------- Shop tickets ---------- */

export type TicketGlyph = "route" | "day" | "parking" | "percent";

/** Ticket outline with a notch and a small glyph that hints at the product. */
export function TicketIcon({ glyph, ...props }: IconProps & { glyph: TicketGlyph }) {
  return (
    <Line {...props}>
      <path d="M2.5 5.5h19v3.3a3.2 3.2 0 0 0 0 6.4v3.3h-19z" />
      {glyph === "route" && (
        <>
          <circle cx="7" cy="14.5" r="1.3" />
          <circle cx="13" cy="9.5" r="1.3" />
          <path d="M8 13.6l4-3.2" />
        </>
      )}
      {glyph === "day" && (
        <>
          <rect x="5.5" y="9" width="9" height="7" />
          <path d="M5.5 11.2h9M8 7.8v1.8M12 7.8v1.8M10 12.8v1.8" />
        </>
      )}
      {glyph === "parking" && (
        <>
          <path d="M5 14.5v-1.8l1.3-2.7h5l1.8 2.2 2.4.5v1.8z" />
          <circle cx="7.5" cy="14.8" r="1.1" />
          <circle cx="12.8" cy="14.8" r="1.1" />
        </>
      )}
      {glyph === "percent" && (
        <>
          <path d="M6.5 15.5l7-7" />
          <circle cx="7.3" cy="9.3" r="1.2" />
          <circle cx="12.7" cy="14.7" r="1.2" />
        </>
      )}
    </Line>
  );
}

/* ---------- Mode pictograms (white glyph, used on a blue square) ---------- */

export type Mode = "train" | "bus" | "tram" | "metro" | "ship" | "cable";

const CUT = "var(--color-sbb-blue)";

export function ModeGlyph({ mode, className }: { mode: Mode; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="#fff" aria-hidden>
      {mode === "train" && (
        <g transform="translate(-1.6 -2) scale(1.12)">
          <path d="M11 3.5l-3 2.5h2.2v1.5h1.6V6H14z" />
          <path d="M6 8h10.5c1.3 0 2.3.7 2.8 1.8L21 13.5V17H6z" />
          <rect x="8" y="10" width="3.5" height="3" fill={CUT} />
          <path d="M13.5 10h3.2l1.3 3h-4.5z" fill={CUT} />
          <path d="M1.5 9.5h3M1.5 12.5h3M1.5 15.5h3" stroke="#fff" strokeWidth="1.4" />
          <circle cx="9" cy="18.5" r="1.6" />
          <circle cx="13.5" cy="18.5" r="1.6" />
          <circle cx="18" cy="18.5" r="1.6" />
        </g>
      )}
      {mode === "bus" && (
        <>
          <path d="M2.5 6.5H18l3.5 6.3V17.5h-19z" />
          <path d="M4.5 8.5h4v3.8h-4zM10 8.5h3.5v3.8H10zM15 8.5h2l2.1 3.8H15z" fill={CUT} />
          <circle cx="8" cy="17.5" r="2.8" fill={CUT} />
          <circle cx="8" cy="17.5" r="1.9" />
          <circle cx="8" cy="17.5" r="0.8" fill={CUT} />
        </>
      )}
      {(mode === "tram" || mode === "metro") && (
        <>
          {mode === "tram" && <path d="M5 3.5h14M9.5 7.5l3-4M12.5 3.5l2 4" stroke="#fff" strokeWidth="1.1" fill="none" />}
          <g transform={mode === "metro" ? "translate(0 1.5)" : undefined}>
            <path d="M3 7.5h16.5l1.5 3V17H3z" />
            <path d="M5 9.5h3v3.5H5zM9.5 9.5h3v3.5h-3zM14 9.5h3v3.5h-3z" fill={CUT} />
            <path d="M2 20h20" stroke="#fff" strokeWidth="1.3" />
            <circle cx="7" cy="18" r="1.3" />
            <circle cx="17" cy="18" r="1.3" />
          </g>
        </>
      )}
      {mode === "ship" && (
        <>
          <path d="M5 6h6v3h5v3H5z" />
          <path d="M7 7.5h2.5v1.8H7zM7 10.3h2.5v1H7zM11.5 10.3h3v1h-3z" fill={CUT} />
          <path d="M2.5 13h19l-2.5 4.5H4.5z" />
          <path d="M2 20.5c1.7 0 1.7-1 3.4-1s1.7 1 3.3 1 1.7-1 3.3-1 1.7 1 3.3 1 1.7-1 3.4-1 1.6 1 3.3 1" stroke="#fff" strokeWidth="1.2" fill="none" />
        </>
      )}
      {mode === "cable" && (
        <>
          <path d="M2 7.5l20-4" stroke="#fff" strokeWidth="1.3" />
          <path d="M12 5.5v4.5" stroke="#fff" strokeWidth="1.3" />
          <path d="M5.5 10h13l1.5 5v5.5H4V15z" />
          <path d="M6.5 11.5h4.5v4h-5.5zM13 11.5h4.5l1 4H13z" fill={CUT} />
        </>
      )}
    </svg>
  );
}
