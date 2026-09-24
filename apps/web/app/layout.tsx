import type { Metadata } from 'next';
import './globals.css';
import { Sidebar } from '@/components/sidebar';
import { Header } from '@/components/header';

export const metadata: Metadata = {
  title: 'XActions — Modern Social Intelligence & Automation Dashboard',
  description: 'AI-powered Twitter & social automation, viral pattern mining, and follower intelligence.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex h-screen overflow-hidden antialiased">
        <Sidebar />
        <div className="flex flex-col flex-1 overflow-hidden">
          <Header />
          <main className="flex-1 overflow-y-auto p-6 bg-slate-50 dark:bg-slate-950">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
