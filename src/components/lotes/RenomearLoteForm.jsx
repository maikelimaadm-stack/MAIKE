import React, { useState } from "react";
import {
  listarTodasMovimentacoes,
  atualizarLote,
  criarMovimentacao,
} from "@/services/loteManejoService";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Undo2 } from "lucide-react";
import { toast } from "sonner";
import { LancLoteForm, LancLoteRodape, LancLoteAviso, LL_CTL } from "@/components/lotes/LancamentoLoteUi";
import LancField from "@/components/cadastro/base1/LancField";

/** Campo flutuante Base1 (rótulo dentro) — D-PROD-88. */
const FL = LancField;

export default function RenomearLoteForm({ lote, novoNome, onNovoNomeChange, empresaSelecionadaId, areas, onClose, onCancel }) {
  const [loading, setLoading] = useState(false);
  const [dataRenomeacao, setDataRenomeacao] = useState(() => new Date().toISOString().split('T')[0]);

  // Buscar movimentações de renomear deste lote para permitir reverter
  const { data: renomeacoes = [] } = useQuery({
    queryKey: ['renomeacoes-lote', lote.id],
    queryFn: async () => {
      const all = await listarTodasMovimentacoes();
      return all.filter(m =>
        m.empresa_id === empresaSelecionadaId &&
        m.lote_id === lote.id &&
        m.motivo === 'Renomear Lote' &&
        m.situacao !== 'cancelado'
      ).sort((a, b) => new Date(b.data_movimentacao) - new Date(a.data_movimentacao));
    },
    enabled: !!lote.id,
  });

  // Extrair o nome original da observação mais antiga
  const nomeOriginal = (() => {
    if (renomeacoes.length === 0) return null;
    const maisAntiga = renomeacoes[renomeacoes.length - 1];
    const match = maisAntiga.observacoes?.match(/Renomear Lote: "(.+?)" →/);
    return match ? match[1] : null;
  })();

  const handleSalvar = async () => {
    if (!novoNome.trim() || !dataRenomeacao) return;
    setLoading(true);
    const nomeAnterior = lote.nome;
    await atualizarLote(lote.id, { nome: novoNome.trim() });
    
    const areaAtualId = lote.area_atual_id;
    const areaRen = areas.find(a => a.id === areaAtualId);
    await criarMovimentacao({
      empresa_id: empresaSelecionadaId,
      data_movimentacao: `${dataRenomeacao}T12:00:00.000Z`,
      tipo: 'Entrada',
      motivo: 'Renomear Lote',
      lote: novoNome.trim(),
      lote_id: lote.id,
      quantidade_animais: lote.quantidade_cabecas || 0,
      area_origem_id: areaAtualId,
      area_origem_nome: areaRen?.nome || '',
      observacoes: `Renomear Lote: "${nomeAnterior}" → "${novoNome.trim()}"`
    });
    
    toast.success('Lote renomeado!');
    setLoading(false);
    onClose();
  };

  // R2A (D-PROD-99): "reverter" apagava TODAS as renomeações em laço, sem
  // transação. Agora volta ao nome original por uma renomeação NORMAL nova
  // (registro novo, histórico preservado): o botão só preenche o campo.
  const usarNomeOriginal = () => {
    if (nomeOriginal) onNovoNomeChange(nomeOriginal);
  };

  return (
    <LancLoteForm onSubmit={(e) => { e.preventDefault(); if (!loading) handleSalvar(); }}>
      <p className="mk-ll__texto">Lote atual: <strong>{lote.nome}</strong></p>

      {nomeOriginal && nomeOriginal !== lote.nome && (
        <LancLoteAviso tom="ambar">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span>Nome original: <strong>{nomeOriginal}</strong></span>
            <button type="button" className="mk-ll__opcao !inline-flex !w-auto !min-h-[30px] gap-1" onClick={usarNomeOriginal} disabled={loading}>
              <Undo2 className="h-3.5 w-3.5" aria-hidden />
              Usar nome original
            </button>
          </div>
          <p className="text-[11px]">Salvar cria uma nova renomeação; as anteriores continuam no histórico.</p>
        </LancLoteAviso>
      )}

      <div className="mk-ll__grade">
        <FL label="Novo nome">
          <Input value={novoNome} onChange={e => onNovoNomeChange(e.target.value)} className={LL_CTL} />
        </FL>
        <FL label="Data" required>
          <Input type="date" value={dataRenomeacao} onChange={e => setDataRenomeacao(e.target.value)} className={LL_CTL} />
        </FL>
      </div>
      <LancLoteRodape onCancelar={onCancel} cancelarDesabilitado={loading} textoAcao="Salvar" textoEnviando="Salvando..." enviando={loading} />
    </LancLoteForm>
  );
}
