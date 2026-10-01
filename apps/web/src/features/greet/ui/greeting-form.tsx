"use client";

import { Button, Input, Label, TextField } from "@heroui/react";
import { useState } from "react";
import type { Dispatch, FormEvent, SetStateAction } from "react";

export function GreetingForm() {
  const [name, setName]: [string, Dispatch<SetStateAction<string>>] = useState<string>("");
  const [greeting, setGreeting]: [string, Dispatch<SetStateAction<string>>] = useState<string>("Hello, world!");

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setGreeting(`Hello, ${name.trim() || "world"}!`);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <TextField name="name" value={name} onChange={setName} fullWidth>
        <Label>Your name</Label>
        <Input autoComplete="given-name" maxLength={80} placeholder="World" />
      </TextField>
      <Button type="submit" variant="primary" className="self-start">
        Say hello
      </Button>
      <p role="status" aria-live="polite" aria-atomic="true" className="min-h-8 pt-2 text-xl font-medium">
        {greeting}
      </p>
    </form>
  );
}
