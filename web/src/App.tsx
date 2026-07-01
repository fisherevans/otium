import { NavLink, Route, Routes } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import HomePage from "@/pages/HomePage";
import SessionPage from "@/pages/SessionPage";
import SourcesPage from "@/pages/SourcesPage";

export default function App() {
  const { loading, unauthenticated } = useAuth();

  if (loading) return <div className="spinner">otium…</div>;
  if (unauthenticated) {
    // The API layer already redirected to /auth/login; this is a fallback view.
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
      <header className="topbar">
        <span className="wordmark">otium</span>
        <span className="tagline">attention, on purpose</span>
      </header>

      <main className="content">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/session" element={<SessionPage />} />
          <Route path="/sources" element={<SourcesPage />} />
        </Routes>
      </main>

      <nav className="nav">
        <NavLink to="/" end className={({ isActive }) => (isActive ? "active" : "")}>
          intent
        </NavLink>
        <NavLink to="/sources" className={({ isActive }) => (isActive ? "active" : "")}>
          library
        </NavLink>
      </nav>
    </div>
  );
}
