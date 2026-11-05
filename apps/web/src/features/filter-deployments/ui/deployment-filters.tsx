"use client";

import { Button, Input, Label, ListBox, Select, TextField, type Key } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type Dispatch, type FormEvent, type JSX, type MutableRefObject, type SetStateAction, type TransitionStartFunction } from "react";
import { DEPLOYMENT_STATUSES, type DeploymentFilters as Filters } from "@/entities/deployment";

export interface DeploymentFiltersProps {
  readonly filters: Filters;
  readonly clearable?: boolean;
  readonly hasTransient?: boolean;
}

export function DeploymentFilters({ filters, clearable = false, hasTransient = false }: DeploymentFiltersProps): JSX.Element {
  const router: ReturnType<typeof useRouter> = useRouter();
  const [status, setStatus]: [string, Dispatch<SetStateAction<string>>] = useState<string>(filters.status ?? "all");
  const [name, setName]: [string, Dispatch<SetStateAction<string>>] = useState<string>(filters.name ?? "");
  const [region, setRegion]: [string, Dispatch<SetStateAction<string>>] = useState<string>(filters.region ?? "");
  const [pending, startTransition]: [boolean, TransitionStartFunction] = useTransition();
  const [isRefreshing, startRefreshTransition]: [boolean, TransitionStartFunction] = useTransition();
  const [timeoutWarning, setTimeoutWarning]: [boolean, Dispatch<SetStateAction<boolean>>] = useState<boolean>(false);
  const transientStartTimeRef: MutableRefObject<number | null> = useRef<number | null>(null);
  const pollTimerRef: MutableRefObject<NodeJS.Timeout | null> = useRef<NodeJS.Timeout | null>(null);
  const hasFilters: boolean = clearable || Boolean(name || region || status !== "all");
  const fieldClass: string = "h-10 min-h-10 rounded-lg border border-[var(--surface-border)] bg-background shadow-none";

  useEffect((): (() => void) => {
    if (!hasTransient) {
      transientStartTimeRef.current = null;
      setTimeoutWarning(false);
      if (pollTimerRef.current !== null) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return (): void => {};
    }

    if (transientStartTimeRef.current === null) {
      transientStartTimeRef.current = Date.now();
    }

    const elapsedMs: number = Date.now() - transientStartTimeRef.current;
    if (elapsedMs >= 300_000) {
      setTimeoutWarning(true);
      if (pollTimerRef.current !== null) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return (): void => {};
    }

    if (isRefreshing || pending) {
      return (): void => {};
    }

    pollTimerRef.current = setTimeout((): void => {
      if (document.hidden) {
        return;
      }
      startRefreshTransition((): void => {
        router.refresh();
      });
    }, 3500);

    return (): void => {
      if (pollTimerRef.current !== null) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [hasTransient, isRefreshing, pending, router]);

  useEffect((): (() => void) => {
    function handleVisibilityChange(): void {
      if (!document.hidden && hasTransient && !isRefreshing && !pending && !timeoutWarning) {
        startRefreshTransition((): void => {
          router.refresh();
        });
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return (): void => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [hasTransient, isRefreshing, pending, timeoutWarning, router]);

  function handleRefresh(): void {
    if (pollTimerRef.current !== null) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    setTimeoutWarning(false);
    transientStartTimeRef.current = hasTransient ? Date.now() : null;
    startRefreshTransition((): void => {
      router.refresh();
    });
  }

  function apply(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form: FormData = new FormData(event.currentTarget);
    const name: string = String(form.get("name") ?? "").trim();
    const region: string = String(form.get("region") ?? "").trim().toLowerCase();
    const query: URLSearchParams = new URLSearchParams();
    if (name) query.set("name", name);
    if (status !== "all") query.set("status", status);
    if (region) query.set("region", region);
    startTransition((): void => { router.push(query.size ? `/dashboard?${query.toString()}` : "/dashboard", { scroll: false }); });
  }

  return (
    <form onSubmit={apply} aria-label="Filter deployments" aria-busy={pending || isRefreshing} className="border-b border-surface-border">
      {timeoutWarning && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 border-b border-amber-400/20 bg-amber-400/10 px-5 py-3 text-xs text-amber-200 sm:px-6"
        >
          <span>One or more container operations are taking longer than expected. Check the Azure portal or refresh manually.</span>
          <button
            type="button"
            onClick={handleRefresh}
            className="font-medium underline hover:text-amber-100"
          >
            Refresh now
          </button>
        </div>
      )}
      <div className="px-5 py-4 sm:px-6">
        <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(180px,1fr)_148px_152px_auto]">
          <TextField name="name" value={name} onChange={setName} maxLength={32} className="min-w-0">
            <Label className="mb-1 text-xs font-medium text-muted-text">Name</Label>
            <Input placeholder="Search deployments…" className={fieldClass} />
          </TextField>
          <Select className="min-w-0" value={status} onChange={(value: Key | Key[] | null): void => { setStatus(typeof value === "string" ? value : "all"); }}>
            <Label className="mb-1 text-xs font-medium text-muted-text">Status</Label>
            <Select.Trigger className={fieldClass}><Select.Value /><Select.Indicator /></Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id="all" textValue="All statuses">All statuses<ListBox.ItemIndicator /></ListBox.Item>
                {DEPLOYMENT_STATUSES.map((value: string): JSX.Element => (
                  <ListBox.Item key={value} id={value} textValue={value.charAt(0) + value.slice(1).toLowerCase()}>{value.charAt(0) + value.slice(1).toLowerCase()}<ListBox.ItemIndicator /></ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
          <TextField name="region" value={region} onChange={setRegion} maxLength={64} pattern="[a-zA-Z][a-zA-Z0-9]{0,63}" className="min-w-0">
            <Label className="mb-1 text-xs font-medium text-muted-text">Region</Label>
            <Input placeholder="All regions" className={fieldClass} />
          </TextField>
          <div className="flex h-10 items-center gap-1.5">
            <Button type="submit" className="h-10 rounded-lg px-4 text-xs font-medium" isDisabled={pending}>{pending ? "Applying…" : "Apply filters"}</Button>
            <Button type="button" variant="ghost" className="h-10 rounded-lg px-3 text-xs text-muted-text" isDisabled={pending || !hasFilters} onPress={(): void => {
              setName(""); setRegion(""); setStatus("all");
              startTransition((): void => { router.push("/dashboard", { scroll: false }); router.refresh(); });
            }}>Reset</Button>
            <div className="ml-1 border-l border-surface-border pl-1.5">
              <Button
                type="button"
                variant="ghost"
                className="h-10 rounded-lg px-3 text-xs text-muted-text"
                isDisabled={pending || isRefreshing}
                onPress={handleRefresh}
              >
                <svg
                  className={`size-3.5 ${isRefreshing ? "animate-spin text-accent" : "text-muted-text"}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
                <span>{isRefreshing ? "Refreshing…" : "Refresh"}</span>
              </Button>
            </div>
          </div>
        </div>
      </div>
      <span role="status" className="sr-only">{isRefreshing ? "Refreshing deployments…" : pending ? "Updating deployments…" : "Deployment filters ready."}</span>
    </form>
  );
}
