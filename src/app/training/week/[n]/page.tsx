import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import TrainingApp from '@/features/training/components/TrainingApp';

export const metadata: Metadata = { title: 'Training · Synapse' };

export default async function TrainingWeekPage({ params }: { params: Promise<{ n: string }> }) {
  const { n } = await params;
  const week = Number(n);
  if (!Number.isInteger(week) || week < 1 || week > 52) notFound();
  return <TrainingApp initialWeek={week} />;
}
