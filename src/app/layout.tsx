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
  // No pinch/double-tap zoom: the app should feel native. (Not maximumScale: on phones wider
  // than 393pt the fitted scale is above 1, so capping it would break the proportional fit.)
  // iOS Safari ignores this flag, so IOS_PWA_SCRIPT and globals.css also block the gestures.
  userScalable: false,
  viewportFit: "cover",
};

/**
 * Runs while the HTML is parsed, so the right theme is there for the first paint:
 * the stored choice ("sbb-theme", see lib/theme.ts), else the device setting.
 */
const THEME_SCRIPT = `try{var t=localStorage.getItem("sbb-theme");if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";document.documentElement.dataset.theme=t}catch(e){}`;

/**
 * Installed on an iPhone home screen, works around two WebKit bugs (iOS 26+). The page is
 * full-screen there, so instead of trusting the browser's measurements we size it from the
 * physical screen (in points; the layout viewport is fixed at 393px, so k converts pt -> CSS px):
 *  - --app-h: the screen height. 100dvh, 100% and the fixed-position frame can all end ~34pt
 *    above the home indicator, which leaves a black bar (globals.css stretches html/body to it).
 *  - --safe-top: env(safe-area-inset-top) can read 0 (or arrive late) while the status bar
 *    still covers the page, so never go below the status bar height (62pt on 402pt+ wide Dynamic
 *    Island phones, 59pt on older Dynamic Island ones, 47pt notch, 20pt home button).
 * Re-runs after load/resize because the first values iOS reports while parsing can be wrong.
 * On every iPhone (browser or installed) it also keeps the document scrolled to the top: see pin().
 * Add `?vp` to the URL to show the measured values on the device (`?vp=0` hides them again).
 */
const IOS_PWA_SCRIPT = `(function(){
var d=document.documentElement,n=navigator;
/* iOS ignores user-scalable=no; cancelling its pinch gesture events is what stops page zoom
   (MapLibre pinch-zooms its maps from touch events, so maps keep working). */
["gesturestart","gesturechange","gestureend"].forEach(function(t){document.addEventListener(t,function(e){e.preventDefault()},{passive:false})});
try{var q=location.search.match(/[?&]vp(=0)?\\b/);if(q)localStorage.setItem("sbb-vp",q[1]?"":"1")}catch(e){}
var debug=false;try{debug=localStorage.getItem("sbb-vp")==="1"}catch(e){}
var ios=/iP(hone|od|ad)/.test(n.userAgent)||(n.platform==="MacIntel"&&n.maxTouchPoints>1);
var app=n.standalone===true||matchMedia("(display-mode: standalone)").matches||matchMedia("(display-mode: fullscreen)").matches;
function typing(){var a=document.activeElement;return !!a&&(/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)||a.isContentEditable)}
/* On phones only #app-scroll scrolls; the document must stay at the top. iOS scrolls the
   document to bring a focused field above the keyboard and (iOS 26) often leaves it scrolled
   after the keyboard closes, shifting the whole app (header included) up off the screen. */
function pin(){if(innerWidth<1024&&!typing()&&(scrollY||scrollX||d.scrollTop||document.body.scrollTop)){scrollTo(0,0);d.scrollTop=0;document.body.scrollTop=0}}
if(ios){
  addEventListener("scroll",pin,{passive:true});
  document.addEventListener("focusout",function(){setTimeout(pin,0);setTimeout(pin,350)});
  if(window.visualViewport){visualViewport.addEventListener("resize",pin);visualViewport.addEventListener("scroll",pin)}
  addEventListener("pageshow",pin);
}
if(!(ios&&app)&&!debug)return;
var info={};
function fix(){
  pin();
  if(typing())return;
  var w=Math.min(screen.width,screen.height),h=Math.max(screen.width,screen.height),vw=d.clientWidth||innerWidth;
  var p=document.createElement("div");
  p.style.cssText="position:fixed;top:0;left:0;width:0;visibility:hidden;pointer-events:none;height:100dvh;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)";
  document.body.appendChild(p);var c=getComputedStyle(p),top=parseFloat(c.paddingTop)||0,bot=parseFloat(c.paddingBottom)||0,dvh=parseFloat(c.height)||0;p.remove();
  var k=vw/w,portrait=!matchMedia("(orientation: landscape)").matches;
  info={standalone:n.standalone,app:app,screen:w+"x"+h,inner:innerWidth+"x"+innerHeight,client:d.clientWidth+"x"+d.clientHeight,dvh:dvh,envTop:top,envBottom:bot,k:k.toFixed(3),portrait:portrait};
  if(ios&&app&&portrait&&w>0){
    var full=Math.round(h*k),bar=h/w>2?(w>=402?62:h>=852?59:47):20;
    d.style.setProperty("--app-h",Math.max(full,Math.round(dvh))+"px");
    d.style.setProperty("--safe-top",Math.round(Math.max(top,bar*k))+"px");
    d.dataset.iosApp="";
  }else{d.style.removeProperty("--app-h");d.style.removeProperty("--safe-top");delete d.dataset.iosApp}
  info.scrollY=scrollY;info.vvTop=window.visualViewport?Math.round(visualViewport.offsetTop):"-";info.appH=d.style.getPropertyValue("--app-h");info.safeTop=d.style.getPropertyValue("--safe-top");
  if(debug){var b=document.getElementById("vp-debug");if(!b){b=document.createElement("pre");b.id="vp-debug";b.style.cssText="position:fixed;left:8px;top:45%;z-index:99999;margin:0;padding:6px 8px;font:11px/1.35 ui-monospace,monospace;color:#0f0;background:rgba(0,0,0,.85);border-radius:6px;pointer-events:none;white-space:pre";document.body.appendChild(b)}b.textContent=JSON.stringify(info,null,1).replace(/[{}"]/g,"").trim()}
}
fix();
["DOMContentLoaded","load","pageshow","resize","orientationchange"].forEach(function(e){addEventListener(e,fix)});
if(window.visualViewport)visualViewport.addEventListener("resize",fix);
if(debug)addEventListener("scroll",function(){setTimeout(fix,50)},{passive:true});
setTimeout(fix,300);setTimeout(fix,1500);
})()`;

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
