import { useEffect, useState } from "react";
import { Link, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { BookOpen, Library, Bookmark, User, MoreHorizontal, ArrowLeft, ChevronRight, ChevronDown, Play } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/api/client";
import { Brand } from "@/components/Brand";
import { useBack } from "@/lib/navigation";
import { ThemeToggle } from "@/components/ThemeToggle";
import { BottomSheet } from "@/components/BottomSheet";
import { ContextInstrument, InstrumentProvider, useInstrumentConfig } from "@/components/ContextInstrument";
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
import SuggestionsPage from "@/pages/SuggestionsPage";
import SharingPage from "@/pages/SharingPage";
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
  return <InstrumentProvider><AppShell /></InstrumentProvider>;
}

function AppShell() {
  const { loading, unauthenticated } = useAuth();
  const location = useLocation();
  const { pathname } = location;
  const nav = useNavigate();
  const override = useInstrumentConfig();
  const [menu, setMenu] = useState(false);
  // #189/#208: full-screen Shorts hide this header; the session controls (and
  // through them, this menu) open from the session button in the clip bar.
  useEffect(() => {
    const open = () => setMenu(true);
    window.addEventListener("otium:app-menu", open);
    return () => window.removeEventListener("otium:app-menu", open);
  }, []);
  const [typeMenu, setTypeMenu] = useState(false);
  const [resumeId, setResumeId] = useState<string | null>(null);
  useEffect(() => {
    if (loading || unauthenticated || pathname.startsWith("/session")) return;
    let live = true;
    api.currentSession().then(session => { if (live) setResumeId(session?.session_id || null); }).catch(() => {});
    return () => { live = false; };
  }, [pathname, menu, loading, unauthenticated]);
  useEffect(() => { setMenu(false); setTypeMenu(false); }, [pathname]);
  const pageName = pathname === "/" ? "New session" : pathname.startsWith("/settings/appearance") ? "Appearance" : pathname.startsWith("/settings") ? "Settings" : pathname.startsWith("/import") ? "Import" : pathname.startsWith("/suggestions") ? "Suggestions" : pathname.startsWith("/insights") ? "Insights" : pathname.startsWith("/you") ? "Your Otium" : /^\/(saved|collections)/.test(pathname) ? "Saved" : pathname.startsWith("/history") ? "History" : "Library";
  const parent = pathname.endsWith("/articles") ? pathname.replace(/\/articles$/, "") : /^\/(sources|topics)\//.test(pathname) || pathname === "/import" || pathname === "/suggestions" ? "/sections" : pathname.startsWith("/settings") || pathname === "/insights" || pathname === "/history" ? "/you" : "/";
  const back = useBack((location.state as { returnTo?: string } | null)?.returnTo || parent);
  const go = (path: string) => { setMenu(false); setTypeMenu(false); nav(path, { state: { returnTo: pathname + location.search + location.hash } }); };
  const focused = pathname.startsWith("/session"); // #67: session is /session/:id, full-screen focused mode
  // #206: a session has no bottom pill. What it carried moves into this bar,
  // published by SessionPage through the instrument context. #208: the time
  // phrase opens the session controls (onLabel), and the ··· opens actions for
  // the item on screen (onMenu) - two menus, each about one thing.
  const sessionStatus = focused ? override?.label || "" : "";
  const sessionMenu = focused ? override?.onMenu : undefined;
  const sessionControls = focused ? override?.onLabel : undefined;

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

  if (loading || unauthenticated) {
    return (
      <main className="entry-screen">
        <Brand />
        <h1 role="status">{loading ? "Loading" : "Signing in"}</h1>
        {!loading && showManualSignin && <a className="btn" href="/auth/login">Sign in</a>}
      </main>
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
        <Link to="/" aria-label="Otium home"><Brand /></Link>
        {sessionStatus && (sessionControls
          ? <button className="topbar-status" onClick={sessionControls} aria-label={`Session: ${sessionStatus}, open session controls`}>
              <span className="topbar-status-text">{sessionStatus}</span><ChevronDown size={14} aria-hidden />
            </button>
          : <span className="topbar-status">{sessionStatus}</span>)}
        <span className="topbar-right">
          {focused && <button className="shell-icon" onClick={() => go("/sections")} aria-label="Library"><Library size={21} /></button>}
          {/* A live session's ··· is the item's; with no item on screen (the end of
              the queue) it is absent, not repurposed. Loading, error and review
              screens keep the app menu. */}
          {sessionMenu
            ? <button className="shell-icon" onClick={sessionMenu} aria-label={override?.menuLabel || "Actions for this item"}><MoreHorizontal size={23} /></button>
            : !sessionControls && <button className="shell-icon" onClick={() => setMenu(true)} aria-label="App menu"><MoreHorizontal size={23} /></button>}
          <button className="font-button" onClick={() => setTypeMenu(true)} aria-label="Type and appearance">Aa</button>
        </span>
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
          <Route path="/settings/sharing" element={<SharingPage />} /> {/* #195: Discord friends and channels */}
          <Route path="/settings/appearance" element={<AppearancePage />} /> {/* #80/#81/#82: appearance + live preview */}
          <Route path="/suggestions" element={<SuggestionsPage />} /> {/* #202: follow recommendations */}
          <Route path="/import" element={<ImportPage />} />
        </Routes>
      </main>

      {!focused && <ContextInstrument {...(override || {
        eyebrow: pageName, label: pathname === "/" ? "Choose a session" : pageName,
        onMenu: () => setMenu(true), menuLabel: "App menu",
        onLabel: () => setMenu(true),
        action: { label: pathname === "/" ? "Library" : "Back", onClick: () => pathname === "/" ? go("/sections") : back(), icon: pathname === "/" ? <Library size={18} /> : <ArrowLeft size={18} /> },
      })} />}
      <BottomSheet open={menu} onClose={() => setMenu(false)} kicker={sessionStatus ? `Session · ${sessionStatus}` : "Otium"}>
        <div className="shell-menu">
          {!focused && resumeId && <button onClick={() => go(`/session/${resumeId}`)}><Play size={21}/><span>Return to session</span><ChevronRight size={18}/></button>}
          {[["/", "New session", BookOpen], ["/sections", "Library", Library], ["/saved", "Saved", Bookmark], ["/you", "Your Otium", User]].map(([path, label, Glyph]) => {
            const Icon = Glyph as typeof BookOpen;
            return <button key={String(path)} onClick={() => go(String(path))}><Icon size={21} /><span>{String(label)}</span><ChevronRight size={18} /></button>;
          })}
          {/* #186: full-screen Shorts hide the header's Aa; it lives here too. */}
          {focused && <button onClick={() => { setMenu(false); setTypeMenu(true); }}><span className="font-button">Aa</span><span>Type and appearance</span><ChevronRight size={18} /></button>}
          {focused && sessionStatus && sessionStatus !== "Session complete" && <button onClick={() => { setMenu(false); window.dispatchEvent(new CustomEvent("otium:request-end", { detail: { ack: () => {} } })); }}><ArrowLeft size={21} /><span>End session</span></button>}
        </div>
      </BottomSheet>
      <BottomSheet open={typeMenu} onClose={() => setTypeMenu(false)} kicker="Type and appearance">
        <div className="shell-menu">
          <button onClick={() => go("/settings/appearance")}><span className="font-button">Aa</span><span>Reading and appearance</span><ChevronRight size={18} /></button>
          <div className="shell-theme"><span>Light / dark</span><ThemeToggle /></div>
        </div>
      </BottomSheet>
    </div>
  );
}
