"use client";

import { Bell, Car, CircleHelp, CircleUserRound, Newspaper, Section, Tickets, User, Users, WalletMinimal } from "lucide-react";
import { useState } from "react";
import { Card, Header, ListRow, Overlap, SectionTitle, toast } from "@/components/ui";
import { USER, fullName } from "@/lib/mock-data";
import { actions, useSetting } from "@/lib/store";
import { ProfileSheets, type ProfileSheet } from "./sheets";

export default function ProfilePage() {
  const [sheet, setSheet] = useState<ProfileSheet | null>(null);
  const [loggedOut, setLoggedOut] = useSetting<boolean>("loggedOut", false);
  return (
    <div>
      <Header title="Profile" extend />
      <Overlap>
        <Card className="flex h-[72px] items-center gap-[8.5px] px-[15px]">
          <CircleUserRound className="-ml-0.5 size-[35px] shrink-0" strokeWidth={0.9} />
          <div className="min-w-0">
            <p className="truncate text-[16px] leading-5 font-bold">{loggedOut ? "Not logged in" : fullName}</p>
            <p className="truncate text-[13px] leading-4.25 font-light tracking-tight text-muted">{loggedOut ? "Log in with your SwissPass" : USER.email}</p>
          </div>
        </Card>

        <SectionTitle>Profile Settings</SectionTitle>
        <Card className="overflow-hidden">
          <ListRow icon={User} label="Personal details" onClick={() => setSheet("personal")} />
          <ListRow icon={Users} label="Co-passenger" onClick={() => setSheet("copassenger")} />
          <ListRow icon={Car} label="Licence plates" onClick={() => setSheet("plates")} />
          <ListRow icon={WalletMinimal} label="Wallet" onClick={() => setSheet("wallet")} />
        </Card>

        <SectionTitle>App settings</SectionTitle>
        <Card className="overflow-hidden">
          <ListRow icon={Bell} label="Notifications" onClick={() => setSheet("notifications")} />
          <ListRow icon={Newspaper} label="Offers & Advertising" onClick={() => setSheet("ads")} />
          <ListRow icon={Tickets} label="Settings for ticket purchase" onClick={() => setSheet("purchase")} />
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
            className="flex h-[32px] items-center rounded-full border border-white/50 bg-surface px-[15px] text-[16px] font-light tracking-tight"
          >
            {loggedOut ? "Log in" : "Log out"}
          </button>
          <button
            onClick={() => {
              actions.reset();
              toast("Demo data reset: tickets, trips and settings restored.");
            }} className="flex h-[32px] items-center rounded-full px-2.5 text-[12px] font-light text-muted">
            Reset demo data
          </button>
        </div>
        <div className="h-[calc(109px+var(--home-inset))]" />
      </Overlap>
      {sheet && <ProfileSheets sheet={sheet} onClose={() => setSheet(null)} />}
    </div>
  );
}
