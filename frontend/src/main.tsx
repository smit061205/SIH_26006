import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ApiError } from "./api";
import App from "./App";
import { SharedCanvasHost } from "./components/ship3d/SharedCanvasHost";
import { TooltipProvider } from "./components/ui/overlay";
import { AuthProvider } from "./lib/auth";
import { CurrencyProvider } from "./lib/currency";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // One retry for a dropped connection or a server hiccup; none for an answer that was
      // refused (4xx) or never came (a timeout would only double the wait).
      retry: (count, error) => count < 1 && !(error instanceof ApiError && (error.timedOut || (error.status >= 400 && error.status < 500))),
      refetchOnWindowFocus: false,
      staleTime: 5 * 60_000,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <>
    {/* The one shared 3D canvas: outside StrictMode, whose development-only
        double mount would dispose the WebGL root under it. It needs none of
        the providers (3D scenes read the theme and language from stores). */}
    <SharedCanvasHost />
    <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <CurrencyProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </CurrencyProvider>
      </TooltipProvider>
    </QueryClientProvider>
    </StrictMode>
  </>
);
