import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'XActions Public Actions Catalog — Every Platform, Every Action',
  description:
    'Browse the full manifest of scrape actions across 25+ platforms: social, crypto, e-commerce, procurement, recruitment, realestate. Sync-capable flags, required args, and live playground links.',
  openGraph: {
    title: 'XActions Public Actions Catalog',
    description: 'Self-discovery manifest for the XActions scrape gateway.',
    type: 'website',
  },
};

export default function ActionsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
