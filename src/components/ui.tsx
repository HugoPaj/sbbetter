"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useSyncExternalStore, type ComponentType, type ReactNode, type SVGProps } from "react";
import { createPortal } from "react-dom";

export function cn(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

/** Simplified double-arrow mark (drawn from scratch, not the official asset). */
export function SbbLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 32" preserveAspectRatio="none" className={className} aria-label="SBB" fill="currentColor">
      <path d="M16 4h9l-8 8h13V4h4v8h13l-8-8h9l12 12-12 12h-9l8-8H34v8h-4v-8H17l8 8h-9L4 16z" />
    </svg>
  );
}

/**
 * Red top bar. The bar itself is sticky; `extend` adds a red skirt below it
 * that scrolls with the page, so the first card (wrapped in `Overlap`) can sit
 * on top of it like in the native app and still slide under the bar on scroll.
 */
export function Header({
  title,
  back,
  children,
  extend = false,
}: {
  title: string;
  back?: boolean | string;
  children?: ReactNode;
  extend?: boolean;
}) {
  const router = useRouter();
  return (
    <>
      <header className={cn("sticky top-0 z-30 bg-sbb-red px-2 pt-[max(env(safe-area-inset-top),6px)]", children ? "pb-4" : "pb-[3px]")}>
        <div className="relative flex h-10 items-center justify-center">
          {back && (
            <button
              aria-label="Back"
              onClick={() => (typeof back === "string" ? router.push(back) : router.back())}
              className="absolute left-0 -ml-1.25 p-1.75"
            >
              <ChevronLeft className="size-6" strokeWidth={1.75} />
            </button>
          )}
          <h1 className="text-[17.5px] font-light tracking-tight">{title}</h1>
          <SbbLogo className="absolute -right-0.5 h-5 w-[31.5px]" />
        </div>
        {children && <div className="mt-[2.5px]">{children}</div>}
      </header>
      {extend && <div aria-hidden className={cn("bg-gradient-to-b from-sbb-red to-[#d60000]", children ? "h-6" : "h-[27.5px]")} />}
    </>
  );
}

/** Content wrapper that pulls the first card up over the header skirt. */
export function Overlap({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("relative z-10 -mt-6 px-[8.5px]", className)}>{children}</div>;
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
            o.value === value ? "bg-sbb-red font-bold shadow-[inset_0_0_0_1px_var(--color-sbb-red-deep)]" : "font-light",
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
    <div className="flex h-[44px] flex-1 rounded-full bg-surface shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)]">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "-my-px flex flex-1 items-center justify-center rounded-full text-[16px] font-light tracking-tight",
            o.value === value && "border border-white/45 bg-surface-3",
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
    <div className="flex min-h-[44.5px] items-center gap-[11px] border-b border-line px-4.25 py-[8.5px] last:border-b-0">
      {IconCmp && <IconCmp className="size-[22px] shrink-0" strokeWidth={1.1} />}
      <span className="flex-1 text-[16px] font-light tracking-tight">{label}</span>
      {trailing}
      {chevron && <ChevronRight className="size-4.25 text-white/70" strokeWidth={1.5} />}
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
      className="flex min-h-[43.5px] w-full items-center gap-[11px] rounded-[15px] border border-white/15 bg-[#444] py-[7.5px] pr-[19px] pl-4 text-left"
    >
      <span className="shrink-0 [&>svg]:size-[22px]">{icon}</span>
      <span className="min-w-0 flex-1 text-[15.5px] leading-[20px] font-light tracking-tight hyphens-auto">{label}</span>
      <ChevronRight className="size-4.25 shrink-0 text-white/80" strokeWidth={1.5} />
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
    "flex h-[44px] w-full items-center justify-center rounded-full bg-sbb-red px-4.25 text-[15.5px] font-light tracking-tight whitespace-nowrap shadow-lg shadow-black/40 active:bg-sbb-red-dark disabled:opacity-50",
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
      className={cn("flex size-[44px] shrink-0 items-center justify-center rounded-full border border-white/50 bg-surface", className)}
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

/** Bottom sheet / full-height modal inside the phone frame. */
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
  return (
    <Overlay>
      <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 mx-auto flex max-w-[430px] flex-col justify-end bg-black/60 animate-fade-in" onClick={onClose}>
        <div
          className={cn(
            "animate-sheet-up flex flex-col overflow-hidden rounded-t-[24px] bg-[#171717]",
            full ? "h-[calc(100dvh-44px)]" : "max-h-[85dvh]",
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between gap-2.5 px-4 pt-4.25 pb-3.5">
            <h2 className="min-w-0 truncate text-[17.5px] font-light tracking-tight">{title}</h2>
            <button aria-label="Close" onClick={onClose} className="flex size-8 shrink-0 items-center justify-center rounded-full border border-white/50">
              <X className="size-5" strokeWidth={1.25} />
            </button>
          </div>
          <div className="no-scrollbar flex-1 overflow-y-auto px-4 pb-[max(env(safe-area-inset-bottom),27px)]">{children}</div>
        </div>
      </div>
    </Overlay>
  );
}

export function Checkbox({ checked }: { checked: boolean }) {
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-[4.5px] border border-white/60">
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
    <span className="flex size-[19px] shrink-0 items-center justify-center rounded-full border-[1.5px] border-white">
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

export function Spinner() {
  return <div className="mx-auto my-8.5 size-6.75 animate-spin rounded-full border-2 border-white/20 border-t-white" />;
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Card className="mx-[8.5px] my-3.5 p-4.25 text-center">
      <p className="font-light text-white/80">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="mt-2.5 rounded-full border border-white/40 px-4.25 py-1.75">
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
  toasts = [...toasts.slice(-2), { id, message }];
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
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--home-inset)+98px)] z-[60] mx-auto flex max-w-[430px] flex-col items-center gap-1.5 px-4">
        {items.map((t) => (
          <p key={t.id} role="status" className="animate-fade-in max-w-full rounded-[15px] border border-white/25 bg-[#2e2e2e] px-4 py-2.5 text-center text-[14.5px] leading-snug font-light tracking-tight shadow-lg shadow-black/60">
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
  const cls = cn("flex h-[44px] w-full items-center justify-center gap-2 rounded-full border border-white/50 bg-surface px-4.25 text-[15.5px] font-light tracking-tight whitespace-nowrap", className);
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
  const btn = "flex size-8 items-center justify-center rounded-full border border-white/50 text-[18px] leading-none font-light disabled:opacity-30";
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
