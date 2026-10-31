// The dashboard's entry point: sets up translation, takes the session key out of the address bar, builds the
// router, and renders the app. The order matters, and is explained on the lines below.
import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/i18n";
import { readSessionToken } from "@/api/token";
import { queryClient } from "@/queryClient";
import { App } from "./App";
import { createAppRouter } from "./router";
import "./styles.css";

// 1. Read the session key now, before the router exists. Reading it removes "#token=..." from the address
//    bar, so the router never sees it and it is never left in the history.
readSessionToken();

// 2. Only then create the router, which starts from the address as it is now.
const router = createAppRouter(queryClient);

const rootElement = document.getElementById("root");
if (rootElement === null) throw new Error("index.html has no #root element.");

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
