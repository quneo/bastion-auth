import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { api, type Me } from "./api";

type AuthState = {
  loading: boolean;
  me: Me | null;
  setupRequired: boolean;
  refresh: () => Promise<Me | null>;
};

const AuthContext = createContext<AuthState>({
  loading: true,
  me: null,
  setupRequired: false,
  refresh: async () => null,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<Me | null>(null);
  const [setupRequired, setSetupRequired] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const state = await api.get<{ setup_required: boolean; user: unknown }>("/api/auth/state");
      setSetupRequired(state.setup_required);
      const next = state.user ? await api.get<Me>("/api/me") : null;
      setMe(next);
      return next;
    } catch {
      setMe(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return <AuthContext.Provider value={{ loading, me, setupRequired, refresh }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

export function RequireUser({ admin, children }: { admin?: boolean; children: ReactNode }) {
  const { loading, me, setupRequired } = useAuth();
  const location = useLocation();
  if (loading) return null;
  if (setupRequired) return <Navigate to="/setup" replace />;
  if (!me) {
    const returnTo = location.pathname + location.search;
    return <Navigate to={returnTo === "/" ? "/login" : `/login?return_to=${encodeURIComponent(returnTo)}`} replace />;
  }
  if (admin && !me.is_admin) return <Navigate to="/" replace />;
  return <>{children}</>;
}
