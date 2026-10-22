"use client";

import { Button } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useRef, useState, type ChangeEvent, type Dispatch, type FormEvent, type JSX, type RefObject, type SetStateAction } from "react";
import { createDeployment, type CreateDeploymentResult } from "../api/create-deployment";
import { parseDeploymentInput, type DeploymentInputResult } from "../model/request";

const INPUT_CLASS: string = "mt-2 h-11 w-full rounded-lg border border-surface-border bg-background px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-dark focus:border-accent focus:ring-1 focus:ring-accent disabled:opacity-60";
const LABEL_CLASS: string = "block text-xs font-medium text-foreground";
const SECTION_CLASS: string = "rounded-xl border border-surface-border bg-surface/40 p-5 sm:p-7";

export function CreateDeploymentForm(): JSX.Element {
  const router: ReturnType<typeof useRouter> = useRouter();
  const [cpu, setCpu]: [string, Dispatch<SetStateAction<string>>] = useState("0.5");
  const [error, setError]: [string | null, Dispatch<SetStateAction<string | null>>] = useState<string | null>(null);
  const [pending, setPending]: [boolean, Dispatch<SetStateAction<boolean>>] = useState(false);
  const inFlight: RefObject<boolean> = useRef(false);
  const attempt: RefObject<{ fingerprint: string; key: string } | null> = useRef<{ fingerprint: string; key: string } | null>(null);
  const errorRef: RefObject<HTMLDivElement | null> = useRef<HTMLDivElement | null>(null);

  function showError(message: string): void {
    setError(message);
    requestAnimationFrame((): void => { errorRef.current?.focus(); });
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (inFlight.current) return;
    const form: FormData = new FormData(event.currentTarget);
    const input: DeploymentInputResult = parseDeploymentInput(form);
    if (!input.data) { showError(input.error); return; }
    const fingerprint: string = JSON.stringify(input.data);
    if (!attempt.current || attempt.current.fingerprint !== fingerprint) attempt.current = { fingerprint, key: crypto.randomUUID() };
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const result: CreateDeploymentResult = await createDeployment(form, attempt.current.key);
      if (result.error) { showError(result.error); return; }
      router.push("/dashboard?created=" + encodeURIComponent(result.id!));
      router.refresh();
    } catch {
      showError("The request could not be confirmed. Retry with the same settings to avoid a duplicate deployment.");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5" aria-label="Create deployment" aria-busy={pending}>
      <fieldset disabled={pending} className="space-y-5">
        <section className={SECTION_CLASS} aria-labelledby="source-heading">
          <h2 id="source-heading" className="text-base font-medium">Application source</h2>
          <p className="mt-1 text-sm leading-6 text-muted-text">Connect your repository and choose the image tag for this build.</p>
          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            <label className={LABEL_CLASS}>Deployment name<input className={INPUT_CLASS} name="name" required minLength={2} maxLength={32} pattern="[a-z][a-z0-9\-]{0,30}[a-z0-9]" placeholder="my-app" autoComplete="off" /><span className="mt-2 block font-normal leading-5 text-muted-text">Lowercase letters, numbers, and hyphens. Unique to your account.</span></label>
            <label className={LABEL_CLASS}>Image tag<input className={INPUT_CLASS} name="tag" required maxLength={128} pattern="[A-Za-z0-9_][A-Za-z0-9_.\-]{0,127}" defaultValue="latest" /><span className="mt-2 block font-normal leading-5 text-muted-text">A label for the built image, such as v1 or latest.</span></label>
            <label className={`${LABEL_CLASS} sm:col-span-2`}>Repository URL<input className={INPUT_CLASS} name="repo" type="url" required maxLength={2048} placeholder="https://github.com/your-team/your-app" autoComplete="url" /><span className="mt-2 block font-normal leading-5 text-muted-text">An HTTPS Git repository containing your application and Dockerfile.</span></label>
            <label className={LABEL_CLASS}>Git reference <span className="font-normal text-muted-dark">(optional)</span><input className={INPUT_CLASS} name="ref" maxLength={255} placeholder="Default branch" /><span className="mt-2 block font-normal leading-5 text-muted-text">Branch, tag, or commit to build.</span></label>
            <label className={LABEL_CLASS}>Dockerfile path<input className={INPUT_CLASS} name="dockerfile_path" maxLength={1024} defaultValue="Dockerfile" /></label>
          </div>
        </section>
        <section className={SECTION_CLASS} aria-labelledby="runtime-heading">
          <h2 id="runtime-heading" className="text-base font-medium">Resources and scaling</h2>
          <p className="mt-1 text-sm leading-6 text-muted-text">Set resources per replica. Your plan limits apply when the deployment is created.</p>
          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            <label className={LABEL_CLASS}>vCPU per replica<input className={INPUT_CLASS} name="max_vcpu" type="number" required min="0.25" step="0.25" value={cpu} onChange={(event: ChangeEvent<HTMLInputElement>): void => setCpu(event.target.value)} /></label>
            <div><p className={LABEL_CLASS}>Memory per replica</p><output className="mt-2 flex h-11 items-center rounded-lg border border-surface-border bg-white/[0.02] px-3 font-mono text-sm">{cpu && Number.isFinite(Number(cpu)) ? Number(cpu) * 2 : "—"} GiB</output><p className="mt-2 text-xs leading-5 text-muted-text">Memory is twice the selected vCPU.</p></div>
            <label className={LABEL_CLASS}>Minimum replicas<input className={INPUT_CLASS} name="min_scaling" type="number" required min="0" step="1" defaultValue="0" /><span className="mt-2 block font-normal leading-5 text-muted-text">Use 0 to scale down when idle.</span></label>
            <label className={LABEL_CLASS}>Maximum replicas<input className={INPUT_CLASS} name="max_scaling" type="number" required min="1" step="1" defaultValue="1" /></label>
            <label className={LABEL_CLASS}>Application port<input className={INPUT_CLASS} name="target_port" type="number" required min="1" max="65535" step="1" defaultValue="3000" /><span className="mt-2 block font-normal leading-5 text-muted-text">The port your application listens on inside its container.</span></label>
            <label className={LABEL_CLASS}>Region <span className="font-normal text-muted-dark">(optional)</span><input className={INPUT_CLASS} name="region" maxLength={64} pattern="[a-z][a-z0-9]{0,63}" placeholder="Use workspace region" /><span className="mt-2 block font-normal leading-5 text-muted-text">For example, southeastasia. Must match your existing workspace region.</span></label>
          </div>
        </section>
        <details className={SECTION_CLASS}>
          <summary className="cursor-pointer text-sm font-medium">Advanced settings</summary>
          <div className="mt-6 space-y-5">
            <label className={LABEL_CLASS}>Image name <span className="font-normal text-muted-dark">(optional)</span><input className={INPUT_CLASS} name="image_name" maxLength={128} placeholder="Use deployment name" /></label>
            <label className={LABEL_CLASS}>Environment variables <span className="font-normal text-muted-dark">(optional)</span><textarea name="env_vars" rows={5} spellCheck={false} autoComplete="off" className={`${INPUT_CLASS} h-auto py-3 font-mono text-xs`} placeholder={"NODE_ENV=production\nLOG_LEVEL=info"} /><span className="mt-2 block font-normal leading-5 text-muted-text">One NAME=value per line. Values are passed to the running application.</span></label>
          </div>
        </details>
      </fieldset>
      {error && <div ref={errorRef} tabIndex={-1} role="alert" className="rounded-lg border border-red-400/20 bg-red-400/5 p-4 text-sm leading-6 text-red-200 outline-none focus:ring-1 focus:ring-red-400">{error}</div>}
      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-surface-border pt-6">
        <a href="/dashboard" className="text-sm text-muted-text transition-colors hover:text-foreground">Cancel</a>
        <Button type="submit" variant="primary" isPending={pending} isDisabled={pending} className="rounded-lg px-6">{pending ? "Creating deployment…" : "Create deployment"}</Button>
      </div>
      <p className="text-right text-xs leading-5 text-muted-text">Your build starts after the deployment is accepted.</p>
    </form>
  );
}
