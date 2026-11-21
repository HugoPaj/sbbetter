"use client";

import { useState } from "react";
import Link from "next/link";
import { Trash2, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { Card, DESK_COL, Header, OutlineButton, PrimaryButton, Segmented, Sheet, cn, toast } from "@/components/ui";
import { LocationPicker } from "@/components/plan/location-picker";
import { EmptyState } from "@/components/scene";
import { LongArrow } from "@/components/icons";
import { useAppState, actions, type Commute } from "@/lib/store";
import { formatDate, formatTime, zurichDateTime } from "@/lib/format";
import { journeyHref } from "@/lib/journey-query";

export default function TripsPage() {
  const [tab, setTab] = useState<"single" | "commuting">("single");
  const { trips, commute, settings } = useAppState();
  const router = useRouter();
  const [setup, setSetup] = useState(false);

  /** Next connections for one direction of the commuter route, at its usual time. */
  const showCommute = (c: Commute, back: boolean) => {
    const now = zurichDateTime();
    const time = back ? c.backTime : c.outTime;
    // Usual time already passed today → look at tomorrow.
    const date = time < now.time ? zurichDateTime(new Date(Date.now() + 24 * 3600 * 1000)).date : now.date;
    router.push(
      journeyHref("/connections", {
        from: back ? c.to : c.from,
        fromName: back ? c.toName : c.fromName,
        to: back ? c.from : c.to,
        toName: back ? c.fromName : c.toName,
        date,
        time,
        isArrivalTime: false,
        transportations: [],
      }),
    );
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <Header title="Trips">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "single", label: "Single Trips" },
            { value: "commuting", label: "Commuting" },
          ]}
        />
      </Header>

      {tab === "single" &&
        (trips.length === 0 ? (
          <EmptyState
            variant="lake"
            compact
            title="No journeys saved."
            text="Would you like to receive information about your connection during your journey and also be notified of any disruptions? Save your journey in the timetable search or have it saved automatically when you purchase your ticket."
            action={<PrimaryButton href="/plan">Plan a journey</PrimaryButton>}
          />
        ) : (
          <div className={cn("space-y-[8.5px] px-[8.5px] pt-4.25 lg:pt-6", DESK_COL)}>
            {trips.map((t) => (
              <Card key={t.id} className="flex items-center gap-1.75 py-3 pr-1.75 pl-[15px] transition-colors hover:bg-[#2b2b2b] light:hover:bg-[#f5f5f5]">
                <Link href={journeyHref("/connections/detail", t.query, { key: t.id, ...t.params })} className="min-w-0 flex-1">
                  <p className="text-[16px] leading-snug font-bold">
                    <span className="inline-block">
                      {t.query.fromName} <LongArrow className="mx-1.25" />
                    </span>{" "}
                    <span className="inline-block">{t.query.toName}</span>
                  </p>
                  <p className="mt-[1.5px] text-[13px] leading-[1.4] font-light text-fg/70">
                    {formatDate(new Date(t.departure))}, {formatTime(t.departure)} – {formatTime(t.arrival)}
                    <br />
                    {t.summary}
                  </p>
                  <TripStatus scenario={settings[`sim:${t.id}`]} />
                </Link>
                <button
                  aria-label="Remove"
                  onClick={() => {
                    actions.removeTrip(t.id);
                    toast("Journey removed from your trips.");
                  }} className="flex size-9.25 shrink-0 items-center justify-center text-fg/70">
                  <Trash2 className="size-4.25" strokeWidth={1.25} />
                </button>
              </Card>
            ))}
            <div className="h-[calc(109px+var(--home-inset))]" />
          </div>
        ))}

      {tab === "commuting" &&
        (commute ? (
          <div className={cn("space-y-[8.5px] px-[8.5px] pt-4.25 lg:pt-6", DESK_COL)}>
            <Card className="px-[15px] pt-3 pb-4">
              <div className="flex items-start gap-2">
                <p className="min-w-0 flex-1 text-[16px] leading-snug font-bold">
                  <span className="inline-block">
                    {commute.fromName} <LongArrow className="mx-1.25" />
                  </span>{" "}
                  <span className="inline-block">{commute.toName}</span>
                </p>
                <button
                  aria-label="Delete commuter route"
                  onClick={() => {
                    actions.set({ commute: null });
                    toast("Commuter route deleted.");
                  }}
                  className="-mt-1 -mr-2 flex size-9.25 shrink-0 items-center justify-center text-fg/70"
                >
                  <Trash2 className="size-4.25" strokeWidth={1.25} />
                </button>
              </div>
              <p className="mt-[1.5px] text-[13px] leading-[1.4] font-light text-fg/70">
                Outward {commute.outTime} · Return {commute.backTime} · Mon–Fri
                <br />
                We’ll inform you about service changes on this route.
              </p>
              <div className="mt-3.5 space-y-2.5">
                <PrimaryButton onClick={() => showCommute(commute, false)}>Outward journey · {commute.outTime}</PrimaryButton>
                <OutlineButton onClick={() => showCommute(commute, true)}>Return journey · {commute.backTime}</OutlineButton>
                <OutlineButton onClick={() => setSetup(true)}>Edit commuter route</OutlineButton>
              </div>
            </Card>
            <div className="h-[calc(109px+var(--home-inset))]" />
          </div>
        ) : (
          <EmptyState
            variant="commute"
            top={37.5}
            title="Commuting made easy."
            text="Commuting is more relaxed than ever before – we inform you about service changes on your commuter route."
            action={<PrimaryButton onClick={() => setSetup(true)}>Let’s get started!</PrimaryButton>}
          />
        ))}
      {setup && <CommuteSetup initial={commute} onClose={() => setSetup(false)} />}
    </div>
  );
}

const TRIP_STATUS: Record<string, string> = {
  missed: "You’ll miss your change. Tap to see what to do.",
  cancelled: "Your train is cancelled. Tap to see what to do.",
};

/** One-line verdict for a saved trip with a (simulated) disruption. */
function TripStatus({ scenario }: { scenario: unknown }) {
  const status = TRIP_STATUS[String(scenario)];
  if (!status) return null;
  return (
    <p className="mt-2 flex items-center gap-1.5 text-[13px] leading-tight text-sbb-red">
      <TriangleAlert className="size-3.5 shrink-0" strokeWidth={2} />
      {status}
    </p>
  );
}

function CommuteSetup({ initial, onClose }: { initial: Commute | null; onClose: () => void }) {
  const [c, setC] = useState<Commute>(initial ?? { from: "", fromName: "", to: "", toName: "", outTime: "07:30", backTime: "17:30" });
  const [picking, setPicking] = useState<"from" | "to" | null>(null);
  const field = "flex h-[44px] w-full items-center rounded-[15px] bg-surface-2 px-3.5 text-left text-[16px] font-light tracking-tight";
  return (
    <>
      <Sheet title="Commuter route" onClose={onClose}>
        <div className="space-y-2">
          <button onClick={() => setPicking("from")} className={field}>
            <span className="w-14 shrink-0 text-muted">Home</span>
            <span className="truncate">{c.fromName || "Choose stop"}</span>
          </button>
          <button onClick={() => setPicking("to")} className={field}>
            <span className="w-14 shrink-0 text-muted">Work</span>
            <span className="truncate">{c.toName || "Choose stop"}</span>
          </button>
          <label className={field}>
            <span className="flex-1 text-muted">Outward departure</span>
            <input type="time" value={c.outTime} onChange={(e) => setC({ ...c, outTime: e.target.value })} className="bg-transparent outline-none" />
          </label>
          <label className={field}>
            <span className="flex-1 text-muted">Return departure</span>
            <input type="time" value={c.backTime} onChange={(e) => setC({ ...c, backTime: e.target.value })} className="bg-transparent outline-none" />
          </label>
        </div>
        <div className="mt-5">
          <PrimaryButton
            onClick={() => {
              if (!c.from || !c.to) return toast("Please choose your home and work stops.");
              if (!c.outTime || !c.backTime) return toast("Please set both departure times.");
              actions.set({ commute: c });
              onClose();
              toast("Commuter route saved.");
            }}
          >
            Save commuter route
          </PrimaryButton>
        </div>
      </Sheet>
      {picking && (
        <LocationPicker
          title={picking === "from" ? "Home stop" : "Work stop"}
          allowCurrent={false}
          onClose={() => setPicking(null)}
          onPick={(e) => {
            setC(picking === "from" ? { ...c, from: e.id, fromName: e.name } : { ...c, to: e.id, toName: e.name });
            setPicking(null);
          }}
        />
      )}
    </>
  );
}
