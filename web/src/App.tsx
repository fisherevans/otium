import { NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { BookOpen, Library, Bookmark, User } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import HomePage from "@/pages/HomePage";
import SessionPage from "@/pages/SessionPage";
import SourcesPage from "@/pages/SourcesPage";
import CollectionsPage from "@/pages/CollectionsPage";
import ImportPage from "@/pages/ImportPage";
import MixPage from "@/pages/MixPage";
import SettingsPage from "@/pages/SettingsPage";
// --- #83 personal-history page ---
import HistoryPage from "@/pages/HistoryPage";
// --- end #83 ---
// --- #84 Model-A nav shell: Saved + You tab homes ---
import SavedPage from "@/pages/SavedPage";
import YouPage from "@/pages/YouPage";
// --- end #84 ---
import AppearancePage from "@/pages/AppearancePage";
// --- #66 feed-mgmt-pages: dedicated source/feed pages ---
import SourcePage from "@/pages/SourcePage";
import FeedPage from "@/pages/FeedPage";
// --- end #66 ---
// --- #86 groups management ---
import GroupsPage from "@/pages/GroupsPage";
// --- end #86 ---

export default function App() {
  const { loading, unauthenticated } = useAuth();
  const { pathname } = useLocation();
  const nav = useNavigate();
  const focused = pathname.startsWith("/session"); // #67: session is /session/:id, full-screen focused mode

  if (loading) return <div className="spinner">otium…</div>;
  if (unauthenticated) {
    return (
      <div className="center">
        <p className="display">Sign in to continue</p>
        <a className="btn" href="/auth/login">
          Continue to sign in
        </a>
      </div>
    );
  }

  return (
    <div className={`app ${focused ? "focused" : ""}`}>
      <header className={`topbar ${focused ? "session" : ""}`}>
        {focused ? (
          <>
            <button className="chrome-btn left" onClick={() => nav("/")} aria-label="Back to intent">
              <span className="chrome-ic">←</span> intent
            </button>
            <span className="wordmark">otium</span>
            <button className="chrome-btn right" onClick={() => nav("/sources")} aria-label="Go to library">
              library
            </button>
          </>
        ) : (
          <>
            <span className="wordmark">otium</span>
            <span className="tagline">attention, on purpose</span>
          </>
        )}
      </header>

      <main className={focused ? "content-session" : "content"}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/session/:id" element={<SessionPage />} /> {/* #67: durable session by id */}
          <Route path="/sources" element={<SourcesPage />} />
          {/* --- #66 feed-mgmt-pages: dedicated source/feed pages --- */}
          <Route path="/sources/:id" element={<SourcePage />} />
          <Route path="/feeds/:slug" element={<FeedPage />} />
          {/* --- end #66 --- */}
          <Route path="/groups" element={<GroupsPage />} /> {/* #86: groups management */}
          {/* #84: Saved (Collections + History) and You (secondary destinations)
              are the two new tab homes. Collections/History keep their own
              routes for deep links; Saved embeds their bodies. */}
          <Route path="/saved" element={<SavedPage />} />
          <Route path="/you" element={<YouPage />} />
          <Route path="/collections" element={<CollectionsPage />} />
          <Route path="/history" element={<HistoryPage />} /> {/* #83: personal shown-vs-engaged history */}
          <Route path="/mix" element={<MixPage />} />
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
          <NavLink to="/sources" className={({ isActive }) => (isActive ? "active" : "")}>
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
