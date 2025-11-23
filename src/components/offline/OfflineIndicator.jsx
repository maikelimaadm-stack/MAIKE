import React, { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Wifi, WifiOff } from 'lucide-react';

export default function OfflineIndicator() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Atualizar contador de pendentes
    const updatePending = () => {
      const pending = JSON.parse(localStorage.getItem('pending_actions') || '[]');
      setPendingCount(pending.length);
    };

    updatePending();
    const interval = setInterval(updatePending, 1000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, []);

  if (isOnline && pendingCount === 0) return null;

  return (
    <div className="fixed top-16 right-4 z-50">
      <Badge 
        className={`${isOnline ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'} flex items-center gap-2 px-3 py-2 shadow-lg`}
      >
        {isOnline ? (
          <>
            <Wifi className="w-4 h-4" />
            Online
            {pendingCount > 0 && ` • ${pendingCount} pendente(s)`}
          </>
        ) : (
          <>
            <WifiOff className="w-4 h-4" />
            Offline {pendingCount > 0 && `• ${pendingCount} salvo(s)`}
          </>
        )}
      </Badge>
    </div>
  );
}