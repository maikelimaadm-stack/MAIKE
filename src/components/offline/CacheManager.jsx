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
      return data;
    },
    staleTime: 1000 * 60 * 30, // 30 minutos
  });

  const { data: lotes } = useQuery({
    queryKey: ['cache-lotes'],
    queryFn: async () => {
      const data = await base44.entities.Lote.list();
      localStorage.setItem('cache_lotes', JSON.stringify(data));
      return data;
    },
    staleTime: 1000 * 60 * 30,
  });

  const { data: pontosSuplementacao } = useQuery({
    queryKey: ['cache-pontos-supl'],
    queryFn: async () => {
      const data = await base44.entities.PontoSuplementacao.list();
      localStorage.setItem('cache_pontos_suplementacao', JSON.stringify(data));
      return data;
    },
    staleTime: 1000 * 60 * 30,
  });

  const { data: pontosReferencia } = useQuery({
    queryKey: ['cache-pontos-ref'],
    queryFn: async () => {
      const data = await base44.entities.PontoReferencia.list();
      localStorage.setItem('cache_pontos_referencia', JSON.stringify(data));
      return data;
    },
    staleTime: 1000 * 60 * 30,
  });

  const { data: linhas } = useQuery({
    queryKey: ['cache-linhas'],
    queryFn: async () => {
      const data = await base44.entities.LinhaGeografica.list();
      localStorage.setItem('cache_linhas', JSON.stringify(data));
      return data;
    },
    staleTime: 1000 * 60 * 30,
  });

  const { data: iconesConfig } = useQuery({
    queryKey: ['cache-icones'],
    queryFn: async () => {
      const data = await base44.entities.ConfiguracaoIcone.list();
      localStorage.setItem('cache_icones', JSON.stringify(data));
      return data;
    },
    staleTime: 1000 * 60 * 60, // 1 hora
  });

  const { data: fatoresConsumo } = useQuery({
    queryKey: ['cache-fatores'],
    queryFn: async () => {
      const data = await base44.entities.FatorConsumoCategoria.list();
      localStorage.setItem('cache_fatores', JSON.stringify(data));
      return data;
    },
    staleTime: 1000 * 60 * 60,
  });

  useEffect(() => {
    // Salvar timestamp do último cache
    if (areas || lotes || pontosSuplementacao) {
      localStorage.setItem('cache_timestamp', new Date().toISOString());
    }
  }, [areas, lotes, pontosSuplementacao]);

  return null; // Componente invisível
}