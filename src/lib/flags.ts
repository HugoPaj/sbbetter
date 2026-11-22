/**
 * Hackathon demo mode (on unless NEXT_PUBLIC_DEMO_TICKETS=0): "Buy" buys the ticket right here,
 * with a demo QR code, instead of handing over to the real SBB app.
 *
 * Turn it off after the hackathon (NEXT_PUBLIC_DEMO_TICKETS=0): purchases then open SBB Mobile,
 * the app asks "Did you buy it?" on return (components/purchase-return.tsx), and those tickets
 * point to the SBB app instead of showing a code. Read at build time (NEXT_PUBLIC_), so rebuild.
 */
export const DEMO_TICKETS = process.env.NEXT_PUBLIC_DEMO_TICKETS !== "0";
