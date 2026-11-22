"use client";

import { useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Search, Trash2 } from "lucide-react";
import { Card, Checkbox, InfoLine, OutlineButton, PrimaryButton, Radio, Sheet, Toggle, toast } from "@/components/ui";
import { USER, fullName } from "@/lib/mock-data";
import { actions, useAppState, useSetting } from "@/lib/store";
import { THEME_OPTIONS, setTheme, useThemeChoice } from "@/lib/theme";
import { NATIONAL, travelcardNames, useCatalog, useTravelcards, type NationalId, type ZonePassMeta } from "@/lib/travelcards";

export type ProfileSheet = "personal" | "travelcards" | "copassenger" | "plates" | "wallet" | "notifications" | "ads" | "purchase" | "appearance" | "help" | "legal" | "logout" | "reset";

const INPUT = "h-[44px] w-full rounded-[15px] bg-surface-2 px-3.5 text-[16px] font-light tracking-tight outline-none placeholder:text-muted";

function Note({ children }: { children: ReactNode }) {
  return <p className="mt-3 px-1 text-[12px] leading-snug font-light text-muted">{children}</p>;
}

/** A persisted on/off row. */
function SettingToggle({ id, label, hint, fallback = false }: { id: string; label: string; hint?: string; fallback?: boolean }) {
  const [on, setOn] = useSetting<boolean>(id, fallback);
  return <ToggleRow label={label} hint={hint} on={on} onChange={setOn} />;
}

/** An on/off row. */
function ToggleRow({ label, hint, on, onChange }: { label: string; hint?: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center gap-3.5 border-b border-surface-3 px-4 py-[13px] last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="text-[16px] leading-tight font-light tracking-tight">{label}</p>
        {hint && <p className="mt-1.5 text-[11.5px] leading-tight font-light tracking-tight text-muted">{hint}</p>}
      </div>
      <Toggle on={on} onChange={onChange} />
    </div>
  );
}

/** A persisted single-choice list. */
function SettingChoice({ id, options, fallback }: { id: string; options: { value: string; label: string; hint?: string }[]; fallback: string }) {
  const [value, setValue] = useSetting<string>(id, fallback);
  return (
    <Card className="overflow-hidden">
      {options.map((o) => (
        <button key={o.value} onClick={() => setValue(o.value)} className="flex w-full items-center gap-3 border-b border-surface-3 px-4 py-[12px] text-left last:border-b-0">
          <Radio checked={value === o.value} />
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] leading-tight font-light tracking-tight">{o.label}</span>
            {o.hint && <span className="mt-1 block text-[11.5px] leading-tight font-light text-muted">{o.hint}</span>}
          </span>
        </button>
      ))}
    </Card>
  );
}

function Heading({ children }: { children: ReactNode }) {
  return <h3 className="px-1 pt-4 pb-1.5 text-[13.5px] font-light tracking-tight first:pt-0">{children}</h3>;
}

function PersonalDetails() {
  const [travelcards] = useTravelcards();
  const cards = travelcardNames(travelcards, useCatalog());
  return (
    <>
      <Card className="space-y-2.5 p-4">
        <InfoLine label="First name" value={USER.firstName} />
        <InfoLine label="Last name" value={USER.lastName} />
        <InfoLine label="Date of birth" value={USER.birthDate} />
        <InfoLine label="E-mail" value={USER.email} />
        <InfoLine label="Customer number" value="DEMO-000-000-0" />
        <InfoLine label="Travelcards" value={cards.join(", ") || "None"} />
      </Card>
      <Note>Your personal details are managed in your SwissPass account. This prototype uses a fictitious demo traveller.</Note>
      <div className="mt-4">
        <OutlineButton onClick={() => toast("Demo: this would open your SwissPass account in the browser.")}>Edit in SwissPass account</OutlineButton>
      </div>
    </>
  );
}

/** National cards, zone travelcards (from NOVA tariff data) and regional passes. */
function Travelcards() {
  const [sel, setSel] = useTravelcards();
  const cat = useCatalog();
  const [adding, setAdding] = useState<ZonePassMeta | "network" | null>(null);

  const setNational = (id: NationalId, on: boolean) => {
    let national = on ? [...sel.national, id] : sel.national.filter((x) => x !== id);
    // One GA at a time.
    if (on && (id === "ga1" || id === "ga2")) national = national.filter((x) => x === id || (x !== "ga1" && x !== "ga2"));
    setSel({ ...sel, national });
  };
  const setArea = (id: string, on: boolean) => setSel({ ...sel, areas: on ? [...sel.areas, id] : sel.areas.filter((x) => x !== id) });

  if (adding === "network")
    return (
      <>
        <BackRow label="Travelcards" onClick={() => setAdding(null)} />
        <Heading>Choose the fare network</Heading>
        <Card className="overflow-hidden">
          {cat?.zonePasses.map((p) => <LinkRow key={p.id} label={p.network} hint={p.label} onClick={() => setAdding(p)} />)}
        </Card>
      </>
    );
  if (adding)
    return (
      <ZonePicker
        meta={adding}
        initial={sel.zones.find((z) => z.id === adding.id)?.zones ?? []}
        onBack={() => setAdding("network")}
        onSave={(zones) => {
          setSel({ ...sel, zones: [...sel.zones.filter((z) => z.id !== adding.id), { id: adding.id, zones }] });
          setAdding(null);
        }}
      />
    );

  return (
    <>
      <Heading>SBB travelcards</Heading>
      <Card className="overflow-hidden">
        {NATIONAL.map((n) => (
          <ToggleRow key={n.id} label={n.name} on={sel.national.includes(n.id)} onChange={(on) => setNational(n.id, on)} />
        ))}
      </Card>

      <Heading>Zone travelcards</Heading>
      <Card className="overflow-hidden">
        {sel.zones.map((z) => {
          const meta = cat?.zonePasses.find((p) => p.id === z.id);
          return (
            <div key={z.id} className="flex items-center border-b border-surface-3 last:border-b-0">
              <button onClick={() => meta && setAdding(meta)} className="min-w-0 flex-1 px-4 py-[12px] text-left">
                <span className="block text-[16px] leading-tight font-light tracking-tight">{meta?.network ?? "Zone travelcard"}</span>
                <span className="mt-1 block text-[11.5px] leading-tight font-light text-muted">
                  {z.zones.length === 1 ? "Zone" : "Zones"} {z.zones.join(" + ")}
                </span>
              </button>
              <button aria-label={`Remove ${meta?.network ?? "zone travelcard"}`} onClick={() => setSel({ ...sel, zones: sel.zones.filter((x) => x.id !== z.id) })} className="p-4 text-muted">
                <Trash2 className="size-4.5" strokeWidth={1.5} />
              </button>
            </div>
          );
        })}
        <LinkRow label="Add zone travelcard" hint="Mobilis, ZVV, Libero, unireso and 20 more networks" onClick={() => setAdding("network")} />
      </Card>

      <Heading>Regional passes</Heading>
      <Card className="overflow-hidden">
        {cat?.areaPasses.map((a) => <ToggleRow key={a.id} label={a.name} on={sel.areas.includes(a.id)} onChange={(on) => setArea(a.id, on)} />)}
      </Card>
      <Note>Prices and &ldquo;covered by your travelcard&rdquo; follow these travelcards. Zones and lines come from the NOVA tariff data on opentransportdata.swiss.</Note>
    </>
  );
}

function BackRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="-mt-1 mb-1 flex h-9 items-center gap-1 px-1 text-[14.5px] font-light text-muted">
      <ChevronLeft className="size-4.25" strokeWidth={1.5} />
      {label}
    </button>
  );
}

/** Pick the zones of one network's travelcard; searchable, as networks have up to 155 zones. */
function ZonePicker({ meta, initial, onBack, onSave }: { meta: ZonePassMeta; initial: string[]; onBack: () => void; onSave: (zones: string[]) => void }) {
  const [picked, setPicked] = useState(() => new Set(initial));
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = meta.zones.filter((z) => !needle || z.id.startsWith(needle) || z.name.toLowerCase().includes(needle));
  const toggle = (id: string) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const zones = meta.zones.map((z) => z.id).filter((id) => picked.has(id));
  return (
    <>
      <BackRow label="Fare networks" onClick={onBack} />
      <Heading>{meta.network}: your zones</Heading>
      {meta.zones.length > 8 && (
        <label className={`${INPUT} mb-2.5 flex items-center gap-2.5`}>
          <Search className="size-4.25 shrink-0 text-muted" strokeWidth={1.5} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Zone number or place" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted" />
        </label>
      )}
      <Card className="overflow-hidden">
        {shown.map((z) => (
          <button key={z.id} onClick={() => toggle(z.id)} className="flex w-full items-center gap-3 border-b border-surface-3 px-4 py-[12px] text-left last:border-b-0">
            <Checkbox checked={picked.has(z.id)} />
            <span className="w-10 shrink-0 text-[16px] font-bold tabular-nums">{z.id}</span>
            <span className="min-w-0 flex-1 truncate text-[16px] font-light tracking-tight">{z.name || `Zone ${z.id}`}</span>
          </button>
        ))}
      </Card>
      <div className="sticky bottom-0 mt-3.5 pb-1">
        <PrimaryButton disabled={!zones.length} onClick={() => onSave(zones)}>
          {zones.length ? `Save ${zones.length === 1 ? "zone" : "zones"} ${zones.join(" + ")}` : "Choose your zones"}
        </PrimaryButton>
      </div>
    </>
  );
}

const REDUCTIONS = ["No reduction", "Half Fare Travelcard", "GA Travelcard", "Junior / Children’s Co-travelcard"];

function CoPassengers() {
  const { coPassengers } = useAppState();
  const [name, setName] = useState("");
  const [birth, setBirth] = useState("");
  const [reduction, setReduction] = useState(REDUCTIONS[1]);
  const add = () => {
    if (!name.trim()) return toast("Please enter a name.");
    actions.set({ coPassengers: [...coPassengers, { id: `cp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, name: name.trim(), birthDate: birth, reduction }] });
    setName("");
    setBirth("");
    toast(`${name.trim()} added as co-passenger.`);
  };
  return (
    <>
      <Card className="overflow-hidden">
        <div className="flex items-center gap-3 border-b border-surface-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[16px] font-bold">{fullName}</p>
            <p className="text-[12.5px] font-light text-muted">You · Half Fare Travelcard</p>
          </div>
        </div>
        {coPassengers.map((p) => (
          <div key={p.id} className="flex items-center gap-3 border-b border-surface-3 py-2 pr-2 pl-4 last:border-b-0">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[16px] font-light">{p.name}</p>
              <p className="text-[12.5px] font-light text-muted">{[p.birthDate, p.reduction].filter(Boolean).join(" · ")}</p>
            </div>
            <button
              aria-label={`Remove ${p.name}`}
              onClick={() => actions.set({ coPassengers: coPassengers.filter((c) => c.id !== p.id) })}
              className="flex size-9 items-center justify-center text-fg/70"
            >
              <Trash2 className="size-4.25" strokeWidth={1.25} />
            </button>
          </div>
        ))}
      </Card>
      <Heading>Add a co-passenger</Heading>
      <div className="space-y-2">
        <input aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="First and last name" className={INPUT} />
        <input aria-label="Date of birth" type="date" value={birth} onChange={(e) => setBirth(e.target.value)} className={INPUT} />
        <select aria-label="Reduction" value={reduction} onChange={(e) => setReduction(e.target.value)} className={INPUT}>
          {REDUCTIONS.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
        <PrimaryButton onClick={add}>Add co-passenger</PrimaryButton>
      </div>
      <Note>Co-passengers can be selected when buying tickets (pencil button on the Offers screen).</Note>
    </>
  );
}

function Plates() {
  const { plates } = useAppState();
  const [plate, setPlate] = useState("");
  const add = () => {
    const p = plate.trim().toUpperCase();
    if (!p) return toast("Please enter a licence plate.");
    if (plates.includes(p)) return toast("This licence plate is already saved.");
    actions.set({ plates: [...plates, p] });
    setPlate("");
  };
  return (
    <>
      {plates.length === 0 ? (
        <p className="px-1 pb-3 text-[14.5px] font-light text-muted">No licence plates saved yet.</p>
      ) : (
        <Card className="mb-4 overflow-hidden">
          {plates.map((p) => (
            <div key={p} className="flex items-center border-b border-surface-3 py-1.5 pr-2 pl-4 last:border-b-0">
              <span className="flex-1 text-[16px] font-light tracking-wide">{p}</span>
              <button aria-label={`Remove ${p}`} onClick={() => actions.set({ plates: plates.filter((x) => x !== p) })} className="flex size-9 items-center justify-center text-fg/70">
                <Trash2 className="size-4.25" strokeWidth={1.25} />
              </button>
            </div>
          ))}
        </Card>
      )}
      <div className="space-y-2">
        <input aria-label="Licence plate" value={plate} onChange={(e) => setPlate(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="e.g. VD 123456" className={INPUT} />
        <PrimaryButton onClick={add}>Add licence plate</PrimaryButton>
      </div>
      <Note>Saved licence plates are used for P+Rail parking tickets in Tickets → Buy.</Note>
    </>
  );
}

function Wallet() {
  return (
    <>
      <Heading>Default means of payment</Heading>
      <SettingChoice
        id="payment"
        fallback="twint"
        options={[
          { value: "twint", label: "TWINT" },
          { value: "card", label: "Credit card", hint: "Demo card •••• 0000" },
          { value: "applepay", label: "Apple Pay / Google Pay" },
          { value: "invoice", label: "Monthly invoice", hint: "Billed via SwissPass" },
          { value: "reka", label: "Reka-Pay" },
        ]}
      />
      <div className="mt-4">
        <OutlineButton onClick={() => toast("Demo: adding real means of payment is not available in the prototype.")}>Add means of payment</OutlineButton>
      </div>
      <Note>Prototype only — no payment data is stored and nothing is ever charged.</Note>
    </>
  );
}

function Notifications() {
  return (
    <>
      <Card className="overflow-hidden">
        <SettingToggle id="notif.trips" fallback label="Saved trips" hint="Delays, platform changes and cancellations on your saved journeys" />
        <SettingToggle id="notif.commute" fallback label="Commuter route" hint="Service changes on your commuter route" />
        <SettingToggle id="notif.tickets" fallback label="Tickets" hint="Reminder before a ticket or travelcard expires" />
        <SettingToggle id="notif.easyride" label="EasyRide" hint="Reminder to check out" />
        <SettingToggle id="notif.news" label="Rail service information" hint="Major disruptions on the Swiss rail network" />
      </Card>
      <Note>Demo: preferences are saved on this device; no push notifications are sent.</Note>
    </>
  );
}

function Ads() {
  return (
    <>
      <Card className="overflow-hidden">
        <SettingToggle id="ads.personal" label="Personalised offers" hint="Offers based on your journeys and purchases" />
        <SettingToggle id="ads.push" label="Offers by push message" />
        <SettingToggle id="ads.mail" fallback label="Newsletter by e-mail" hint={USER.email} />
        <SettingToggle id="ads.analytics" fallback label="Usage statistics" hint="Help improve the app with anonymous usage data" />
      </Card>
    </>
  );
}

function Purchase() {
  return (
    <>
      <Heading>Preferred class</Heading>
      <SettingChoice
        id="purchase.class"
        fallback="2"
        options={[
          { value: "2", label: "2nd class" },
          { value: "1", label: "1st class" },
        ]}
      />
      <Heading>Purchase</Heading>
      <Card className="overflow-hidden">
        <SettingToggle id="purchase.quick" label="Quick purchase" hint="Buy with one tap, without the purchase overview" />
        <SettingToggle id="purchase.autosave" fallback label="Save journey automatically" hint="Add the journey to Upcoming on Plan when you buy a ticket" />
        <SettingToggle id="purchase.receipt" fallback label="Receipt by e-mail" hint={USER.email} />
        <SettingToggle id="purchase.biometric" label="Confirm with Face ID / fingerprint" />
      </Card>
    </>
  );
}

function LinkRow({ label, hint, href, onClick }: { label: string; hint?: string; href?: string; onClick?: () => void }) {
  const cls = "flex w-full items-center gap-3 border-b border-surface-3 px-4 py-[12px] text-left last:border-b-0";
  const inner = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] leading-tight font-light tracking-tight">{label}</span>
        {hint && <span className="mt-1 block text-[11.5px] leading-tight font-light text-muted">{hint}</span>}
      </span>
      <ChevronRight className="size-4.25 shrink-0 text-fg/70" strokeWidth={1.5} />
    </>
  );
  return href ? (
    <a href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer" className={cls}>
      {inner}
    </a>
  ) : (
    <button onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}

function Help() {
  const [feedback, setFeedback] = useState("");
  return (
    <>
      <Card className="overflow-hidden">
        <LinkRow label="Frequently asked questions" hint="Opens sbb.ch in the browser" href="https://www.sbb.ch/en/help-and-contact.html" />
        <LinkRow label="Call the Contact Center" hint="0848 44 66 88 (CHF 0.08/min.), 24 hours a day" href="tel:+41848446688" />
        <LinkRow label="Lost property" hint="Opens sbb.ch in the browser" href="https://www.sbb.ch/en/help-and-contact/lost-found.html" />
        <LinkRow label="Rail traffic information" hint="Opens sbb.ch in the browser" href="https://www.sbb.ch/en/timetable/railway-traffic-information.html" />
      </Card>
      <Heading>Feedback on the app</Heading>
      <textarea
        aria-label="Feedback"
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        placeholder="What can we improve?"
        rows={3}
        className="w-full rounded-[15px] bg-surface-2 px-3.5 py-2.5 text-[16px] font-light tracking-tight outline-none placeholder:text-muted"
      />
      <div className="mt-2">
        <PrimaryButton
          onClick={() => {
            if (!feedback.trim()) return toast("Please write a short message first.");
            setFeedback("");
            toast("Thank you for your feedback! (Demo: nothing was sent.)");
          }}
        >
          Send feedback
        </PrimaryButton>
      </div>
    </>
  );
}

const LEGAL: Record<string, string> = {
  "Terms of use": "This is a hackathon prototype that imitates the look and feel of a public-transport app. It is not an official product, sells no real tickets and grants no entitlement to travel. Tickets and travelcards shown in the app are fictitious.",
  "Data protection": "The prototype stores its state (demo tickets, saved trips, settings) only in your browser’s local storage. Timetable searches are sent to the open timetable APIs (opentransportdata.swiss / transport.opendata.ch). If you allow it, your position is used in the browser to find nearby stops. Use “Reset demo data” on the Profile screen to delete everything.",
  "Open-source licences": "Built with Next.js, React, Tailwind CSS, MapLibre GL JS and Lucide icons (MIT / ISC / BSD licences). Map data © OpenStreetMap contributors, map tiles © CARTO. Timetable data: Open Data Platform Mobility Switzerland.",
  Imprint: "Hackathon prototype “SBB Travelers”. Not affiliated with, or endorsed by, Swiss Federal Railways SBB.",
};

function Legal() {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <Card className="overflow-hidden">
        {Object.entries(LEGAL).map(([title, text]) => (
          <div key={title} className="border-b border-surface-3 last:border-b-0">
            <button onClick={() => setOpen(open === title ? null : title)} aria-expanded={open === title} className="flex w-full items-center px-4 py-[12px] text-left">
              <span className="flex-1 text-[16px] font-light tracking-tight">{title}</span>
              <ChevronRight className={`size-4.25 text-fg/70 transition-transform ${open === title ? "rotate-90" : ""}`} strokeWidth={1.5} />
            </button>
            {open === title && <p className="px-4 pb-3.5 text-[13.5px] leading-snug font-light text-fg/80">{text}</p>}
          </div>
        ))}
      </Card>
      <Note>Version 0.1.0 (prototype)</Note>
    </>
  );
}

function Logout({ onClose }: { onClose: () => void }) {
  return (
    <>
      <p className="px-1 text-[15px] leading-snug font-light text-fg/85">
        Do you really want to log out? Your tickets remain stored in your SwissPass account and will be available again after you log in.
      </p>
      <div className="mt-5 space-y-2.5">
        <PrimaryButton
          onClick={() => {
            actions.setSetting("loggedOut", true);
            onClose();
            toast("You have been logged out.");
          }}
        >
          Log out
        </PrimaryButton>
        <OutlineButton onClick={onClose}>Cancel</OutlineButton>
      </div>
    </>
  );
}

function ResetDemo({ onClose }: { onClose: () => void }) {
  return (
    <>
      <p className="px-1 text-[15px] leading-snug font-light text-fg/85">
        This deletes your tickets, saved trips, co-passengers, licence plates, commute, recent stops, travelcards and settings, and puts back the demo
        defaults. Your appearance setting is kept.
      </p>
      <div className="mt-5 space-y-2.5">
        <PrimaryButton
          onClick={() => {
            actions.reset();
            onClose();
            toast("Demo data reset.");
          }}
        >
          Reset demo data
        </PrimaryButton>
        <OutlineButton onClick={onClose}>Cancel</OutlineButton>
      </div>
    </>
  );
}

function Appearance() {
  const choice = useThemeChoice();
  return (
    <Card className="overflow-hidden">
      {THEME_OPTIONS.map((o) => (
        <button key={o.value} role="radio" aria-checked={o.value === choice} onClick={() => setTheme(o.value)} className="flex w-full items-center gap-3 border-b border-surface-3 px-4 py-[12px] text-left last:border-b-0">
          <Radio checked={o.value === choice} />
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] leading-tight font-light tracking-tight">{o.label}</span>
            <span className="mt-1 block text-[11.5px] leading-tight font-light text-muted">{o.hint}</span>
          </span>
        </button>
      ))}
    </Card>
  );
}

const TITLES: Record<ProfileSheet, string> = {
  appearance: "Appearance",
  personal: "Personal details",
  travelcards: "Travelcards",
  copassenger: "Co-passenger",
  plates: "Licence plates",
  wallet: "Wallet",
  notifications: "Notifications",
  ads: "Offers & Advertising",
  purchase: "Settings for ticket purchase",
  help: "Help & Contact",
  legal: "Legal",
  logout: "Log out",
  reset: "Reset demo data",
};

export function ProfileSheets({ sheet, onClose }: { sheet: ProfileSheet; onClose: () => void }) {
  return (
    <Sheet title={TITLES[sheet]} onClose={onClose} full={sheet !== "logout" && sheet !== "reset" && sheet !== "appearance"}>
      {sheet === "personal" && <PersonalDetails />}
      {sheet === "travelcards" && <Travelcards />}
      {sheet === "copassenger" && <CoPassengers />}
      {sheet === "plates" && <Plates />}
      {sheet === "wallet" && <Wallet />}
      {sheet === "notifications" && <Notifications />}
      {sheet === "ads" && <Ads />}
      {sheet === "purchase" && <Purchase />}
      {sheet === "appearance" && <Appearance />}
      {sheet === "help" && <Help />}
      {sheet === "legal" && <Legal />}
      {sheet === "logout" && <Logout onClose={onClose} />}
      {sheet === "reset" && <ResetDemo onClose={onClose} />}
    </Sheet>
  );
}
