import React from "react";
import ReactDOM from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { FinanceProvider } from "@/context/FinanceContext";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <TooltipProvider>
      <FinanceProvider>
        <App />
        <Toaster />
      </FinanceProvider>
    </TooltipProvider>
  </React.StrictMode>,
);
