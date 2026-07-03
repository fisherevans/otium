import { NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import HomePage from "@/pages/HomePage";
import SessionPage from "@/pages/SessionPage";
import SourcesPage from "@/pages/SourcesPage";
import ImportPage from "@/pages/ImportPage";

export default function App() {
  const { loading, unauthenticated } = useAuth();
  const { pathname } = useLocation();
  const nav = useNavigate();
  const focused = pathname === "/session"; // session is a full-screen focused mode

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
          <Route path="/session" element={<SessionPage />} />
          <Route path="/sources" element={<SourcesPage />} />
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
