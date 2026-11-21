"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CircleUserRound, Store, ToggleLeft } from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { PlanIcon, QrIcon, TripsIcon } from "./icons";
import { cn } from "./ui";

type Tab = { href: string; label: string; icon: ComponentType<SVGProps<SVGSVGElement> & { strokeWidth?: number }>; match: string[] };

export const TABS: Tab[] = [
  { href: "/plan", label: "Plan", icon: PlanIcon, match: ["/plan", "/connections", "/offers"] },
  { href: "/trips", label: "Trips", icon: TripsIcon, match: ["/trips"] },
  { href: "/easyride", label: "EasyRide", icon: ToggleLeft, match: ["/easyride"] },
  { href: "/tickets", label: "Tickets & Travelcards", icon: QrIcon, match: ["/tickets"] },
  { href: "/shop", label: "Shop & Services", icon: Store, match: ["/shop"] },
  { href: "/profile", label: "Profile", icon: CircleUserRound, match: ["/profile"] },
];

const BAR = "#222";
/** Horizontal inset of the tab row (px); the bar background still spans the full width. */
const PAD = 9;
/** Half the width of the notch piece (px). */
const NOTCH = 54;
/**
 * Top edge of the bar around the active tab: two convex fillets (r=24.9) that
 * run into a circular pocket (r=28.9) centred 30px below the bar's top edge.
 * Measured from the native app at 393pt width.
 */
const NOTCH_PATH = "M0 0H0.4A24.9 24.9 0 0 1 25.2 27.37A28.9 28.9 0 1 0 82.8 27.37A24.9 24.9 0 0 1 107.6 0H108V60H0Z";

export function BottomNav() {
  const pathname = usePathname();
  const activeIndex = TABS.findIndex((t) => t.match.some((m) => pathname.startsWith(m)));
  const active = TABS[activeIndex];
  /** Centre of the active tab, measured from the bar's left edge. */
  const cx = `(${PAD}px + (100% - ${2 * PAD}px) * ${(activeIndex + 0.5) / TABS.length})`;
  const slide = "transition-[left,width] duration-200 ease-out";

  return (
    <nav className="fixed bottom-0 left-1/2 z-40 w-full max-w-[430px] -translate-x-1/2">
      <div className="relative h-[calc(77px+var(--home-inset))] overflow-hidden">
        {/* Bar background. With an active tab it is split around a pocket that shows the page behind. */}
        {active ? (
          <>
            <div className={cn("absolute inset-y-0 left-0", slide)} style={{ width: `calc(${cx} - ${NOTCH - 1}px)`, background: BAR }} />
            <div className={cn("absolute inset-y-0 w-[108px]", slide)} style={{ left: `calc(${cx} - ${NOTCH}px)` }}>
              <svg viewBox="0 0 108 60" className="block h-[60px] w-[108px]" aria-hidden>
                <path d={NOTCH_PATH} fill={BAR} />
              </svg>
              <div className="absolute inset-x-0 top-[59px] bottom-0" style={{ background: BAR }} />
            </div>
            <div className={cn("absolute inset-y-0 right-0", slide)} style={{ left: `calc(${cx} + ${NOTCH - 1}px)`, background: BAR }} />
            <span
              aria-hidden
              className={cn("absolute top-[8px] -ml-[22px] size-[44px] rounded-full bg-white", slide)}
              style={{ left: `calc(${cx})` }}
            />
          </>
        ) : (
          <div className="absolute inset-0" style={{ background: BAR }} />
        )}

        <ul className="relative flex h-[60px]" style={{ paddingInline: PAD }}>
          {TABS.map((t, i) => {
            const Icon = t.icon;
            const isActive = i === activeIndex;
            return (
              <li key={t.href} className="flex-1">
                <Link
                  href={t.href}
                  aria-label={t.label}
                  aria-current={isActive ? "page" : undefined}
                  className={cn("flex h-full items-center justify-center transition-colors", isActive ? "text-black" : "text-white")}
                >
                  <Icon className="size-[22px]" strokeWidth={1.25} />
                </Link>
              </li>
            );
          })}
        </ul>
        {active && (
          <p
            className="pointer-events-none absolute top-[59px] -translate-x-1/2 text-[14px] leading-5 font-light tracking-tight whitespace-nowrap"
            style={{ left: `calc(${cx})` }}
          >
            {active.label}
          </p>
        )}
      </div>
    </nav>
  );
}
