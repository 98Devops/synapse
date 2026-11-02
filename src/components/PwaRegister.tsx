'use client';

import { useEffect } from 'react';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

declare global {
  interface Window {
    __synapseInstall?: InstallPromptEvent | null;
  }
}

/**
 * Registers the service worker (production only — it would fight dev HMR) and
 * holds on to the browser's install prompt so the UI can offer "Install app"
 * at a moment of its choosing. Fires `synapse:installable` when one is ready.
 */
export default function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }

    const onPrompt = (e: Event) => {
      e.preventDefault();
      window.__synapseInstall = e as InstallPromptEvent;
      window.dispatchEvent(new Event('synapse:installable'));
    };
    const onInstalled = () => {
      window.__synapseInstall = null;
      window.dispatchEvent(new Event('synapse:installable'));
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  return null;
}

/** For the header button: is an install prompt available right now? */
export function canInstall() {
  return typeof window !== 'undefined' && !!window.__synapseInstall;
}

export async function promptInstall() {
  const p = window.__synapseInstall;
  if (!p) return;
  await p.prompt();
  await p.userChoice.catch(() => null);
  window.__synapseInstall = null;
  window.dispatchEvent(new Event('synapse:installable'));
}
