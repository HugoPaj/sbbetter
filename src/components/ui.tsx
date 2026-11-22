"use client";

import Link from "next/link";
import { useBack } from "@/lib/nav-back";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useRef, useSyncExternalStore, type ComponentType, type ReactNode, type SVGProps } from "react";
import { createPortal } from "react-dom";

export function cn(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

/**
 * Desktop layout starts at Tailwind's `lg` (1024px). Phones never reach it: their
 * layout viewport is fixed at 393px, so `lg:` classes leave the mobile UI untouched.
 */
const DESKTOP_QUERY = "(min-width: 1024px)";

/** True in a desktop-sized window (false on the server and on phones). For things CSS can't do, like mounting a map. */
export function useIsDesktop() {
  return useSyncExternalStore(
    (onChange) => {
      const m = matchMedia(DESKTOP_QUERY);
      m.addEventListener("change", onChange);
      return () => m.removeEventListener("change", onChange);
    },
    () => matchMedia(DESKTOP_QUERY).matches,
    () => false,
  );
}

/** Desktop: centre a page's content in a readable column. */
export const DESK_COL = "lg:mx-auto lg:w-full lg:max-w-[720px] lg:px-6";

/** Close a dialog with Escape. Only the topmost open dialog reacts. Put the returned ref on the `role="dialog"` element. */
export function useEscape(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const dialogs = document.querySelectorAll('[role="dialog"]');
      if (dialogs[dialogs.length - 1] === ref.current) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });
  return ref;
}

/** SBBetter mark: a play on the SBB double arrow with a "+" (our own drawing, not the official asset; same shapes as scripts/make-pwa-icons.py).
 * The viewBox runs as far below the arrow as the "+" sits above it, so the arrow is what gets centred. */
export function SbbLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="10 10 80 90" className={className} aria-label="SBBetter" fill="currentColor">
      <path d="M10 55 28 37h12L25 52h50L60 37h12l18 18-18 18H60l15-15H25l15 15H28z" />
      <path d="M74 10h6v7h7v6h-7v7h-6v-7h-7v-6h7z" />
    </svg>
  );
}

/**
 * Red top bar. The bar itself is sticky; `extend` adds a red skirt below it
 * that scrolls with the page, so the first card (wrapped in `Overlap`) can sit
 * on top of it like in the native app and still slide under the bar on scroll.
 * Desktop: one 64px bar with the title on the left and `children` beside it; no skirt.
 */
export function Header({
  title,
  back,
  children,
  extend = false,
}: {
  title: string;
  /** Show a back button. A string is where it leads when there's no previous page in the app to return to (default Plan). */
  back?: boolean | string;
  children?: ReactNode;
  extend?: boolean;
}) {
  const goBack = useBack(typeof back === "string" ? back : "/plan");
  return (
    <>
      <header
        className={cn(
          "sticky top-0 z-30 bg-sbb-red px-2 text-white pt-[max(calc(var(--safe-top)+var(--top-gap)),6px)] lg:flex lg:h-16 lg:items-center lg:gap-8 lg:px-8 lg:pt-0 lg:pb-0",
          children ? "pb-4" : "pb-[3px]",
          // One continuous shade from mid-toggle down into the skirt, painted over the toggle too,
          // as SBB does, so the red reads as a single surface rather than slab + strip + skirt.
          extend && !!children && "after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-[38px] after:bg-gradient-to-b after:from-transparent after:to-black/[0.043] lg:after:hidden",
        )}
      >
        <div className="relative flex h-10 items-center justify-center lg:justify-start">
          {back && (
            <button
              aria-label="Back"
              onClick={goBack}
              className="absolute left-0 -ml-1.25 p-1.75 lg:static lg:mr-1 lg:-ml-2.5 lg:rounded-full lg:hover:bg-black/15"
            >
              <ChevronLeft className="size-6" strokeWidth={1.75} />
            </button>
          )}
          <h1 className="text-[17.5px] font-light tracking-tight lg:text-[21px] lg:font-normal">{title}</h1>
          <SbbLogo className="absolute -right-0.5 h-[34.5px] w-[30.5px] lg:hidden" />
        </div>
        {children && <div className="mt-[2.5px] lg:mt-0 lg:w-[380px]">{children}</div>}
      </header>
      {extend && <div aria-hidden className={cn("bg-gradient-to-b to-[#db0000] lg:hidden", children ? "h-6 from-[#e10000]" : "h-[27.5px] from-sbb-red")} />}
    </>
  );
}

/**
 * Content wrapper that pulls the first card up over the header skirt (desktop has no skirt: it just sits below the bar).
 *
 * `sticky` (phone, under a plain `<Header extend />` without children): the card stays exactly where it rests
 * (header + 3.5px: it overlaps the 27.5px skirt by 24px) and the page scrolls under it, instead of the card
 * sliding under the bar and getting cut off. It carries its own copy of the skirt, so the red stays put too.
 * Desktop stays sticky too unless the caller passes `lg:static` (or its own `lg:top-*`).
 */
export function Overlap({
  children,
  className,
  sticky = false,
  fade = false,
  gap = false,
  blur = false,
}: {
  children: ReactNode;
  className?: string;
  sticky?: boolean;
  /** Sticky only: a short page-coloured fade under the card, so what scrolls up meets a gap instead of butting into its edge. Needs room below at rest. */
  fade?: boolean;
  /** Sticky only: a thin solid page-coloured strip under the card (the gap the content keeps at rest), then, once scrolled, a fade like the one above the bottom nav, so what scrolls up fades out instead of sliding visibly under the card's rounded corners. */
  gap?: boolean;
  /** Sticky only: once scrolled, what passes under the card softens through a short blur (as under the Tickets strip) instead of butting into its edge. */
  blur?: boolean;
}) {
  const fadeRef = useRef<HTMLDivElement>(null);
  // The gap's fade and the blur only show once the page scrolls: at rest they would dim the top of what follows.
  useEffect(() => {
    const el = fadeRef.current;
    if (!el) return;
    // Phone: the app scrolls in #app-scroll (layout.tsx), not the window.
    const scroller = document.getElementById("app-scroll");
    if (!scroller) return;
    let frame = 0;
    const check = () => {
      frame = 0;
      el.style.opacity = String(Math.min(1, scroller.scrollTop / 24));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    check();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", onScroll);
    };
  }, [sticky, gap, blur]);
  if (!sticky) return <div className={cn("relative z-10 -mt-6 px-[8.5px] lg:mt-6", className)}>{children}</div>;
  return (
    <div className={cn("sticky top-[calc(max(calc(var(--safe-top)+var(--top-gap)),6px)+46.5px)] z-10 -mt-6 px-[8.5px] lg:mt-6", className)}>
      {/* At rest this lies exactly on the header's skirt; scrolled, it stays when the real one has gone. */}
      <div aria-hidden className="absolute inset-x-0 -top-[5.5px] h-[29.5px] bg-gradient-to-b from-sbb-red to-[#db0000] lg:hidden" />
      {/* Page colour behind the rest, so what scrolls under never shows around the rounded corners. */}
      <div aria-hidden className="absolute inset-x-0 top-6 bottom-0 bg-page lg:hidden" />
      {gap && (
        <>
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-full h-1.25 bg-page lg:hidden" />
          {/* Mirrors the fade above the bottom nav: results fade out on their way under the card. */}
          <div
            ref={fadeRef}
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-[calc(100%+5px)] h-5 bg-[linear-gradient(to_top,transparent,color-mix(in_srgb,var(--color-page)_70%,transparent)_45%,var(--color-page)_85%)] opacity-0 lg:hidden"
          />
        </>
      )}
      {blur && (
        <div
          ref={fadeRef}
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-full h-7 bg-page/40 opacity-0 backdrop-blur-[6px] [mask-image:linear-gradient(to_bottom,black,transparent)] lg:hidden"
        />
      )}
      {fade && <div aria-hidden className="pointer-events-none absolute inset-x-0 top-full h-4 bg-gradient-to-b from-page from-50% to-transparent lg:hidden" />}
      <div className="relative">{children}</div>
    </div>
  );
}

/** Red pill segmented control used in headers. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div role="tablist" className="flex h-[43px] rounded-full bg-sbb-red-dark">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            "-my-px flex-1 rounded-full text-[16px] tracking-tight whitespace-nowrap transition-colors",
            o.value === value ? "bg-sbb-red font-bold shadow-[inset_0_0_0_1px_var(--color-sbb-red-deep)]" : "font-light hover:bg-black/10",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Dark pill toggle used inside content (e.g. 2nd cl. / 1st cl.). */
export function PillToggle<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex h-[44px] flex-1 rounded-full bg-surface shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-fg)_14%,transparent)]">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            // Same height as the track: a taller pill gets cut off where the toggle sits at the edge of a scroll area (sheets).
            "flex flex-1 items-center justify-center rounded-full text-[16px] font-light tracking-tight",
            o.value === value && "border border-fg/45 bg-surface-3",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-[19px] bg-surface", className)}>{children}</div>;
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="px-[15px] pt-[13.5px] pb-1.5 text-[13.5px] font-light tracking-tight">{children}</h2>;
}

type Icon = ComponentType<SVGProps<SVGSVGElement> & { strokeWidth?: number }>;

/** Rows inside a grouped card (Profile, Shop/Services). */
export function ListRow({
  icon: IconCmp,
  label,
  href,
  onClick,
  chevron = false,
  trailing,
}: {
  icon?: Icon;
  label: ReactNode;
  href?: string;
  onClick?: () => void;
  chevron?: boolean;
  trailing?: ReactNode;
}) {
  const inner = (
    <div className="flex min-h-[44.5px] items-center gap-[11px] border-b border-line px-4.25 py-[8.5px] transition-colors last:border-b-0 hover:bg-fg/5">
      {IconCmp && <IconCmp className="size-[22px] shrink-0" strokeWidth={1.1} />}
      <span className="flex-1 text-[16px] font-light tracking-tight">{label}</span>
      {trailing}
      {chevron && <ChevronRight className="size-4.25 text-fg/70" strokeWidth={1.5} />}
    </div>
  );
  if (href) return <Link href={href} className="block border-b border-line last:border-b-0 [&>div]:border-0">{inner}</Link>;
  return (
    <button onClick={onClick} className="block w-full border-b border-line text-left last:border-b-0 [&>div]:border-0">
      {inner}
    </button>
  );
}

/** Grey pill row with icon + chevron (Shop products). */
export function PillLink({ icon, label, onClick }: { icon: ReactNode; label: string; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex min-h-[43.5px] w-full items-center gap-[11px] rounded-[15px] border border-fg/15 bg-[#444] light:bg-[#f0f0f0] py-[7.5px] pr-[19px] pl-4 text-left transition-colors hover:bg-[#505050] light:hover:bg-[#e6e6e6]"
    >
      <span className="shrink-0 [&>svg]:size-[22px]">{icon}</span>
      <span className="min-w-0 flex-1 text-[15.5px] leading-[20px] font-light tracking-tight hyphens-auto">{label}</span>
      <ChevronRight className="size-4.25 shrink-0 text-fg/80" strokeWidth={1.5} />
    </button>
  );
}

export function PrimaryButton({
  children,
  onClick,
  href,
  className,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  href?: string;
  className?: string;
  disabled?: boolean;
}) {
  const cls = cn(
    "flex h-[44px] w-full items-center justify-center rounded-full bg-sbb-red px-4.25 text-[15.5px] text-white font-light tracking-tight whitespace-nowrap shadow-lg shadow-black/40 transition-colors hover:bg-[#d40000] active:bg-sbb-red-dark disabled:opacity-50 disabled:hover:bg-sbb-red",
    className,
  );
  if (href) return <Link href={href} className={cls}>{children}</Link>;
  return (
    <button onClick={onClick} className={cls} disabled={disabled}>
      {children}
    </button>
  );
}

export function RoundButton({
  children,
  onClick,
  label,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  label: string;
  className?: string;
}) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      className={cn("flex size-[44px] shrink-0 items-center justify-center rounded-full border border-fg/50 bg-surface transition-colors hover:bg-surface-2", className)}
    >
      {children}
    </button>
  );
}

/**
 * Renders overlays at the end of <body> so they are not trapped inside a
 * page-level stacking context (and always cover the header and tab bar).
 * Overlays only mount after a user interaction, so `document` is available.
 */
export function Overlay({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}

/** Bottom sheet / full-height modal inside the phone frame. Desktop: a centred dialog. */
export function Sheet({
  title,
  onClose,
  children,
  full = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  full?: boolean;
}) {
  const ref = useEscape(onClose);
  return (
    <Overlay>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="fixed inset-0 z-50 mx-auto flex max-w-[430px] flex-col justify-end bg-black/60 animate-fade-in lg:max-w-none lg:items-center lg:justify-center"
        onClick={onClose}
      >
        <div
          className={cn(
            "animate-sheet-up flex flex-col overflow-hidden rounded-t-[24px] bg-[#171717] light:bg-[#f2f2f2] lg:w-[520px] lg:rounded-[24px] lg:border lg:border-fg/10 lg:shadow-2xl lg:shadow-black",
            full ? "h-[calc(var(--app-h)-var(--sheet-top))] lg:h-[min(760px,calc(100dvh-96px))]" : "max-h-[min(calc(var(--app-h)*0.85),calc(var(--app-h)-var(--sheet-top)))] lg:max-h-[85dvh]",
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between gap-2.5 px-4 pt-4.25 pb-3.5">
            <h2 className="min-w-0 truncate text-[17.5px] font-light tracking-tight">{title}</h2>
            <button aria-label="Close" onClick={onClose} className="flex size-8 shrink-0 items-center justify-center rounded-full border border-fg/50 transition-colors hover:bg-fg/10">
              <X className="size-5" strokeWidth={1.25} />
            </button>
          </div>
          <div className="no-scrollbar flex-1 overflow-x-hidden overflow-y-auto px-4 pb-[max(env(safe-area-inset-bottom),27px)]">{children}</div>
        </div>
      </div>
    </Overlay>
  );
}

export function Checkbox({ checked }: { checked: boolean }) {
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-[4.5px] border border-fg/60">
      {checked && (
        <svg viewBox="0 0 24 24" className="size-3.5 text-sbb-red" fill="none" stroke="currentColor" strokeWidth={3.5}>
          <path d="M5 12.5l4.5 4.5L19 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  );
}

export function Radio({ checked }: { checked: boolean }) {
  return (
    <span className="flex size-[19px] shrink-0 items-center justify-center rounded-full border-[1.5px] border-fg">
      {checked && <span className="size-2.5 rounded-full bg-sbb-red" />}
    </span>
  );
}

export function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={cn("relative h-[28px] w-[63px] shrink-0 rounded-full transition-colors", on ? "bg-sbb-red" : "bg-[#8e8e8e]")}
    >
      <span className={cn("absolute top-[1.5px] h-[25px] w-[37.5px] rounded-full bg-white transition-all", on ? "left-[24px]" : "left-[1.5px]")} />
    </button>
  );
}

/**
 * A placeholder block for one value that is still loading. Size and shape it with `className`.
 * It fades in after a short delay (`.skeleton` in globals.css), so quick loads never flash it.
 */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cn("skeleton block rounded-[5px] bg-fg/10", className)} />;
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Card className="mx-[8.5px] my-3.5 p-4.25 text-center lg:mx-auto lg:max-w-[480px]">
      <p className="font-light text-fg/80">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="mt-2.5 rounded-full border border-fg/40 px-4.25 py-1.75">
          Try again
        </button>
      )}
    </Card>
  );
}

/* ---------------------------------------------------------------- Toasts */

type ToastItem = { id: number; message: string };
let toasts: ToastItem[] = [];
let toastSeq = 0;
const toastListeners = new Set<() => void>();
const NO_TOASTS: ToastItem[] = [];

/** Show a short confirmation at the bottom of the screen (rendered by <Toaster/> in the root layout). */
export function toast(message: string, ms = 2600) {
  const id = ++toastSeq;
  // The newest replaces the rest: stacked, an old message (e.g. a fixed form error) reads as still current.
  toasts = [{ id, message }];
  toastListeners.forEach((l) => l());
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    toastListeners.forEach((l) => l());
  }, ms);
}

export function Toaster() {
  const items = useSyncExternalStore(
    (l) => {
      toastListeners.add(l);
      return () => toastListeners.delete(l);
    },
    () => toasts,
    () => NO_TOASTS,
  );
  if (items.length === 0) return null;
  return (
    <Overlay>
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--home-inset)+81px)] z-[60] mx-auto flex max-w-[430px] flex-col items-center gap-1.5 px-4 lg:left-[248px]">
        {items.map((t) => (
          <p key={t.id} role="status" className="animate-fade-in max-w-full rounded-[15px] border border-fg/25 bg-[#2e2e2e] light:bg-white px-4 py-2.5 text-center text-[14.5px] leading-snug font-light tracking-tight shadow-lg shadow-black/60">
            {t.message}
          </p>
        ))}
      </div>
    </Overlay>
  );
}

/** Label/value line used in detail sheets. */
export function InfoLine({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-3.5 text-[14.5px] font-light tracking-tight">
      <span className="shrink-0 text-muted">{label}</span>
      <span className="min-w-0 text-right">{value}</span>
    </div>
  );
}

/** Secondary outlined pill button. */
export function OutlineButton({ children, onClick, href, className }: { children: ReactNode; onClick?: () => void; href?: string; className?: string }) {
  const cls = cn("flex h-[44px] w-full items-center justify-center gap-2 rounded-full border border-fg/50 bg-surface px-4.25 text-[15.5px] font-light tracking-tight whitespace-nowrap transition-colors hover:bg-surface-2", className);
  if (href)
    return (
      <a href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer" className={cls}>
        {children}
      </a>
    );
  return (
    <button onClick={onClick} className={cls}>
      {children}
    </button>
  );
}

/** − n + counter. */
export function Stepper({ value, onChange, min = 0, max = 9, label }: { value: number; onChange: (v: number) => void; min?: number; max?: number; label: string }) {
  const btn = "flex size-8 items-center justify-center rounded-full border border-fg/50 text-[18px] leading-none font-light disabled:opacity-30";
  return (
    <div className="flex items-center gap-3">
      <button aria-label={`Fewer ${label}`} className={btn} disabled={value <= min} onClick={() => onChange(value - 1)}>
        −
      </button>
      <span className="w-4 text-center text-[16px] tabular-nums">{value}</span>
      <button aria-label={`More ${label}`} className={btn} disabled={value >= max} onClick={() => onChange(value + 1)}>
        +
      </button>
    </div>
  );
}
