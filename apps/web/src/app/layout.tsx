import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { Providers } from "./providers";
import "./globals.css";

type RootLayoutProps = Readonly<{
  children: ReactNode;
}>;

type FontWithVariable = {
  readonly variable: string;
  readonly className: string;
};

const geistSans: FontWithVariable = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono: FontWithVariable = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Kumo - The PaaS for Deploying Applications on Azure",
  description:
    "A cloud-integrated Platform as a Service (PaaS) for deploying containerized workloads to Azure Container Apps with automated isolation and zero infra overhead.",
};

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} dark h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
