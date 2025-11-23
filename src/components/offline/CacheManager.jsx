import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';

export default function CacheManager() {
  const empresaId = localStorage.getItem('empresa_selecionada_id');

  // Cachear todas as entidades importantes
  const { data: areas } = useQuery({
    queryKey: ['cache-areas'],
    queryFn: async () => {
      const data = await base44.entities.AreaPastagem.list();
      localStorage.setItem('cache_areas', JSON.stringify(data));
      localStorage.setItem('cache_areas_timestamp', Date.now().toString());
      return data;
    },
    staleTime: 1000 * 60 * 5, // 5 minutos
    refetchInterval: 1000 * 60 * 5, // Atualizar a cada 5 minutos
  });

  const { data: lotes } = useQuery({
    queryKey: ['cache-lotes'],
    queryFn: async () => {
      const data = await base44.entities.Lote.list();
      localStorage.setItem('cache_lotes', JSON.stringify(data));
      localStorage.setItem('cache_lotes_timestamp', Date.now().toString());
      return data;
    },
    staleTime: 1000 * 60 * 5,
    refetchInterval: 1000 * 60 * 5,
  });

  const { data: pontosSuplementacao } = useQuery({
    queryKey: ['cache-pontos-supl'],
    queryFn: async () => {
      const data = await base44.entities.PontoSuplementacao.list();
      localStorage.setItem('cache_pontos_suplementacao', JSON.stringify(data));
      localStorage.setItem('cache_pontos_suplementacao_timestamp', Date.now().toString());
      return data;
    },
    staleTime: 1000 * 60 * 5,
    refetchInterval: 1000 * 60 * 5,
  });

  const { data: pontosReferencia } = useQuery({
    queryKey: ['cache-pontos-ref'],
    queryFn: async () => {
      const data = await base44.entities.PontoReferencia.list();
      localStorage.setItem('cache_pontos_referencia', JSON.stringify(data));
      localStorage.setItem('cache_pontos_referencia_timestamp', Date.now().toString());
      return data;
    },
    staleTime: 1000 * 60 * 5,
    refetchInterval: 1000 * 60 * 5,
  });

  const { data: linhas } = useQuery({
    queryKey: ['cache-linhas'],
    queryFn: async () => {
      const data = await base44.entities.LinhaGeografica.list();
      localStorage.setItem('cache_linhas', JSON.stringify(data));
      localStorage.setItem('cache_linhas_timestamp', Date.now().toString());
      return data;
    },
    staleTime: 1000 * 60 * 5,
    refetchInterval: 1000 * 60 * 5,
  });

  const { data: iconesConfig } = useQuery({
    queryKey: ['cache-icones'],
    queryFn: async () => {
      const data = await base44.entities.ConfiguracaoIcone.list();
      localStorage.setItem('cache_icones', JSON.stringify(data));
      localStorage.setItem('cache_icones_timestamp', Date.now().toString());
      return data;
    },
    staleTime: 1000 * 60 * 10,
    refetchInterval: 1000 * 60 * 10,
  });

  const { data: fatoresConsumo } = useQuery({
    queryKey: ['cache-fatores'],
    queryFn: async () => {
      const data = await base44.entities.FatorConsumoCategoria.list();
      localStorage.setItem('cache_fatores', JSON.stringify(data));
      localStorage.setItem('cache_fatores_timestamp', Date.now().toString());
      return data;
    },
    staleTime: 1000 * 60 * 10,
    refetchInterval: 1000 * 60 * 10,
  });

  useEffect(() => {
    // Salvar timestamp do último cache
    if (areas || lotes || pontosSuplementacao) {
      localStorage.setItem('cache_timestamp', new Date().toISOString());
    }
  }, [areas, lotes, pontosSuplementacao]);

  return null; // Componente invisível
}