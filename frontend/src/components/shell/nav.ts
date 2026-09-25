/** In decision order: the answer first, then the pages that explain it. */
export const NAV = [
  { path: "/plan", label: "Charter plan", shipmentBar: true, duration: true },
  { path: "/vessel-port", label: "Vessel & port", shipmentBar: true, duration: false },
  { path: "/freight-outlook", label: "Freight outlook", shipmentBar: false, duration: false },
  { path: "/scenarios", label: "Scenarios", shipmentBar: true, duration: false },
  { path: "/ports", label: "Ports", shipmentBar: false, duration: false },
] as const;

/** Old addresses that still need to work. */
export const REDIRECTS: Record<string, string> = {
  "/nomination": "/vessel-port",
  // Sign-in and sign-up were replaced by the live demo.
  "/login": "/",
  "/signup": "/",
  "/verify-email": "/",
  "/forgot-password": "/",
  "/reset-password": "/",
};
