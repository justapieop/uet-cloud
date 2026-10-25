"use client";

import { Button, Input, Label, ListBox, Select, TextField, type Key } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type Dispatch, type FormEvent, type JSX, type SetStateAction, type TransitionStartFunction } from "react";
import { DEPLOYMENT_STATUSES, type DeploymentFilters as Filters } from "@/entities/deployment";

export function DeploymentFilters({ filters, clearable = false }: { readonly filters: Filters; readonly clearable?: boolean }): JSX.Element {
  const router: ReturnType<typeof useRouter> = useRouter();
  const [status, setStatus]: [string, Dispatch<SetStateAction<string>>] = useState<string>(filters.status ?? "all");
  const [name, setName]: [string, Dispatch<SetStateAction<string>>] = useState<string>(filters.name ?? "");
  const [region, setRegion]: [string, Dispatch<SetStateAction<string>>] = useState<string>(filters.region ?? "");
  const [pending, startTransition]: [boolean, TransitionStartFunction] = useTransition();
  const hasFilters: boolean = clearable || Boolean(name || region || status !== "all");
  const fieldClass: string = "h-10 min-h-10 rounded-lg border border-[var(--surface-border)] bg-background shadow-none";

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
    <form onSubmit={apply} aria-label="Filter deployments" aria-busy={pending} className="border-b border-surface-border px-5 py-4 sm:px-6">
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
          <Button type="button" variant="ghost" className="h-10 rounded-lg px-3 text-xs text-muted-text" isDisabled={pending} onPress={(): void => { startTransition((): void => { router.refresh(); }); }}>Refresh</Button>
        </div>
      </div>
      </div>
      <span role="status" className="sr-only">{pending ? "Updating deployments…" : "Deployment filters ready."}</span>
    </form>
  );
}
