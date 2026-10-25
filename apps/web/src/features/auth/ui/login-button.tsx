import type { JSX } from "react";
import { AUTH_LOGIN_URL } from "@/shared/config";
import { GitHubIcon } from "./github-icon";

interface LoginButtonProps {
  readonly variant?: "navbar" | "card" | "hero";
  readonly className?: string;
  readonly label?: string;
}

export function LoginButton({
  variant = "navbar",
  className = "",
  label,
}: LoginButtonProps): JSX.Element {
  const baseNavbarClass: string =
    "inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--surface-border)] bg-[var(--surface)] px-3.5 text-xs font-medium text-white transition-colors hover:border-gray-500 hover:bg-[var(--surface-hover)] active:scale-[0.98]";

  const baseCardClass: string =
    "flex h-11 w-full items-center justify-center gap-2.5 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white transition-colors hover:bg-blue-500 active:scale-[0.98]";

  const baseHeroClass: string =
    "inline-flex h-11 items-center gap-2.5 rounded-lg bg-blue-600 px-6 text-sm font-medium text-white transition-colors hover:bg-blue-500 active:scale-[0.98]";

  let finalClass: string = baseNavbarClass;
  let defaultLabel: string = "Sign in";

  if (variant === "card") {
    finalClass = baseCardClass;
    defaultLabel = "Continue with GitHub";
  } else if (variant === "hero") {
    finalClass = baseHeroClass;
    defaultLabel = "Sign in with GitHub";
  }

  const combinedClass: string = className ? `${finalClass} ${className}` : finalClass;
  const buttonLabel: string = label ?? defaultLabel;

  return (
    <a
      href={AUTH_LOGIN_URL}
      className={combinedClass}
      aria-label={buttonLabel}
    >
      <GitHubIcon className="size-4 shrink-0" />
      <span>{buttonLabel}</span>
    </a>
  );
}
