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
    "Interactive simulation of an Argo CD + Argo Rollouts + Prometheus + K8sGPT progressive delivery pipeline with AI-driven incident response and automated rollback.",
  keywords: [
    "GitOps",
    "Argo CD",
    "Argo Rollouts",
    "Prometheus",
    "K8sGPT",
    "Progressive Delivery",
    "Canary Deployment",
    "SRE",
    "Kubernetes",
    "CNCF",
  ],
  authors: [{ name: "adventurewave-labs" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "GitOps Progressive Delivery Demo",
    description:
      "Argo CD + Argo Rollouts + Prometheus + K8sGPT — interactive pipeline simulation.",
    url: "https://github.com/adventurewave-labs",
    siteName: "adventurewave-labs",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "GitOps Progressive Delivery Demo",
    description:
      "Argo CD + Argo Rollouts + Prometheus + K8sGPT — interactive pipeline simulation.",
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
