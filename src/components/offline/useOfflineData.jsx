import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';

export function useOfflineData(entityName, filters = {}) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  const cacheKey = `offline_${entityName}_${JSON.stringify(filters)}`;

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    loadData();
  }, [entityName, JSON.stringify(filters)]);

  const loadData = async () => {
    setLoading(true);

    // Tentar buscar do cache primeiro
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      setData(JSON.parse(cached));
    }

    // Se estiver online, buscar dados atualizados
    if (navigator.onLine) {
      try {
        const result = await base44.entities[entityName].list();
        const filtered = Object.keys(filters).length > 0
          ? result.filter(item => {
              return Object.entries(filters).every(([key, value]) => item[key] === value);
            })
          : result;

        setData(filtered);
        localStorage.setItem(cacheKey, JSON.stringify(filtered));
        localStorage.setItem(`${cacheKey}_timestamp`, Date.now().toString());
      } catch (error) {
        console.error('Erro ao buscar dados:', error);
      }
    }

    setLoading(false);
  };

  const refresh = () => loadData();

  const saveOfflineAction = (type, actionData) => {
    const pending = JSON.parse(localStorage.getItem('pending_actions') || '[]');
    pending.push({
      id: Date.now(),
      type,
      data: actionData,
      timestamp: new Date().toISOString()
    });
    localStorage.setItem('pending_actions', JSON.stringify(pending));
  };

  return { data, loading, isOffline, refresh, saveOfflineAction };
}