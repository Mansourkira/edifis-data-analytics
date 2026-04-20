"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChartNoAxesColumn, LayoutDashboard, LogOut, Trophy, UserCircle2 } from "lucide-react";
import ThemeToggle from "./ThemeToggle";
import { clearAppAuth } from "../lib/app-auth";

const LINKS = [
  {
    href: "/commercial",
    label: "Commercial",
    icon: LayoutDashboard,
  },

  {
    href: "/palmares-revendeurs",
    label: "Palmares Revendeurs",
    icon: Trophy,
  },
  {
    href: "/statistiques-vente",
    label: "Statistiques de Vente",
    icon: ChartNoAxesColumn,
  },
];

export default function AppNavigation({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex h-screen w-full bg-[#f8fafc] dark:bg-slate-950">
      <aside className="hidden h-screen w-[260px] shrink-0 border-r border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900 md:flex md:flex-col">
        <div className="border-b border-slate-200 px-5 py-5 dark:border-slate-700">
          <h1 className="text-sm font-semibold tracking-[0.08em] text-slate-800 uppercase dark:text-slate-100">
            DATA ANALYTICS
          </h1>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">ERP Reporting Suite</p>
        </div>
        <nav className="flex-1 px-3 py-4">
          <ul className="space-y-1">
            {LINKS.map((link) => {
              const Icon = link.icon;
              const active = pathname === link.href;
              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition ${active
                      ? "bg-[#5b8dbd] text-white"
                      : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                      }`}
                  >
                    <Icon size={16} />
                    {link.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="border-t border-slate-200 px-3 py-3 dark:border-slate-700">
          <div className="mb-2 flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2 dark:bg-slate-800/80">
            <UserCircle2 size={18} className="text-slate-500 dark:text-slate-400" />
            <div>
              <p className="text-xs font-medium text-slate-700 dark:text-slate-200">Analyste BI</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">interne@edifis.local</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              clearAppAuth();
              window.location.assign("/");
            }}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <LogOut size={16} />
            Logout
          </button>
        </div>
      </aside>

      <main className="flex min-h-screen flex-1 flex-col overflow-y-auto bg-[#f8fafc] p-6 dark:bg-slate-950">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-3">
            =            <div className="ml-auto flex items-center gap-2">
              <div className="flex flex-wrap items-center justify-end gap-2 md:hidden">
                {LINKS.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`rounded border px-2 py-1 text-xs ${pathname === link.href
                      ? "border-[#5b8dbd] bg-[#5b8dbd] text-white"
                      : "border-slate-300 text-slate-700 dark:border-slate-600 dark:text-slate-200"
                      }`}
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
              <ThemeToggle />
            </div>
          </div>
        </header>
        <div className="mt-4 flex-1">{children}</div>
      </main>
    </div>
  );
}
