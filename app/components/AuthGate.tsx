"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import {
  APP_AUTH_STORAGE_KEY,
  APP_AUTH_STORAGE_VALUE,
} from "../lib/app-auth";

const DEFAULT_PASSWORD = "123456";

function getExpectedPassword(): string {
  return (
    (typeof process !== "undefined" &&
      process.env.NEXT_PUBLIC_APP_PASSWORD?.trim()) ||
    DEFAULT_PASSWORD
  );
}

type Phase = "checking" | "locked" | "unlocked";

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("checking");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    queueMicrotask(() => {
      try {
        const ok =
          window.localStorage.getItem(APP_AUTH_STORAGE_KEY) ===
          APP_AUTH_STORAGE_VALUE;
        setPhase(ok ? "unlocked" : "locked");
      } catch {
        setPhase("locked");
      }
    });
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const expected = getExpectedPassword();
    if (password !== expected) {
      setError("Mot de passe incorrect.");
      return;
    }
    try {
      window.localStorage.setItem(APP_AUTH_STORAGE_KEY, APP_AUTH_STORAGE_VALUE);
    } catch {
      setError("Impossible d'enregistrer la session.");
      return;
    }
    setPhase("unlocked");
    setPassword("");
    router.push("/commercial");
  };

  if (phase === "checking") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f8fafc] dark:bg-slate-950">
        <p className="text-sm text-slate-500 dark:text-slate-400">Chargement...</p>
      </div>
    );
  }

  if (phase === "locked") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f8fafc] p-4 dark:bg-slate-950">
        <form
          onSubmit={submit}
          className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-md dark:border-slate-600 dark:bg-slate-900"
        >
          <div className="mb-4 flex justify-center text-[#5b8dbd] dark:text-sky-400">
            <Lock size={32} strokeWidth={1.5} aria-hidden />
          </div>
          <h1 className="mb-1 text-center text-sm font-semibold uppercase tracking-wide text-slate-800 dark:text-slate-100">
            Accès sécurisé
          </h1>
          <p className="mb-4 text-center text-xs text-slate-500 dark:text-slate-400">
            Saisissez le mot de passe pour accéder au tableau de bord.
          </p>
          <label htmlFor="app-password" className="sr-only">
            Mot de passe
          </label>
          <input
            id="app-password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mb-3 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none ring-[#5b8dbd] focus:ring-2 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
            placeholder="Mot de passe"
          />
          {error ? (
            <p className="mb-3 text-center text-xs text-red-600 dark:text-red-400" role="alert">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            className="h-10 w-full rounded-md bg-[#5b8dbd] text-sm font-medium text-white transition hover:bg-[#4a7aad]"
          >
            Valider
          </button>
        </form>
      </div>
    );
  }

  return <>{children}</>;
}
