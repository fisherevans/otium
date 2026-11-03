import { useEffect, useState } from "react";
import { api, type ShareStatus } from "@/api/client";

// Whether Discord sharing (#195) is configured on this server. Asked once per
// page load and shared by every caller; a failure reads as unavailable, so the
// Send row simply doesn't appear.
let pending: Promise<ShareStatus> | null = null;

export function shareStatus(): Promise<ShareStatus> {
  if (!pending) pending = api.shareStatus().catch(() => ({ available: false }));
  return pending;
}

export function useShareAvailable(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let live = true;
    shareStatus().then((s) => { if (live) setOn(s.available); });
    return () => { live = false; };
  }, []);
  return on;
}
