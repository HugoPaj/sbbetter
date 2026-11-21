"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CircleUserRound, Monitor, Moon, Store, Sun, ToggleLeft } from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { PlanIcon, QrIcon, TripsIcon } from "./icons";
import { SbbLogo, cn } from "./ui";
import { THEME_OPTIONS, setTheme, useTheme, useThemeChoice } from "@/lib/theme";

type Tab = { href: string; label: string; icon: ComponentType<SVGProps<SVGSVGElement> & { strokeWidth?: number }>; match: string[] };

export const TABS: Tab[] = [
  { href: "/plan", label: "Plan", icon: PlanIcon, match: ["/plan", "/connections", "/offers"] },
  { href: "/trips", label: "Trips", icon: TripsIcon, match: ["/trips"] },
  { href: "/easyride", label: "EasyRide", icon: ToggleLeft, match: ["/easyride"] },
  { href: "/tickets", label: "Tickets & Travelcards", icon: QrIcon, match: ["/tickets"] },
  { href: "/shop", label: "Shop & Services", icon: Store, match: ["/shop"] },
  { href: "/profile", label: "Profile", icon: CircleUserRound, match: ["/profile"] },
];

const BAR = "var(--color-bar)";
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
  // Always mounted: keeps the theme in step with the device setting while "System" is chosen.
  useTheme();
  const activeIndex = TABS.findIndex((t) => t.match.some((m) => pathname.startsWith(m)));
  const active = TABS[activeIndex];
  /** Centre of the active tab, measured from the bar's left edge. */
  const cx = `(${PAD}px + (100% - ${2 * PAD}px) * ${(activeIndex + 0.5) / TABS.length})`;
  const slide = "transition-[left,width] duration-200 ease-out";

  return (
    <nav className="fixed bottom-0 left-1/2 z-40 w-full max-w-[430px] -translate-x-1/2 light:drop-shadow-[0_-1px_8px_rgba(0,0,0,0.12)] lg:hidden">
      <div className="relative h-[calc(60px+var(--home-inset))] overflow-hidden">
        {/* Bar background. With an active tab it is split around a pocket that shows the page behind. */}
        {active ? (
          <>
            <div className={cn("absolute inset-y-0 left-0", slide)} style={{ width: `calc(${cx} - ${NOTCH - 1}px)`, background: BAR }} />
            <div className={cn("absolute inset-y-0 w-[108px]", slide)} style={{ left: `calc(${cx} - ${NOTCH}px)` }}>
              <svg viewBox="0 0 108 60" className="block h-[60px] w-[108px]" aria-hidden>
                <path d={NOTCH_PATH} style={{ fill: BAR }} />
              </svg>
              <div className="absolute inset-x-0 top-[59px] bottom-0" style={{ background: BAR }} />
            </div>
            <div className={cn("absolute inset-y-0 right-0", slide)} style={{ left: `calc(${cx} + ${NOTCH - 1}px)`, background: BAR }} />
            <span
              aria-hidden
              className={cn("absolute top-[8px] -ml-[22px] size-[44px] rounded-full bg-fg", slide)}
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
                  className={cn("flex h-full items-center justify-center transition-colors", isActive ? "text-page" : "text-fg")}
                >
                  <Icon className="size-[22px]" strokeWidth={1.25} />
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}

/** Desktop navigation: a fixed side bar (248px, see the root layout) that replaces the tab bar. */
export function SideNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="fixed inset-y-0 left-0 z-40 hidden w-[248px] flex-col bg-[#161616] light:bg-white lg:flex">
      {/* Same height and colour as the page header, so the red bar runs across the whole window. */}
      <Link href="/plan" className="flex h-16 shrink-0 items-center gap-3 bg-sbb-red px-6 text-white">
        <SbbLogo className="h-5 w-[31.5px]" />
        <span className="text-[17px] font-bold tracking-tight">SBBetter</span>
      </Link>
      <ul className="flex-1 space-y-1 overflow-y-auto border-r border-fg/10 p-3">
        {TABS.map((t) => {
          const Icon = t.icon;
          const isActive = t.match.some((m) => pathname.startsWith(m));
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex h-11 items-center gap-3.5 rounded-full px-4 text-[15.5px] tracking-tight transition-colors",
                  isActive ? "bg-fg text-page" : "font-light text-fg/85 hover:bg-fg/10 hover:text-fg",
                )}
              >
                <Icon className="size-[22px] shrink-0" strokeWidth={1.25} />
                <span className="truncate">{t.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="border-t border-r border-fg/10 p-3">
        <ThemeSwitch />
        <p className="px-3 pt-3 pb-1 text-[12px] font-light text-dim">Hackathon prototype</p>
      </div>
    </nav>
  );
}

const THEME_ICONS = { system: Monitor, light: Sun, dark: Moon };

/** System / light / dark, in the side bar (phones have it under Profile → Appearance). */
function ThemeSwitch() {
  const choice = useThemeChoice();
  return (
    <div role="radiogroup" aria-label="Appearance" className="flex rounded-full bg-fg/5 p-1">
      {THEME_OPTIONS.map((o) => {
        const Icon = THEME_ICONS[o.value];
        const on = o.value === choice;
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={on}
            aria-label={o.label}
            title={`${o.label}: ${o.hint.toLowerCase()}`}
            onClick={() => setTheme(o.value)}
            className={cn("flex h-8 flex-1 items-center justify-center rounded-full transition-colors", on ? "bg-fg text-page" : "text-fg/70 hover:text-fg")}
          >
            <Icon className="size-4" strokeWidth={1.5} />
          </button>
        );
      })}
    </div>
  );
}
