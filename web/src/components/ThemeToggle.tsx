import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";

// #142: the always-available light/dark switch in the header. The e-ink language
// is "ink on paper"; dark mode is the same language inverted (light ink on dark
// paper), not a different look. The chosen theme is applied to
// document.documentElement.dataset.theme (an inline script in index.html applies
// the persisted value before first paint, so there's no flash) and persisted to
// localStorage under "otium-theme".

type Theme = "light" | "dark";

function current(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(current);

  // Keep in sync if another tab / the initial script set it.
  useEffect(() => {
    setTheme(current());
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("otium-theme", next);
    } catch {
      /* private mode - the in-memory dataset switch still works for the session */
    }
    // Keep the PWA status-bar color in step with the theme.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", next === "dark" ? "#141310" : "#f4f2ec");
    setTheme(next);
  }

  const dark = theme === "dark";
  return (
    <button
      className="theme-toggle"
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
    >
      {dark ? <Sun size={17} strokeWidth={1.9} aria-hidden /> : <Moon size={17} strokeWidth={1.9} aria-hidden />}
    </button>
  );
}
