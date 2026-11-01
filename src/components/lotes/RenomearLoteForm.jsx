import React, { useState } from "react";
import {
  listarTodasMovimentacoes,
  atualizarLote,
  criarMovimentacao,
} from "@/services/loteManejoService";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Undo2 } from "lucide-react";
import { toast } from "sonner";
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
    <div className="space-y-3">
      <p className="text-xs text-slate-600">Lote atual: <strong>{lote.nome}</strong></p>

      {nomeOriginal && nomeOriginal !== lote.nome && (
        <div className="p-2 bg-amber-50 border border-amber-200 rounded-md">
          <div className="text-xs text-amber-800 mb-2">
            Nome original: <Badge variant="outline" className="ml-1 text-xs">{nomeOriginal}</Badge>
          </div>
          <Button 
            variant="outline" 
            size="sm" 
            className="h-7 text-xs gap-1 border-amber-300 text-amber-700 hover:bg-amber-100"
            onClick={usarNomeOriginal}
            disabled={loading}
          >
            <Undo2 className="w-3 h-3" />
            Usar nome original
          </Button>
          <p className="mt-1 text-[10px] text-amber-700">
            Salvar cria uma nova renomeação; as anteriores continuam no histórico.
          </p>
        </div>
      )}

      <FL label="Novo nome">
        <Input value={novoNome} onChange={e => onNovoNomeChange(e.target.value)} className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" />
      </FL>
      <FL label="Data" required>
        <Input type="date" value={dataRenomeacao} onChange={e => setDataRenomeacao(e.target.value)} className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" />
      </FL>
      <div className="flex justify-end gap-1">
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onCancel} disabled={loading}>Cancelar</Button>
        <Button size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white" onClick={handleSalvar} disabled={loading}>
          {loading ? 'Salvando...' : 'Salvar'}
        </Button>
      </div>
    </div>
  );
}