"use client";

import { ToastProvider } from "@heroui/react";
import type { JSX, ReactNode } from "react";

interface ProvidersProps {
  readonly children: ReactNode;
}

export function Providers({ children }: ProvidersProps): JSX.Element {
  return (
    <>
      <ToastProvider placement="bottom end" />
      {children}
    </>
  );
}
