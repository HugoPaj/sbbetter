import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { BottomNav } from "@/components/bottom-nav";
import { Toaster } from "@/components/ui";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "SBB Mobile (prototype)",
  description: "Hackathon prototype of the SBB Mobile app",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "SBB" },
};

export const viewport: Viewport = {
  themeColor: "#eb0000",
  // Fixed 393pt layout viewport (the native app's reference width): phones of any
  // width scale the whole UI proportionally instead of reflowing it larger/smaller.
  width: 393,
  initialScale: undefined,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} antialiased`}>
      <body>
        {/* Phone-width column; on desktop it's centred like a device. */}
        <div className="relative mx-auto min-h-dvh w-full max-w-[430px] bg-black shadow-2xl shadow-black">
          {children}
          <BottomNav />
          <Toaster />
        </div>
      </body>
    </html>
  );
}
