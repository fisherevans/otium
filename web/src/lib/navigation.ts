import { useLayoutEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";

// BrowserRouter's index counts entries created inside this app, so direct links
// return to a stable parent without sending the reader to an unrelated website.
export function useBack(fallback: string) {
  const navigate = useNavigate();
  return () => {
    if ((window.history.state?.idx ?? 0) > 0) navigate(-1);
    else navigate(fallback, { replace: true });
  };
}

const positions = new Map<string, number>();

// Lists restore only after their asynchronous rows are ready to give the scroll
// container its height. Search parameters give every drill-down its own entry.
export function useListScroll(ready: boolean) {
  const { key } = useLocation();
  useLayoutEffect(() => {
    const main = document.querySelector<HTMLElement>("main.content");
    if (!main || !ready) return;
    main.scrollTop = positions.get(key) ?? 0;
    const remember = () => positions.set(key, main.scrollTop);
    main.addEventListener("scroll", remember, { passive: true });
    return () => main.removeEventListener("scroll", remember);
  }, [key, ready]);
}
