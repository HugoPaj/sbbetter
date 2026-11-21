import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { BottomNav, SideNav } from "@/components/bottom-nav";
import { Toaster } from "@/components/ui";
import { ServiceWorker } from "@/components/service-worker";
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

/**
 * Installed on an iPhone home screen (`navigator.standalone`), works around two WebKit bugs
 * (see `--chin` / `--safe-top` in globals.css):
 *  - 100dvh ends above the home indicator, leaving a black bar: measure the shortfall against
 *    the physical screen (capped at the home-indicator inset) and publish it as --chin.
 *  - env(safe-area-inset-top) reads 0 under the frosted status bar: fall back to the status
 *    bar height (59pt Dynamic Island, 47pt notch).
 * Screen sizes are in points; the layout viewport is fixed at 393px, so k converts pt -> CSS px.
 */
const IOS_PWA_SCRIPT = `(function(){if(navigator.standalone!==true)return;var d=document.documentElement;function fix(){var a=document.activeElement;if(a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))return;var w=Math.min(screen.width,screen.height),h=Math.max(screen.width,screen.height);if(innerWidth>innerHeight)return;var k=innerWidth/w,p=document.createElement("div");p.style.cssText="position:fixed;top:0;left:0;width:0;visibility:hidden;pointer-events:none;height:100dvh;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)";document.body.appendChild(p);var c=getComputedStyle(p),top=parseFloat(c.paddingTop)||0,bot=parseFloat(c.paddingBottom)||0,dvh=parseFloat(c.height)||0;p.remove();var chin=Math.round(Math.min(h*k-dvh,Math.max(bot,34*k)));if(chin>1){d.style.setProperty("--chin",chin+"px");d.dataset.chin=""}else{d.style.removeProperty("--chin");delete d.dataset.chin}if(top<1&&h/w>2)d.style.setProperty("--safe-top",Math.round((h>=852?59:47)*k)+"px");else d.style.removeProperty("--safe-top")}fix();addEventListener("resize",fix);addEventListener("pageshow",fix)})()`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning className={`${inter.variable} antialiased`}>
      <body>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: IOS_PWA_SCRIPT }} />
        {/* Phone-width column; from `lg` up it is the full-width area next to the side navigation.
            On phones it is the scroll container (exactly one screen tall) so the document itself never scrolls or bounces. */}
        <div id="app-scroll" className="relative mx-auto h-(--app-h) w-full max-w-[430px] overflow-y-auto overscroll-none no-scrollbar lg:h-auto lg:min-h-dvh lg:overflow-visible bg-page shadow-2xl shadow-black light:shadow-black/25 lg:mx-0 lg:max-w-none lg:pl-[248px] lg:shadow-none">
          <SideNav />
          {children}
          <BottomNav />
          <Toaster />
        </div>
        <ServiceWorker />
      </body>
    </html>
  );
}
