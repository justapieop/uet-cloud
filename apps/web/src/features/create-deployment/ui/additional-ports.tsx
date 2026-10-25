"use client";

import { Button, Label, Switch } from "@heroui/react";
import { useRef, useState, type Dispatch, type JSX, type RefObject, type SetStateAction } from "react";

type AdditionalPortsProps = {
  readonly inputClass: string;
  readonly labelClass: string;
  readonly disabled: boolean;
  readonly containerExternal: boolean;
};

type PortRow = { readonly id: number; readonly external: boolean };

export function AdditionalPorts({ inputClass, labelClass, disabled, containerExternal }: AdditionalPortsProps): JSX.Element {
  const [rows, setRows]: [PortRow[], Dispatch<SetStateAction<PortRow[]>>] = useState<PortRow[]>([]);
  const nextId: RefObject<number> = useRef(0);

  function addPort(): void {
    const id: number = nextId.current++;
    setRows((current: PortRow[]): PortRow[] => current.length < 5 ? [...current, { id, external: false }] : current);
    requestAnimationFrame((): void => { document.getElementById(`additional-target-${id}`)?.focus(); });
  }

  return (
    <div className="mt-6 border-t border-surface-border pt-6">
      <h3 className="text-sm font-medium">Additional TCP ports <span className="font-normal text-muted-dark">(optional)</span></h3>
      <p id="additional-ports-help" className="mt-2 text-xs leading-5 text-muted-text">Add up to five ports alongside the main HTTPS application port. Leave the exposed port blank to use the target port. Port 36985 is reserved.</p>
      <div className="mt-4 space-y-4">
        {rows.map(({ id, external }: PortRow, index: number): JSX.Element => (
          <fieldset key={id} className="rounded-lg border border-surface-border p-4" aria-describedby="additional-ports-help external-ports-help">
            <legend className="px-1 text-xs font-medium">TCP port {index + 1}</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className={labelClass} htmlFor={`additional-target-${id}`}>Target port<input id={`additional-target-${id}`} className={inputClass} name="additional_target_port" type="number" required min="1" max="65535" step="1" placeholder="8080" /></label>
              <label className={labelClass}>Exposed port <span className="font-normal text-muted-dark">(optional)</span><input className={inputClass} name="additional_exposed_port" type="number" min="1" max="65535" step="1" placeholder="Same as target port" /></label>
              <div className="flex items-center">
                <Switch size="sm" isSelected={containerExternal && external} isDisabled={disabled || !containerExternal} aria-describedby="external-ports-help" onChange={(nextExternal: boolean): void => {
                setRows((current: PortRow[]): PortRow[] => current.map((row: PortRow): PortRow => row.id === id ? { ...row, external: nextExternal } : row));
                }}>
                  <Switch.Content>
                    <Switch.Control><Switch.Thumb /></Switch.Control>
                    <Label className="text-xs">External access</Label>
                  </Switch.Content>
                </Switch>
                <input type="hidden" name="additional_external" value={String(containerExternal && external)} />
              </div>
              <div className="flex items-end sm:justify-end"><Button type="button" variant="ghost" size="sm" isDisabled={disabled} aria-label={`Remove TCP port ${index + 1}`} onPress={(): void => setRows((current: PortRow[]): PortRow[] => current.filter((row: PortRow): boolean => row.id !== id))}>Remove port</Button></div>
            </div>
          </fieldset>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" size="sm" isDisabled={disabled || rows.length >= 5} onPress={addPort}>Add TCP port</Button>
        <span className="text-xs text-muted-text" role="status">{rows.length} of 5 ports added</span>
      </div>
      <p id="external-ports-help" className="mt-3 text-xs leading-5 text-muted-text">External TCP ports require a public container and VNet integration, which is configured automatically for new environments. Existing environments without VNet integration require migration. External ports cannot expose 80 or 443. Each target and exposed port must be unique; targets must also differ from the main application port.</p>
    </div>
  );
}
