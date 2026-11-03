import { syncSessionPresets } from "@/lib/presetSync";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, Unauthorized, type Me } from "@/api/client";

interface AuthState {
  user: Me | null;
  loading: boolean;
  unauthenticated: boolean;
}

const AuthContext = createContext<AuthState>({ user: null, loading: true, unauthenticated: false });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, loading: true, unauthenticated: false });

  useEffect(() => {
    api
      .me()
      .then((user) => {
        setState({ user, loading: false, unauthenticated: false });
        // #203: pull saved presets and mixes from the server (agents may have changed them).
        syncSessionPresets(user.id).catch(() => {});
      })
      .catch((err) => {
        if (err instanceof Unauthorized) {
          setState({ user: null, loading: false, unauthenticated: true });
        } else {
          setState({ user: null, loading: false, unauthenticated: false });
        }
      });
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
