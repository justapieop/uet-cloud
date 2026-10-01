import { GreetingForm } from "@/features/greet";

export function HomePage() {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-2xl flex-col justify-center px-6 py-16 sm:px-10">
      <header className="mb-12 flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-lg bg-foreground text-sm font-semibold text-background" aria-hidden="true">
          k
        </span>
        <span className="text-lg font-semibold tracking-tight">kumo</span>
      </header>

      <section aria-labelledby="welcome-heading">
        <h1 id="welcome-heading" className="text-5xl font-semibold tracking-tight sm:text-6xl">
          Hello, world.
        </h1>
        <p className="mt-5 max-w-md text-lg leading-relaxed text-muted">
          Every great application starts somewhere. This is our first hello.
        </p>
        <div className="mt-10 max-w-md">
          <GreetingForm />
        </div>
      </section>

      <footer className="mt-16 border-t border-separator pt-5 text-sm text-muted">
        Kumo · An Azure-integrated deployment platform
      </footer>
    </main>
  );
}
