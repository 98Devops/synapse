import { ImageResponse } from 'next/og';
import { BrandMark } from '@/lib/brandMark';

/** Manifest icons: /pwa-icon/192, /pwa-icon/512, /pwa-icon/maskable */
const VARIANTS: Record<string, { size: number; padded: boolean }> = {
  '192': { size: 192, padded: false },
  '512': { size: 512, padded: false },
  maskable: { size: 512, padded: true },
};

export const dynamic = 'force-static';

export function generateStaticParams() {
  return Object.keys(VARIANTS).map((variant) => ({ variant }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ variant: string }> }) {
  const v = VARIANTS[(await params).variant];
  if (!v) return new Response('Not found', { status: 404 });
  return new ImageResponse(<BrandMark size={v.size} padded={v.padded} />, {
    width: v.size,
    height: v.size,
  });
}
