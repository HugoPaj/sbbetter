"use client";

import { Bell, Car, History, SunMoon, CircleHelp, CircleUserRound, IdCard, Newspaper, Section, Tickets, User, Users, WalletMinimal } from "lucide-react";
import { useState } from "react";
import { Card, DESK_COL, cn, Header, ListRow, Overlap, SectionTitle, toast } from "@/components/ui";
import { USER, fullName } from "@/lib/mock-data";
import { useSetting } from "@/lib/store";
import { ProfileSheets, type ProfileSheet } from "./sheets";
import { SERVICES, ServiceSheet } from "@/components/shop";
import { showReplayPicker } from "@/components/replay";

export default function ProfilePage() {
  const [sheet, setSheet] = useState<ProfileSheet | null>(null);
  const [service, setService] = useState<string | null>(null);
  const [loggedOut, setLoggedOut] = useSetting<boolean>("loggedOut", false);
  return (
    <div>
      <Header title="Profile" extend />
      {/* The account card stays in view; the settings below scroll under it. */}
      <Overlap sticky blur className={cn(DESK_COL, "lg:static")}>
        <Card className="flex h-[72px] items-center gap-[8.5px] px-[15px]">
          <CircleUserRound className="-ml-0.5 size-[35px] shrink-0" strokeWidth={0.9} />
          <div className="min-w-0">
            <p className="truncate text-[16px] leading-5 font-bold">{loggedOut ? "Not logged in" : fullName}</p>
            <p className="truncate text-[13px] leading-4.25 font-light tracking-tight text-muted">{loggedOut ? "Log in with your SwissPass" : USER.email}</p>
          </div>
        </Card>
      </Overlap>

      <div className={cn("px-[8.5px]", DESK_COL)}>
        <SectionTitle>Profile Settings</SectionTitle>
        <Card className="overflow-hidden">
          <ListRow icon={User} label="Personal details" onClick={() => setSheet("personal")} />
          <ListRow icon={IdCard} label="Travelcards" onClick={() => setSheet("travelcards")} />
          <ListRow icon={Users} label="Co-passenger" onClick={() => setSheet("copassenger")} />
          <ListRow icon={Car} label="Licence plates" onClick={() => setSheet("plates")} />
          <ListRow icon={WalletMinimal} label="Wallet" onClick={() => setSheet("wallet")} />
        </Card>

        <SectionTitle>App settings</SectionTitle>
        <Card className="overflow-hidden">
          <ListRow icon={Bell} label="Notifications" onClick={() => setSheet("notifications")} />
          <ListRow icon={Newspaper} label="Offers & Advertising" onClick={() => setSheet("ads")} />
          <ListRow icon={Tickets} label="Settings for ticket purchase" onClick={() => setSheet("purchase")} />
          <ListRow icon={SunMoon} label="Appearance" onClick={() => setSheet("appearance")} />
        </Card>

        <SectionTitle>Services</SectionTitle>
        <Card className="overflow-hidden">
          {SERVICES.map((s) => (
            <ListRow key={s.label} icon={s.icon} label={s.label} onClick={() => setService(s.label)} />
          ))}
        </Card>

        <SectionTitle>Demo</SectionTitle>
        <Card className="overflow-hidden">
          <ListRow icon={History} label="Replay a real disruption" chevron onClick={showReplayPicker} />
        </Card>

        <SectionTitle>Help</SectionTitle>
        <Card className="overflow-hidden">
          <ListRow icon={CircleHelp} label="Help & Contact" onClick={() => setSheet("help")} />
          <ListRow icon={Section} label="Legal" onClick={() => setSheet("legal")} />
        </Card>

        <div className="mt-4.25 flex items-center gap-2.5">
          <button
            onClick={() => {
              if (!loggedOut) return setSheet("logout");
              setLoggedOut(false);
              toast("Demo: logged in again as the demo traveller (no real SwissPass login).");
            }}
            className="flex h-[32px] items-center rounded-full border border-fg/50 bg-surface px-[15px] text-[16px] font-light tracking-tight"
          >
            {loggedOut ? "Log in" : "Log out"}
          </button>
          <button
            onClick={() => setSheet("reset")}
            className="flex h-[32px] items-center rounded-full px-2.5 text-[12px] font-light text-muted">
            Reset demo data
          </button>
        </div>
        <div className="h-[calc(112px+var(--home-inset))]" />
      </div>
      {service && <ServiceSheet service={service} onClose={() => setService(null)} />}
      {sheet && <ProfileSheets sheet={sheet} onClose={() => setSheet(null)} />}
    </div>
  );
}
