import { useEffect, useState } from 'react';
import { EVENTO_FOTOS_DE_TAREFA, listarFotosGuardadasDaTarefa } from '@/services/fotosDeTarefaAguardandoService';

/**
 * D-PROD-324 — as fotos da tarefa tiradas sem internet, guardadas no aparelho, prontas para mostrar: cada uma com
 * um endereço local (`blob:`) para a miniatura e a tela cheia. Relê quando uma foto é guardada, enviada ou excluída
 * e libera os endereços antigos.
 * @param {string | null | undefined} tarefaId
 * @returns {Array<{ chave: number|string, url: string, nome: string, tamanho: number }>}
 */
export default function useFotosGuardadasDaTarefa(tarefaId) {
  const [fotos, setFotos] = useState(/** @type {Array<{ chave: number|string, url: string, nome: string, tamanho: number }>} */ ([]));

  useEffect(() => {
    let vivo = true;
    /** @type {string[]} */
    let enderecos = [];
    // Sem foto guardada (o comum) não há o que mudar: não mexe no estado (nem renderiza de novo).
    let mostrando = 0;
    const soltar = () => {
      for (const u of enderecos) {
        try {
          URL.revokeObjectURL(u);
        } catch {
          // sem URL.revokeObjectURL (ambiente de teste): nada a soltar
        }
      }
      enderecos = [];
    };
    const ler = async () => {
      const lidas = await listarFotosGuardadasDaTarefa(tarefaId || '');
      if (!vivo) return;
      if (lidas.length === 0 && mostrando === 0) return;
      mostrando = lidas.length;
      soltar();
      const prontas = lidas.map((f) => {
        const url = typeof URL.createObjectURL === 'function' ? URL.createObjectURL(new Blob([f.conteudo], { type: f.tipo })) : '';
        if (url) enderecos.push(url);
        // D-PROD-338: o tamanho entra na conta do que cabe na tarefa.
        return { chave: f.chave, url, nome: f.nome, tamanho: Number(f.conteudo?.byteLength ?? 0) };
      });
      setFotos(prontas);
    };
    void ler();
    window.addEventListener(EVENTO_FOTOS_DE_TAREFA, ler);
    return () => {
      vivo = false;
      window.removeEventListener(EVENTO_FOTOS_DE_TAREFA, ler);
      soltar();
    };
  }, [tarefaId]);

  return fotos;
}
