"use client";

import { Avatar, Dropdown, Label } from "@heroui/react";
import {
  useState,
  useTransition,
  type Dispatch,
  type JSX,
  type SetStateAction,
  type TransitionStartFunction,
} from "react";
import { signOut } from "../api/sign-out";

interface UserAvatarProps {
  readonly displayName: string;
}

export function UserAvatar({ displayName }: UserAvatarProps): JSX.Element {
  const [isOpen, setIsOpen]: [boolean, Dispatch<SetStateAction<boolean>>] =
    useState<boolean>(false);
  const [errorMessage, setErrorMessage]: [
    string | null,
    Dispatch<SetStateAction<string | null>>,
  ] = useState<string | null>(null);
  const [isPending, startTransition]: [boolean, TransitionStartFunction] =
    useTransition();
  const initial: string =
    Array.from(displayName.trim())[0]?.toLocaleUpperCase() ?? "?";

  function handleSignOut(): void {
    setErrorMessage(null);

    startTransition(async (): Promise<void> => {
      try {
        const error: string | null = await signOut();
        setErrorMessage(error);
        setIsOpen(error !== null);
      } catch {
        setErrorMessage("Unable to sign out. Please try again.");
        setIsOpen(true);
      }
    });
  }

  return (
    <Dropdown isOpen={isOpen} onOpenChange={setIsOpen}>
      <Dropdown.Trigger
        aria-label={`Account menu for ${displayName}`}
        isDisabled={isPending}
        className="shrink-0 rounded-full focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-500"
      >
        <Avatar
          aria-hidden="true"
          color="accent"
          className="size-9 border border-[var(--surface-border)]"
        >
          <Avatar.Fallback className="bg-blue-600 text-sm font-semibold text-white">
            {initial}
          </Avatar.Fallback>
        </Avatar>
      </Dropdown.Trigger>
      <Dropdown.Popover
        placement="bottom end"
        className="w-56 border border-[var(--surface-border)] bg-[var(--surface)] p-1"
      >
        <div className="border-b border-[var(--surface-border)] px-3 py-2">
          <p className="text-xs text-gray-400">Signed in as</p>
          <p className="truncate text-sm font-medium text-white">{displayName}</p>
        </div>
        <Dropdown.Menu aria-label="Account actions">
          <Dropdown.Item
            id="sign-out"
            textValue="Sign out"
            variant="danger"
            isDisabled={isPending}
            shouldCloseOnSelect={false}
            onAction={handleSignOut}
          >
            <Label>{isPending ? "Signing out…" : "Sign out"}</Label>
          </Dropdown.Item>
        </Dropdown.Menu>
        {errorMessage && (
          <p role="alert" className="px-3 py-2 text-xs text-danger">
            {errorMessage}
          </p>
        )}
      </Dropdown.Popover>
    </Dropdown>
  );
}
