// What the dashboard knows about its connection to Jobgoblin, as one value every screen can read.
// The live updates stream (events.ts) is always open, so it is the first to notice when Jobgoblin goes:
//   connected  nothing is known to be wrong (also the state before the first connection)
//   lost       Jobgoblin cannot be reached; the stream keeps trying and this clears when it answers
//   old-token  Jobgoblin refused this page's key, which happens to a browser tab opened before a restart;
//              only opening the new address helps, so this never clears by itself
// App.tsx provides the value (from useLiveUpdates) and ConnectionBanner shows it.
// Spec: ARCHITECTURE.md section 12.
import { createContext, useContext } from "react";

export type ConnectionState = "connected" | "lost" | "old-token";

export const ConnectionContext = createContext<ConnectionState>("connected");

export function useConnectionState(): ConnectionState {
  return useContext(ConnectionContext);
}
