"use client";

import { useState } from "react";
import Link from "next/link";
import { Trash2, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { Card, DESK_COL, Header, OutlineButton, PrimaryButton, Segmented, cn, toast } from "@/components/ui";
import { CommuteSetup } from "@/components/commute";
import { EmptyState } from "@/components/scene";
import { LongArrow } from "@/components/icons";
import { useAppState, actions, type Commute } from "@/lib/store";
import { formatDate, formatTime } from "@/lib/format";
import { commuteQuery, journeyHref } from "@/lib/journey-query";

export default function TripsPage() {
  const [tab, setTab] = useState<"single" | "commuting">("single");
  const { trips, commute, settings } = useAppState();
  const router = useRouter();
  const [setup, setSetup] = useState(false);

  const showCommute = (c: Commute, back: boolean) => router.push(journeyHref("/connections", commuteQuery(c, back)));

  return (
    <div className="flex min-h-(--app-h) flex-col">
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
            <div className="h-[calc(92px+var(--home-inset))]" />
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
            <div className="h-[calc(92px+var(--home-inset))]" />
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
