import { NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import HomePage from "@/pages/HomePage";
import SessionPage from "@/pages/SessionPage";
import SourcesPage from "@/pages/SourcesPage";
import CollectionsPage from "@/pages/CollectionsPage";
import ImportPage from "@/pages/ImportPage";
import MixPage from "@/pages/MixPage";
import SettingsPage from "@/pages/SettingsPage";
// --- #66 feed-mgmt-pages: dedicated source/feed pages ---
import SourcePage from "@/pages/SourcePage";
import FeedPage from "@/pages/FeedPage";
// --- end #66 ---

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
    <div className="app">
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
          <Route path="/collections" element={<CollectionsPage />} />
          <Route path="/mix" element={<MixPage />} />
          <Route path="/settings" element={<SettingsPage />} /> {/* #68: preferences (fast-scroll check-in) */}
          <Route path="/import" element={<ImportPage />} />
        </Routes>
      </main>

      {!focused && (
        <nav className="nav">
          <NavLink to="/" end className={({ isActive }) => (isActive ? "active" : "")}>
            intent
          </NavLink>
          <NavLink to="/sources" className={({ isActive }) => (isActive ? "active" : "")}>
            library
          </NavLink>
        </nav>
      )}
    </div>
  );
}
