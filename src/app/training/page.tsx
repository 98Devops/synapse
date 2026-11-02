import type { Metadata } from 'next';
import TrainingApp from '@/features/training/components/TrainingApp';

export const metadata: Metadata = { title: 'Training · Synapse' };

/** Opens on the current week of the user's run. */
export default function TrainingPage() {
  return <TrainingApp />;
}
