import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { ProjectProvider } from "@/context/ProjectContext";
import { isPublicHost } from '@/lib/public-host';

export const metadata: Metadata = {
  title: "Strom — Portfolio Intelligence",
  description: "Air Liquide — Project intersection analysis",
  icons: {
    icon: '/icon-192.png',
    apple: '/apple-icon.png',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const isPublic = isPublicHost(headers().get('host'));
  return (
    <html lang="en">
      <body className="antialiased">
        <ProjectProvider isPublic={isPublic}>
          {children}
        </ProjectProvider>
      </body>
    </html>
  );
}
