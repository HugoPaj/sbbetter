"use client";

import { useState } from "react";
import { OutlineButton, PrimaryButton, Sheet, toast } from "./ui";
import { LocationPicker } from "./plan/location-picker";
import { actions, type Commute } from "@/lib/store";

/** Sheet to create or edit the commuter route (home ↔ work, usual times). */
export function CommuteSetup({ initial, onClose }: { initial: Commute | null; onClose: () => void }) {
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
          {initial && (
            <OutlineButton
              className="mt-2.5"
              onClick={() => {
                actions.set({ commute: null });
                onClose();
                toast("Commuter route deleted.");
              }}
            >
              Delete commuter route
            </OutlineButton>
          )}
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
