'use client';

import { useEffect, useState } from 'react';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function PwaInstall({ visible }: { visible: boolean }) {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);

  useEffect(() => {
    // エディタの /game/ プレビューでは SW を登録しない。エディタ全体のキャッシュを避ける。
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production' && window.location.pathname === '/') {
      void navigator.serviceWorker.register('/sw.js').catch((error) => console.warn('[pwa]', error));
    }
    const remember = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const installed = () => setInstallPrompt(null);
    window.addEventListener('beforeinstallprompt', remember);
    window.addEventListener('appinstalled', installed);
    return () => {
      window.removeEventListener('beforeinstallprompt', remember);
      window.removeEventListener('appinstalled', installed);
    };
  }, []);

  if (!visible || !installPrompt) return null;
  return (
    <button
      type="button"
      className="pwa-install"
      onClick={() => void installPrompt.prompt().then(() => installPrompt.userChoice).then(() => setInstallPrompt(null))}
    >
      インストール
    </button>
  );
}
