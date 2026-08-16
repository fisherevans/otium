import { useEffect, useState } from "react";
import { NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { BookOpen, Library, Bookmark, User } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { ThemeToggle } from "@/components/ThemeToggle";
import { lazy, Suspense } from "react";

// Dev-only layout lab (/lab). Lazily loaded so it never enters the shipped
// session bundle, and rendered OUTSIDE the app shell so it owns the whole
// viewport - it draws its own device chrome.
const LabPage = lazy(() => import("@/lab/LabPage"));
import HomePage from "@/pages/HomePage";
import SessionPage from "@/pages/SessionPage";
import CollectionsPage from "@/pages/CollectionsPage";
import ImportPage from "@/pages/ImportPage";
import InsightsPage from "@/pages/InsightsPage";
import SettingsPage from "@/pages/SettingsPage";
// --- #83 personal-history page ---
import HistoryPage from "@/pages/HistoryPage";
// --- end #83 ---
// --- #84 Model-A nav shell: Saved + You tab homes ---
import SavedPage from "@/pages/SavedPage";
import YouPage from "@/pages/YouPage";
// --- end #84 ---
import AppearancePage from "@/pages/AppearancePage";
// --- #66 topic-mgmt-pages: dedicated source/topic pages ---
import SourcePage from "@/pages/SourcePage";
import SourceArticlesPage from "@/pages/SourceArticlesPage";
import TopicPage from "@/pages/TopicPage";
// --- end #66 ---
// --- #86 sections management ---
import SectionsPage from "@/pages/SectionsPage";
// --- end #86 ---

export default function App() {
  const { loading, unauthenticated } = useAuth();
  const { pathname } = useLocation();
  const nav = useNavigate();
  const focused = pathname.startsWith("/session"); // #67: session is /session/:id, full-screen focused mode

  // #152: a 401 makes the API client auto-redirect to /auth/login (which bounces
  // through Google and usually returns signed-in). So "unauthenticated" almost always
  // means "a redirect is already in flight" - show a loading state, not a sign-in
  // button the user never has to press. Only after a few seconds (redirect stalled /
  // genuinely needs a manual click) do we reveal the button.
  const [showManualSignin, setShowManualSignin] = useState(false);
  useEffect(() => {
    if (!unauthenticated) return;
    const t = window.setTimeout(() => setShowManualSignin(true), 4000);
    return () => window.clearTimeout(t);
  }, [unauthenticated]);

  if (loading) return <div className="spinner">otium…</div>;
  if (unauthenticated) {
    return (
      <div className="center">
        <div className="spinner">signing in…</div>
        {showManualSignin && (
          <a className="btn" href="/auth/login" style={{ marginTop: 18 }}>
            Sign in
          </a>
        )}
      </div>
    );
  }

  if (pathname.startsWith("/lab")) {
    return (
      <Suspense fallback={<div className="spinner">lab…</div>}>
        <Routes>
          <Route path="/lab" element={<LabPage />} />
        </Routes>
      </Suspense>
    );
  }

  return (
    <div className={`app ${focused ? "focused" : ""}`}>
      <header className={`topbar ${focused ? "session" : ""}`}>
        {focused ? (
          <>
            <button
              className="chrome-btn left"
              onClick={() => {
                // #149: leaving a session via the header is an "end", so surface the
                // recap instead of silently navigating away. SessionPage listens and
                // opens the recap (whose own buttons then go home or resume). If
                // nothing handles it within a tick (not on a session), fall back to
                // navigating.
                let handled = false;
                window.dispatchEvent(new CustomEvent("otium:request-end", { detail: { ack: () => (handled = true) } }));
                if (!handled) nav("/");
              }}
              aria-label="Back to intent"
            >
              <span className="chrome-ic">←</span> intent
            </button>
            <span className="wordmark">otium</span>
            <span className="topbar-right">
              <ThemeToggle />
              <button className="chrome-btn right" onClick={() => nav("/sections")} aria-label="Go to library">
                library
              </button>
            </span>
          </>
        ) : (
          <>
            <span className="wordmark">otium</span>
            <span className="topbar-right">
              <span className="tagline">attention, on purpose</span>
              <ThemeToggle />
            </span>
          </>
        )}
      </header>

      {/* #150: key on pathname so <main> remounts each navigation and its entrance
          animation replays - a light cross-nav transition without a wrapper div. */}
      <main key={pathname} className={focused ? "content-session" : "content"}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/session/:id" element={<SessionPage />} /> {/* #67: durable session by id */}
          {/* --- #66 topic-mgmt-pages: dedicated source/topic pages --- */}
          <Route path="/sources/:id" element={<SourcePage />} />
          <Route path="/sources/:id/articles" element={<SourceArticlesPage />} /> {/* per-source article list */}
          <Route path="/topics/:slug" element={<TopicPage />} />
          {/* --- end #66 --- */}
          <Route path="/sections" element={<SectionsPage />} /> {/* #86: sections management */}
          {/* #84: Saved (Collections + History) and You (secondary destinations)
              are the two new tab homes. Collections/History keep their own
              routes for deep links; Saved embeds their bodies. */}
          <Route path="/saved" element={<SavedPage />} />
          <Route path="/you" element={<YouPage />} />
          <Route path="/collections" element={<CollectionsPage />} />
          <Route path="/history" element={<HistoryPage />} /> {/* #83: personal shown-vs-engaged history */}
          <Route path="/insights" element={<InsightsPage />} />
          <Route path="/settings" element={<SettingsPage />} /> {/* #68: preferences (fast-scroll check-in) */}
          <Route path="/settings/appearance" element={<AppearancePage />} /> {/* #80/#81/#82: appearance + live preview */}
          <Route path="/import" element={<ImportPage />} />
        </Routes>
      </main>

      {/* #84: four-tab Model-A shell. Session (/session/:id) is `focused`, so the
          nav is hidden there and it stays full-screen, exactly as before. */}
      {!focused && (
        <nav className="nav">
          <NavLink to="/" end className={({ isActive }) => (isActive ? "active" : "")}>
            <BookOpen size={19} strokeWidth={1.75} aria-hidden />
            <span>read</span>
          </NavLink>
          <NavLink to="/sections" className={({ isActive }) => (isActive ? "active" : "")}>
            <Library size={19} strokeWidth={1.75} aria-hidden />
            <span>library</span>
          </NavLink>
          <NavLink to="/saved" className={({ isActive }) => (isActive ? "active" : "")}>
            <Bookmark size={19} strokeWidth={1.75} aria-hidden />
            <span>saved</span>
          </NavLink>
          <NavLink to="/you" className={({ isActive }) => (isActive ? "active" : "")}>
            <User size={19} strokeWidth={1.75} aria-hidden />
            <span>you</span>
          </NavLink>
        </nav>
      )}
    </div>
  );
}
