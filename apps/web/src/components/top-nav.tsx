"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_LINKS = [
  { href: "/", label: "Overview" },
  { href: "/studio", label: "Sessions" },
];

export function TopNav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 mx-auto w-full max-w-[1700px] px-6 py-4 sm:px-10 lg:px-16">
      <div className="glass-card flex items-center justify-between gap-4 rounded-full px-4 py-3 sm:px-6">
        <div className="flex items-center gap-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-full border border-stone-300 bg-stone-100 text-sm font-semibold tracking-[0.2em] text-stone-900">
            CM
          </div>
          <div>
            <Link href="/" className="text-sm font-semibold tracking-[0.28em] text-stone-900 uppercase">
              Codex Music
            </Link>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.22em] text-stone-500">
              AI-native music editing studio
            </p>
          </div>
        </div>

        <nav className="hidden items-center gap-2 md:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                pathname === link.href || (link.href === "/studio" && pathname?.startsWith("/studio"))
                  ? "border-stone-300 bg-stone-100 text-stone-900"
                  : "border-transparent text-stone-700 hover:border-stone-300 hover:bg-stone-100"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <Link
          href="/studio"
          className="rounded-full bg-stone-950 px-5 py-2.5 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
        >
          Open Workspace
        </Link>
      </div>
    </header>
  );
}
