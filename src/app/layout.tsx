import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { BottomNav, SideNav } from "@/components/bottom-nav";
import { Toaster } from "@/components/ui";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "SBBetter (prototype)",
  description: "Hackathon prototype of the SBB Mobile app",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "SBBetter" },
};

export const viewport: Viewport = {
  themeColor: "#eb0000",
  // Fixed 393pt layout viewport (the native app's reference width): phones of any
  // width scale the whole UI proportionally instead of reflowing it larger/smaller.
  width: 393,
  initialScale: undefined,
  viewportFit: "cover",
};

/**
 * Runs while the HTML is parsed, so the right theme is there for the first paint:
 * the stored choice ("sbb-theme", see lib/theme.ts), else the device setting.
 */
const THEME_SCRIPT = `try{var t=localStorage.getItem("sbb-theme");if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning className={`${inter.variable} antialiased`}>
      <body>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        {/* Phone-width column; from `lg` up it is the full-width area next to the side navigation. */}
        <div className="relative mx-auto min-h-dvh w-full max-w-[430px] bg-page shadow-2xl shadow-black lg:mx-0 lg:max-w-none lg:pl-[248px] lg:shadow-none">
          <SideNav />
          {children}
          <BottomNav />
          <Toaster />
        </div>
      </body>
    </html>
  );
}
