import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "./overlay.css";

export function instantMotion() {
  return document.documentElement.dataset.presentation === "eink" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Two frames establish the offscreen style before the entrance begins, including
// overlays mounted and opened in the same React commit.
export function usePresence(open: boolean, duration = 260) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (open) setMounted(true);
    else {
      setVisible(false);
      const timeout = window.setTimeout(() => setMounted(false), instantMotion() ? 0 : duration);
      return () => window.clearTimeout(timeout);
    }
  }, [open, duration]);
  useEffect(() => {
    if (!open || !mounted) return;
    if (instantMotion()) {
      setVisible(true);
      return;
    }
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setVisible(true));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [open, mounted]);
  return { mounted, visible };
}

const focusable = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe, audio[controls], video[controls], [tabindex]:not([tabindex="-1"])';

let modalCount = 0;
let bodyOverflow = "";

type ModalEntry = { id: string; pushed: boolean; active: boolean; mounted: boolean; close: () => void };
const entries: ModalEntry[] = [];
const retired = new Set<string>();
const hasForwardEntry = new Set<string>();
let position = window.history.state?.otiumPosition ?? 0;
let traversal = -1;
let historyListening = false;
let internalPop = false;

function installModalHistory() {
  if (historyListening) return;
  historyListening = true;
  const pushState = window.history.pushState.bind(window.history);
  const replaceState = window.history.replaceState.bind(window.history);
  replaceState({ ...window.history.state, otiumPosition: position }, "");
  // Router can defer its React commit after changing history. Stamp the actual
  // mutation synchronously so an immediate Back still has an exact direction.
  window.history.pushState = (state, unused, url) => {
    const previous = window.history.state?.otiumOverlay;
    if (previous) hasForwardEntry.add(previous);
    pushState({ ...state, otiumPosition: position + 1 }, unused, url);
    position += 1;
  };
  window.history.replaceState = (state, unused, url) => {
    replaceState({ ...state, otiumPosition: position }, unused, url);
  };
  window.addEventListener("popstate", modalPopState);
}

function pushPendingEntries() {
  if (internalPop) return;
  for (const entry of entries) {
    if (!entry.active || entry.pushed) continue;
    // Preserve React Router's key, usr, and idx. Modal navigation stays on the
    // originating route and must not replace the router's own history state.
    window.history.pushState({ ...window.history.state, otiumOverlay: entry.id }, "");
    entry.pushed = true;
  }
}

function retireEntry(entry: ModalEntry) {
  entry.active = false;
  const index = entries.indexOf(entry);
  if (index >= 0) entries.splice(index, 1);
  if (entry.pushed) retired.add(entry.id);
}

function releaseEntry(entry: ModalEntry) {
  if (!entry.active) return;
  retireEntry(entry);
  if (entry.pushed && window.history.state?.otiumOverlay === entry.id && !internalPop) {
    internalPop = true;
    window.history.back();
  }
}

function modalPopState(event: PopStateEvent) {
  const target = event.state?.otiumOverlay as string | undefined;
  const destinationPosition = event.state?.otiumPosition ?? 0;
  traversal = Math.sign(destinationPosition - position) || traversal;
  position = destinationPosition;
  if (!internalPop) {
    const destination = entries.findIndex((entry) => entry.id === target);
    // A browser Back removes only entries above its destination. A multi-step
    // traversal or route change may remove several, in top-to-bottom order.
    for (const entry of entries.slice(destination + 1).reverse()) {
      if (!entry.pushed) continue;
      retireEntry(entry);
      entry.close();
    }
  }
  // A route navigation can unmount a modal after the router pushes a new entry.
  // Its buried modal entry cannot be deleted. Skip in the traversal direction
  // so Forward can still reach the route beyond the retired modals.
  if (target && retired.has(target)) {
    if (traversal < 0 || hasForwardEntry.has(target)) {
      internalPop = true;
      window.history.go(traversal);
      return;
    }
    // A closed modal at the forward boundary has no successor. Settle on its
    // route without resurrecting it or waiting forever for another popstate.
    const state = { ...event.state };
    delete state.otiumOverlay;
    window.history.replaceState(state, "");
  }
  internalPop = false;
  pushPendingEntries();
}

function useModalHistory(active: boolean, onClose: () => void) {
  const callback = useRef(onClose);
  callback.current = onClose;
  const record = useRef<ModalEntry | null>(null);
  useLayoutEffect(() => {
    if (!active) {
      if (record.current) releaseEntry(record.current);
      return;
    }
    installModalHistory();
    let entry = record.current;
    if (!entry?.active) {
      entry = { id: crypto.randomUUID(), active: true, mounted: true, pushed: false, close: () => callback.current() };
      record.current = entry;
      entries.push(entry);
    }
    entry.mounted = true;
    pushPendingEntries();
    return () => {
      entry.mounted = false;
      // StrictMode immediately mounts effects again. Defer cleanup so that
      // probe neither adds a duplicate entry nor queues an unwanted Back.
      queueMicrotask(() => { if (!entry.mounted) releaseEntry(entry); });
    };
  }, [active]);
}

// Native modal dialogs supply top-layer ordering and inertness, including nested
// sheets. History ownership lives here too, so every surface has the same Back.
export function Overlay({ label, children, onClose, active = true }: { label: string; children: ReactNode; onClose: () => void; active?: boolean }) {
  useModalHistory(active, onClose);
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (modalCount++ === 0) {
      bodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    dialog.showModal();
    const preferred = dialog.querySelector<HTMLElement>('[autofocus], input:not([disabled]), textarea:not([disabled]), select:not([disabled])');
    preferred?.focus({ preventScroll: true });
    return () => {
      dialog.close();
      if (--modalCount === 0) document.body.style.overflow = bodyOverflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(
    <dialog
      ref={ref}
      className="overlay-host"
      aria-label={label}
      onCancel={(event) => { event.preventDefault(); event.stopPropagation(); onClose(); }}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const dialog = ref.current;
        if (!dialog) return;
        const targets = Array.from(dialog.querySelectorAll<HTMLElement>(focusable)).filter((element) => element.getClientRects().length > 0 && !element.closest('[inert], [aria-hidden="true"]'));
        const first = targets[0];
        const last = targets[targets.length - 1];
        if (!first) { event.preventDefault(); dialog.focus(); }
        else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) { event.preventDefault(); first.focus(); }
      }}
    >{children}</dialog>,
    document.body,
  );
}
