"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid } from "lucide-react";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/extract", label: "Extract" },
  { href: "/history", label: "History" },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function Navbar() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-ui-border bg-ui-bg/80 backdrop-blur">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <div className="flex h-16 items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-ui-primary text-white font-semibold">
              <LayoutGrid size={16} />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold">LeadExtractor</div>
              <div className="text-xs text-ui-muted">Lead extraction dashboard</div>
            </div>
          </div>

          <nav className="hidden items-center gap-5 text-sm text-ui-muted sm:flex" aria-label="Primary">
            {NAV_ITEMS.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={[
                    "transition-colors",
                    active ? "text-ui-text font-semibold" : "hover:text-ui-text",
                  ].join(" ")}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="sm:hidden">
            <details>
              <summary className="cursor-pointer select-none text-sm text-ui-muted hover:text-ui-text font-semibold">
                Menu
              </summary>
              <div className="mt-3 rounded-xl border border-ui-border bg-ui-surface p-3 shadow-sm">
                <div className="flex flex-col gap-2">
                  {NAV_ITEMS.map((item) => {
                    const active = isActive(pathname, item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={[
                          "text-sm transition-colors",
                          active ? "text-ui-text font-semibold" : "text-ui-muted hover:text-ui-text",
                        ].join(" ")}
                      >
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            </details>
          </div>
        </div>
      </div>
    </header>
  );
}

