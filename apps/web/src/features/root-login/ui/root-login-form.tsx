"use client";

import { useState, type Dispatch, type FormEvent, type JSX, type SetStateAction } from "react";

export function RootLoginForm(): JSX.Element {
  const [pending, setPending]: [boolean, Dispatch<SetStateAction<boolean>>] = useState(false);
  const [error, setError]: [string | null, Dispatch<SetStateAction<string | null>>] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending) return;
    const form: HTMLFormElement = event.currentTarget;
    const password: FormDataEntryValue | null = new FormData(form).get("password");
    if (typeof password !== "string" || !password) return;
    setPending(true);
    setError(null);
    try {
      const response: Response = await fetch("/api/auth/root/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }), cache: "no-store", signal: AbortSignal.timeout(30_000),
      });
      form.reset();
      if (response.status === 204) {
        window.location.assign("/admin");
        return;
      }
      setError(response.status === 401 ? "Invalid root credentials." : response.status === 429
        ? "Too many login attempts. Try again in one minute." : response.status === 404
          ? "Root password login is not configured." : "Root login is unavailable. Try again.");
    } catch {
      form.reset();
      setError("Root login is unavailable. Try again.");
    } finally { setPending(false); }
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-5">
      <p className="text-sm text-muted-text">Account: <span className="font-mono text-foreground">root</span></p>
      <div className="space-y-2">
        <label htmlFor="root-password" className="block text-sm font-medium">Password</label>
        <input id="root-password" name="password" type="password" autoComplete="current-password" required maxLength={1024}
          disabled={pending} aria-describedby={error ? "root-login-error" : undefined}
          className="w-full rounded-lg border border-[var(--surface-border)] bg-background px-3 py-2.5 outline-none focus:border-blue-500 disabled:opacity-50" />
      </div>
      {error && <p id="root-login-error" role="alert" className="text-sm text-red-300">{error}</p>}
      <button type="submit" disabled={pending} aria-busy={pending}
        className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">
        {pending ? "Signing in…" : "Sign in as root"}
      </button>
    </form>
  );
}
