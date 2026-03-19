import type { ReactNode } from "react";

import Navbar from "./Navbar";

export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-ui-bg text-ui-text">
      <Navbar />

      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 py-8">
        <div className="grid gap-8 lg:grid-cols-[1fr_280px]">
          <main>{children}</main>

          <aside className="hidden lg:block">
            <div className="ui-surface p-4">
              <div className="text-sm font-semibold">Coming soon</div>
              <div className="mt-1 text-xs text-ui-muted">
                Sidebar for future scaling (filters, saved lists, notes, etc.).
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

