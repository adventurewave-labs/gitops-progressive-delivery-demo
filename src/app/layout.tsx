import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "GitOps Progressive Delivery & Incident Response Demo",
  description:
    "A live Argo CD + Argo Rollouts + Prometheus progressive delivery pipeline running against a real k3s cluster, with GLM-4.5 root-cause analysis and SLO-driven automated rollback.",
  keywords: [
    "GitOps",
    "Argo CD",
    "Argo Rollouts",
    "Prometheus",
    "GLM-4.5",
    "Progressive Delivery",
    "Canary Deployment",
    "SRE",
    "Kubernetes",
    "CNCF",
  ],
  authors: [{ name: "adventurewave-labs" }],
  openGraph: {
    title: "GitOps Progressive Delivery Demo",
    description:
      "Argo CD + Argo Rollouts + Prometheus on a real k3s cluster — live progressive delivery.",
    url: "https://github.com/adventurewave-labs",
    siteName: "adventurewave-labs",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "GitOps Progressive Delivery Demo",
    description:
      "Argo CD + Argo Rollouts + Prometheus on a real k3s cluster — live progressive delivery.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${geistMono.variable} antialiased bg-background text-foreground min-h-screen`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
