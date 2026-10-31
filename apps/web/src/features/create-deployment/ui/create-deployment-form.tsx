"use client";

import { Button, Label, Switch } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useRef, useState, type ChangeEvent, type Dispatch, type FormEvent, type JSX, type RefObject, type SetStateAction } from "react";
import { createDeployment, type CreateDeploymentResult } from "../api/create-deployment";
import { parseDeploymentInput, type DeploymentInputResult } from "../model/request";
import { getRepositories } from "../api/get-repositories";
import type { GitHubRepository, RepositoryResult } from "../model/repositories";
import { AdditionalPorts } from "./additional-ports";
import { PersistentVolumes } from "./persistent-volumes";
import { RegionPicker } from "./region-picker";
import type { RegionsResult } from "../model/regions";

const INPUT_CLASS: string = "mt-2 h-11 w-full rounded-lg border border-surface-border bg-background px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-dark focus:border-accent focus:ring-1 focus:ring-accent disabled:opacity-60";
const LABEL_CLASS: string = "block text-xs font-medium text-foreground";
const SECTION_CLASS: string = "rounded-xl border border-surface-border bg-surface/40 p-5 sm:p-7";

type CreateDeploymentFormProps = {
  readonly initialRepositories: RepositoryResult;
  readonly initialRegions: RegionsResult;
  readonly installUrl: string;
};

export function CreateDeploymentForm({ initialRepositories, initialRegions, installUrl }: CreateDeploymentFormProps): JSX.Element {
  const [repositories, setRepositories]: [GitHubRepository[], Dispatch<SetStateAction<GitHubRepository[]>>] = useState(initialRepositories.data?.repositories ?? []);
  const [nextPage, setNextPage]: [number | null, Dispatch<SetStateAction<number | null>>] = useState(initialRepositories.data ? (initialRepositories.data.has_next_page ? initialRepositories.data.page + 1 : null) : 1);
  const [repositoryError, setRepositoryError]: [string | null, Dispatch<SetStateAction<string | null>>] = useState(initialRepositories.error ?? null);
  const [loadingRepositories, setLoadingRepositories]: [boolean, Dispatch<SetStateAction<boolean>>] = useState(false);
  const [repositoryUrl, setRepositoryUrl]: [string, Dispatch<SetStateAction<string>>] = useState("");
  const repositoryRequest: RefObject<boolean> = useRef(false);
  const selectedRepository: GitHubRepository | undefined = repositories.find((repository: GitHubRepository): boolean => repository.html_url === repositoryUrl);
  const router: ReturnType<typeof useRouter> = useRouter();
  const [cpu, setCpu]: [string, Dispatch<SetStateAction<string>>] = useState("0.5");
  const [containerExternal, setContainerExternal]: [boolean, Dispatch<SetStateAction<boolean>>] = useState(true);
  const [error, setError]: [string | null, Dispatch<SetStateAction<string | null>>] = useState<string | null>(null);
  const [pending, setPending]: [boolean, Dispatch<SetStateAction<boolean>>] = useState(false);
  const inFlight: RefObject<boolean> = useRef(false);
  const attempt: RefObject<{ fingerprint: string; key: string } | null> = useRef<{ fingerprint: string; key: string } | null>(null);
  const errorRef: RefObject<HTMLDivElement | null> = useRef<HTMLDivElement | null>(null);

  async function loadRepositories(): Promise<void> {
    if (repositoryRequest.current || nextPage === null) return;
    repositoryRequest.current = true;
    setLoadingRepositories(true);
    setRepositoryError(null);
    try {
      const result: RepositoryResult = await getRepositories(nextPage);
      if (!result.data) { setRepositoryError(result.error); return; }
      setRepositories((current: GitHubRepository[]): GitHubRepository[] => Array.from(new Map([...current, ...result.data.repositories].map((repository: GitHubRepository): [number, GitHubRepository] => [repository.id, repository])).values()));
      setNextPage(result.data.has_next_page ? result.data.page + 1 : null);
    } catch {
      setRepositoryError("GitHub repositories could not be loaded. Try again.");
    } finally {
      repositoryRequest.current = false;
      setLoadingRepositories(false);
    }
  }

  function showError(message: string): void {
    setError(message);
    requestAnimationFrame((): void => { errorRef.current?.focus(); });
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (inFlight.current) return;
    if (!selectedRepository) { showError("Select a GitHub repository to deploy."); return; }
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
          <p className="mt-1 text-sm leading-6 text-muted-text">Connect your repository. The resolved Git commit SHA automatically tags the image.</p>
          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            <label className={LABEL_CLASS}>Deployment name<input className={INPUT_CLASS} name="name" required minLength={2} maxLength={32} pattern="[a-z][a-z0-9\-]{0,30}[a-z0-9]" placeholder="my-app" autoComplete="off" /><span className="mt-2 block font-normal leading-5 text-muted-text">Lowercase letters, numbers, and hyphens. Unique to your account.</span></label>
            <div className="sm:col-span-2">
              <label className={LABEL_CLASS} htmlFor="repository">GitHub repository</label>
              <select id="repository" name="repo" required className={INPUT_CLASS} value={repositoryUrl} onChange={(event: ChangeEvent<HTMLSelectElement>): void => setRepositoryUrl(event.target.value)} aria-describedby="repository-help repository-status">
                <option value="">Select a repository</option>
                {repositories.map((repository: GitHubRepository): JSX.Element => <option key={repository.id} value={repository.html_url}>{repository.full_name}{repository.private ? " (private)" : ""}</option>)}
              </select>
              <input type="hidden" name="ref" value={selectedRepository?.default_branch ?? ""} />
              <p id="repository-help" className="mt-2 text-xs leading-5 text-muted-text">{selectedRepository ? `Builds from ${selectedRepository.default_branch ?? "the default branch"}.` : "Choose a repository containing your application and Dockerfile. Its default branch will be used."}</p>
              <div id="repository-status" className="mt-2 text-xs leading-5" aria-live="polite">
                {repositoryError ? <p role="alert" className="text-red-200">{repositoryError}</p> : repositories.length === 0 && <p className="text-muted-text">{nextPage === null ? "No accessible repositories found." : "No repositories on this page. Load more to continue."}</p>}
                {nextPage !== null && <Button type="button" variant="secondary" size="sm" className="mt-2" isPending={loadingRepositories} isDisabled={loadingRepositories} onPress={loadRepositories}>{loadingRepositories ? "Loading repositories…" : repositoryError ? "Retry loading repositories" : "Load more repositories"}</Button>}
              </div>
              <p className="mt-3 text-xs leading-5 text-muted-text">Don’t see your repository? <a href={installUrl} className="text-foreground underline underline-offset-4 hover:text-accent">Configure GitHub repository access</a>, then return and refresh this page. Only personally owned repositories are available.</p>
            </div>
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
            <RegionPicker initialRegions={initialRegions} inputClass={INPUT_CLASS} labelClass={LABEL_CLASS} disabled={pending} />
          </div>
        </section>
        <section className={SECTION_CLASS} aria-labelledby="ports-heading">
          <h2 id="ports-heading" className="text-base font-medium">Networking</h2>
          <Switch className="mt-6" isSelected={containerExternal} onChange={setContainerExternal} isDisabled={pending} aria-describedby="container-visibility-help">
            <Switch.Content>
              <Switch.Control><Switch.Thumb /></Switch.Control>
              <Label className="text-sm">Public container</Label>
            </Switch.Content>
          </Switch>
          <input type="hidden" name="external" value={String(containerExternal)} />
          <p id="container-visibility-help" className="mt-2 text-xs leading-5 text-muted-text">{containerExternal ? "The main HTTPS endpoint is public. Choose internal or external access separately for each additional TCP port." : "The main HTTPS endpoint and all additional TCP ports are accessible to apps in the same environment. Shared environments can include other users' apps."}</p>
          <label className={`${LABEL_CLASS} mt-6`}>Main application port<input className={INPUT_CLASS} name="target_port" type="number" required min="1" max="65535" step="1" defaultValue="3000" /><span className="mt-2 block font-normal leading-5 text-muted-text">The port your application listens on inside its container, served through HTTPS ingress.</span></label>
          <AdditionalPorts inputClass={INPUT_CLASS} labelClass={LABEL_CLASS} disabled={pending} containerExternal={containerExternal} />
        </section>
        <section className={SECTION_CLASS} aria-labelledby="storage-heading">
          <h2 id="storage-heading" className="text-base font-medium">Storage</h2>
          <p className="mt-1 text-sm leading-6 text-muted-text">Mount persistent volumes to keep files across restarts and deployments.</p>
          <PersistentVolumes inputClass={INPUT_CLASS} labelClass={LABEL_CLASS} disabled={pending} />
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
        <Button type="submit" variant="primary" isPending={pending} isDisabled={pending || !selectedRepository} className="rounded-lg px-6">{pending ? "Creating deployment…" : "Create deployment"}</Button>
      </div>
      <p className="text-right text-xs leading-5 text-muted-text">Your build starts after the deployment is accepted.</p>
    </form>
  );
}
