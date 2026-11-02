import { ImageResponse } from 'next/og';
import { BrandMark } from '@/lib/brandMark';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

// iOS applies its own corner mask, so draw edge to edge.
export default function AppleIcon() {
  return new ImageResponse(<BrandMark size={180} padded />, size);
}
