import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Undo2 } from "lucide-react";
import { toast } from "sonner";

const FL = ({ label, required, children }) => (
  <div>
    <label className="text-[12px] text-slate-500 pl-1 leading-none">
      {label}{required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
    <div className="rounded-md border border-slate-300 focus-within:border-emerald-500 transition-colors">
      {children}
    </div>
  </div>
);

export default function RenomearLoteForm({ lote, novoNome, onNovoNomeChange, empresaSelecionadaId, areas, onClose, onCancel }) {
  const [loading, setLoading] = useState(false);

  // Buscar movimentações de renomear deste lote para permitir reverter
  const { data: renomeacoes = [] } = useQuery({
    queryKey: ['renomeacoes-lote', lote.id],
    queryFn: async () => {
      const all = await base44.entities.MovimentacaoMapa.list();
      return all.filter(m =>
        m.empresa_id === empresaSelecionadaId &&
        m.lote_id === lote.id &&
        m.motivo === 'Renomear Lote'
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
    if (!novoNome.trim()) return;
    setLoading(true);
    const nomeAnterior = lote.nome;
    await base44.entities.Lote.update(lote.id, { nome: novoNome.trim() });
    
    const areaAtualId = lote.area_atual_id;
    const areaRen = areas.find(a => a.id === areaAtualId);
    await base44.entities.MovimentacaoMapa.create({
      empresa_id: empresaSelecionadaId,
      data_movimentacao: new Date().toISOString(),
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

  const handleReverter = async () => {
    if (!nomeOriginal) return;
    if (!confirm(`Reverter o nome do lote para "${nomeOriginal}"? Todas as renomeações serão excluídas.`)) return;
    
    setLoading(true);
    // Voltar ao nome original
    await base44.entities.Lote.update(lote.id, { nome: nomeOriginal });
    
    // Excluir todas as movimentações de renomear deste lote
    for (const ren of renomeacoes) {
      await base44.entities.MovimentacaoMapa.delete(ren.id);
    }
    
    toast.success(`Nome revertido para "${nomeOriginal}"`);
    setLoading(false);
    onClose();
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-600">Lote atual: <strong>{lote.nome}</strong></p>

      {nomeOriginal && nomeOriginal !== lote.nome && (
        <div className="p-2 bg-amber-50 border border-amber-200 rounded-md">
          <p className="text-xs text-amber-800 mb-2">
            Nome original: <Badge variant="outline" className="ml-1 text-xs">{nomeOriginal}</Badge>
          </p>
          <Button 
            variant="outline" 
            size="sm" 
            className="h-7 text-xs gap-1 border-amber-300 text-amber-700 hover:bg-amber-100"
            onClick={handleReverter}
            disabled={loading}
          >
            <Undo2 className="w-3 h-3" />
            Reverter para nome original
          </Button>
        </div>
      )}

      <FL label="Novo nome">
        <Input value={novoNome} onChange={e => onNovoNomeChange(e.target.value)} className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" />
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