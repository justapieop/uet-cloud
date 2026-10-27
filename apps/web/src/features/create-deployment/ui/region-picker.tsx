"use client";

import { Button } from "@heroui/react";
import { useRef, useState, type Dispatch, type JSX, type RefObject, type SetStateAction } from "react";
import { getRegions } from "../api/get-regions";
import type { DeploymentRegion, RegionsResult } from "../model/regions";

type RegionPickerProps = {
  readonly initialRegions: RegionsResult;
  readonly inputClass: string;
  readonly labelClass: string;
  readonly disabled: boolean;
};

export function RegionPicker({ initialRegions, inputClass, labelClass, disabled }: RegionPickerProps): JSX.Element {
  const [result, setResult]: [RegionsResult, Dispatch<SetStateAction<RegionsResult>>] = useState(initialRegions);
  const [loading, setLoading]: [boolean, Dispatch<SetStateAction<boolean>>] = useState(false);
  const inFlight: RefObject<boolean> = useRef(false);

  async function retry(): Promise<void> {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      setResult(await getRegions());
    } catch {
      setResult({ error: "Deployment regions could not be loaded. Try again." });
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }

  return (
    <div>
      <label className={labelClass} htmlFor="deployment-region">Region <span className="font-normal text-muted-dark">(optional)</span></label>
      <select id="deployment-region" name="region" className={inputClass} defaultValue="" disabled={disabled || loading} aria-describedby="deployment-region-help deployment-region-status">
        <option value="">Use configured environment region</option>
        {result.data?.map((region: DeploymentRegion): JSX.Element => <option key={region.name} value={region.name}>{region.display_name}</option>)}
      </select>
      <p id="deployment-region-help" className="mt-2 text-xs leading-5 text-muted-text">Available regions follow the platform deployment configuration. Azure policies, quotas, and available capacity still apply.</p>
      <div id="deployment-region-status" className="mt-2 text-xs leading-5" aria-live="polite" aria-busy={loading}>
        {result.error ? <p role="alert" className="text-red-200">{result.error}</p> : result.data?.length === 0 && <p className="text-muted-text">No deployment regions were returned.</p>}
        {(result.error || result.data?.length === 0) && <Button type="button" variant="secondary" size="sm" className="mt-2" isDisabled={disabled || loading} isPending={loading} onPress={retry}>{loading ? "Loading regions…" : "Retry loading regions"}</Button>}
      </div>
    </div>
  );
}
