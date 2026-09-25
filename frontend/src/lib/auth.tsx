import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo } from "react";
import { type Me, UNAUTHORIZED_EVENT, auth } from "../api";

/** "unavailable": the service couldn't be reached to check the session, so
 *  it isn't known whether the person is signed in. */
export type AuthStatus = "loading" | "signed-in" | "signed-out" | "unavailable";

interface AuthState {
  user: Me | null;
  status: AuthStatus;
  /** The service couldn't be reached to check the session. */
  unavailable: boolean;
  login: (email: string, password: string, remember: boolean) => Promise<Me>;
  /** Signs in to a fresh demo account: no email or password needed. */
  startDemo: () => Promise<Me>;
  logout: (to?: string) => Promise<void>;
  setUser: (user: Me | null) => void;
  retry: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => auth.session(),
    staleTime: 5 * 60_000,
    retry: false,
    // While the service is down, keep checking so the page recovers by itself.
    refetchInterval: (q) => (q.state.status === "error" ? 20_000 : false),
  });

  const setUser = useCallback((user: Me | null) => qc.setQueryData(["me"], user), [qc]);

  // Any data request that comes back 401 means the session ended elsewhere.
  useEffect(() => {
    const onUnauthorized = () => setUser(null);
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [setUser]);

  const login = useCallback(
    async (email: string, password: string, remember: boolean) => {
      const user = await auth.login(email, password, remember);
      setUser(user);
      return user;
    },
    [setUser]
  );

  const startDemo = useCallback(async () => {
    const user = await auth.demo();
    setUser(user);
    return user;
  }, [setUser]);

  const logout = useCallback(async (to = "/") => {
    try {
      await auth.logout();
    } catch {
      // Already signed out (or offline): leave anyway.
    } finally {
      // A full page load (to the landing page by default): nothing from the signed-in
      // session stays in memory, and no page briefly redirects to sign-in.
      window.location.replace(to);
    }
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user: me.data ?? null,
      status: me.isLoading ? "loading" : me.data ? "signed-in" : me.isError ? "unavailable" : "signed-out",
      unavailable: me.isError && !me.data,
      login,
      startDemo,
      logout,
      setUser,
      retry: () => void me.refetch(),
    }),
    [me, login, startDemo, logout, setUser]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
