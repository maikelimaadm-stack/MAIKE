import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Settings, Download, Upload } from "lucide-react";
import { toast } from "sonner";
import { AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import TabelaMovimentacoesPecuaria from "@/components/movimentacoes-pecuaria/TabelaMovimentacoesPecuaria";
import FormularioLancamentoManual from "@/components/pecuaria/FormularioLancamentoManual";
import SaldoCategorias from "@/components/pecuaria/SaldoCategorias";

const formatarDataSimples = (d) => {
  if (!d) return "-";
  const date = new Date(d);
  if (isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("pt-BR");
};

export default function HistoricoMovimentacoesPecuaria() {
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");
  const queryClient = useQueryClient();

  const [showForm, setShowForm] = useState(false);
  const [showConfigColunas, setShowConfigColunas] = useState(false);
  const [itemEditandoManual, setItemEditandoManual] = useState(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);

  // Edição rápida
  const [showEditRapido, setShowEditRapido] = useState(false);
  const [editando, setEditando] = useState(null);

  // Importação
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0, isImporting: false });

  const { data: movimentacoes = [], refetch } = useQuery({
    queryKey: ["movimentacoes-pecuaria", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.MovimentacaoPecuaria.list("-created_date");
      return all.filter((m) => m.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: setores = [] } = useQuery({
    queryKey: ["setores", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Setor.list();
      return all.filter((s) => s.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: areas = [] } = useQuery({
    queryKey: ["areas-pastagem"],
    queryFn: () => base44.entities.AreaPastagem.list(),
    initialData: [],
  });

  const expandirIdsExclusao = (ids) => {
    return Array.from(
      new Set(
        ids.flatMap((id) => {
          const reg = movimentacoes.find((m) => m.id === id);
          if (!reg?.vinculo_mudanca_categoria) return [id];
          const rel = movimentacoes.find((m) => m.vinculo_mudanca_categoria === reg.vinculo_mudanca_categoria && m.id !== id);
          return [id, rel?.id].filter(Boolean);
        })
      )
    );
  };

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      const registro = movimentacoes.find((m) => m.id === id);
      await base44.entities.MovimentacaoPecuaria.update(id, data);
      if (registro?.vinculo_mudanca_categoria && data.quantidade_animais !== undefined) {
        const vinculado = movimentacoes.find((m) => m.vinculo_mudanca_categoria === registro.vinculo_mudanca_categoria && m.id !== id);
        if (vinculado) {
          await base44.entities.MovimentacaoPecuaria.update(vinculado.id, { quantidade_animais: data.quantidade_animais, peso_medio: data.peso_medio, peso_total: data.peso_total });
        }
        return { updatedCount: 2 };
      }
      return { updatedCount: 1 };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["movimentacoes-pecuaria"] });
      toast.success(result?.updatedCount === 2 ? "Mudança de categoria atualizada (saída + entrada)" : "Movimentação atualizada");
      setShowEditRapido(false);
      setEditando(null);
    },
    onError: () => toast.error("Erro ao atualizar movimentação"),
  });

  const handleDelete = (id) => {
    const ids = expandirIdsExclusao([id]);
    setDeleteConfirmId(ids);
  };

  const confirmDelete = async () => {
    if (!deleteConfirmId?.length) return;
    for (const id of deleteConfirmId) {
      await base44.entities.MovimentacaoPecuaria.delete(id);
    }
    queryClient.invalidateQueries({ queryKey: ["movimentacoes-pecuaria"] });
    toast.success(deleteConfirmId.length > 1 ? "Movimentações excluídas" : "Movimentação excluída");
    setDeleteConfirmId(null);
  };

  const handleEditCompleto = (mov) => {
    setItemEditandoManual(mov);
    setShowForm(true);
  };

  const handleEditRapido = (mov) => {
    setEditando({ ...mov });
    setShowEditRapido(true);
  };

  const handleDuplicar = (mov) => {
    const { id, numero_movimentacao, created_date, updated_date, created_by, ...dados } = mov;
    setItemEditandoManual({ ...dados, data_movimentacao: new Date().toISOString(), _isDuplicate: true });
    setShowForm(true);
  };

  const handleSaveEditRapido = () => {
    if (!editando) return;
    updateMutation.mutate({
      id: editando.id,
      data: { data_movimentacao: editando.data_movimentacao, quantidade_animais: editando.quantidade_animais, peso_medio: editando.peso_medio, observacoes: editando.observacoes },
    });
  };

  const handleExport = () => {
    const csvRows = [];
    const headers = ["Data", "Tipo", "Motivo", "Quantidade", "Categoria", "Marca", "Sexo", "Peso Médio", "Peso Total", "Área", "Fornecedor/Comprador", "Valor Unitário", "Valor Total", "NF", "GTA", "Causa Morte", "Transferência Origem", "Transferência Destino", "Observações"];
    csvRows.push(headers.join(";"));
    movimentacoes.forEach((m) => {
      const area = m.tipo === "Entrada" ? m.area_destino_nome : m.area_origem_nome;
      csvRows.push([formatarDataSimples(m.data_movimentacao), m.tipo || "", m.motivo || "", m.quantidade_animais || "", m.categoria_animal || "", m.marca || "", m.sexo || "", m.peso_medio || "", m.peso_total || "", area || "", m.fornecedor_origem || m.destino_venda || "", m.valor_unitario || "", m.valor_total || "", m.nota_fiscal || "", m.gta || "", m.causa_morte || "", m.transferencia_origem || "", m.transferencia_destino || "", m.observacoes || ""].join(";"));
    });
    const blob = new Blob(["\ufeff" + csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `movimentacoes_pecuaria_${format(new Date(), "yyyy-MM-dd_HH-mm")}.csv`;
    link.click();
    toast.success("Exportado com sucesso!");
  };

  const handleDownloadTemplate = () => {
    const headers = ["Data", "Tipo", "Motivo", "Quantidade", "Categoria", "Marca", "Sexo", "Peso Médio", "Setor", "Área", "Fornecedor/Comprador", "Valor Unitário", "Valor Total", "NF", "GTA", "Causa Morte", "Transferência Origem", "Transferência Destino", "Observações"];
    const exemplo = ["01/01/2025", "Entrada", "Compra", "50", "Bezerro(a)", "NELORE", "Macho", "180", "Fazenda Santa Maria", "Pasto 1", "Fazenda XYZ", "1500", "75000", "12345", "67890", "", "", "", "Lote de bezerros"];
    const blob = new Blob(["\ufeff" + [headers.join(";"), exemplo.join(";")].join("\n")], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "modelo_importacao_movimentacoes_pecuaria.csv";
    link.click();
    toast.success("Modelo baixado!");
  };

  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      const text = event.target?.result;
      const lines = text.split("\n").filter((l) => l.trim());
      if (lines.length < 2) { toast.error("Arquivo vazio"); return; }
      const headers = lines[0].split(";").map((h) => h.trim().toLowerCase());
      const dataLines = lines.slice(1);
      const validRecords = [];
      for (let i = 0; i < dataLines.length; i++) {
        const values = dataLines[i].split(";").map((v) => v.trim().replace(/^"|"$/g, ""));
        const tipo = values[headers.indexOf("tipo")] || "";
        const quantidade = parseInt(values[headers.indexOf("quantidade")]) || 0;
        if (!tipo || !["Entrada", "Saída"].includes(tipo) || quantidade <= 0) continue;
        const dataStr = values[headers.indexOf("data")] || "";
        let dataMovStr;
        if (dataStr) {
          const parts = dataStr.split("/");
          if (parts.length === 3) { dataMovStr = `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}T12:00:00`; }
          else { const p = new Date(dataStr); dataMovStr = !isNaN(p.getTime()) ? p.toISOString() : new Date().toISOString(); }
        } else { dataMovStr = new Date().toISOString(); }
        const record = {
          tipo, motivo: values[headers.indexOf("motivo")] || "", data_movimentacao: dataMovStr, quantidade_animais: quantidade,
          categoria_animal: values[headers.indexOf("categoria")] || null, marca: values[headers.indexOf("marca")] || null, sexo: values[headers.indexOf("sexo")] || null,
          peso_medio: parseFloat(values[headers.indexOf("peso médio")]) || null,
          fornecedor_origem: tipo === "Entrada" ? values[headers.indexOf("fornecedor/comprador")] || null : null,
          destino_venda: tipo === "Saída" ? values[headers.indexOf("fornecedor/comprador")] || null : null,
          valor_unitario: parseFloat(values[headers.indexOf("valor unitário")]) || null, valor_total: parseFloat(values[headers.indexOf("valor total")]) || null,
          nota_fiscal: values[headers.indexOf("nf")] || null, gta: values[headers.indexOf("gta")] || null,
          causa_morte: values[headers.indexOf("causa morte")] || null, observacoes: values[headers.indexOf("observações")] || null,
        };
        const setorNome = values[headers.indexOf("setor")] || "";
        if (setorNome) { const s = setores.find((s) => s.nome?.toLowerCase() === setorNome.toLowerCase()); if (s) { record.setor_id = s.id; record.setor_nome = s.nome; } }
        const areaNome = values[headers.indexOf("área")] || "";
        if (areaNome) { const a = areas.find((a) => a.nome?.toLowerCase() === areaNome.toLowerCase()); if (a) { if (tipo === "Entrada") { record.area_destino_id = a.id; record.area_destino_nome = a.nome; } else { record.area_origem_id = a.id; record.area_origem_nome = a.nome; } } }
        validRecords.push(record);
      }
      if (validRecords.length > 0) {
        setImportProgress({ current: 0, total: validRecords.length, isImporting: true });
        const allMovs = await base44.entities.MovimentacaoPecuaria.list();
        let maxNum = allMovs.reduce((max, m) => Math.max(max, parseInt(m.numero_movimentacao) || 0), 0);
        for (let i = 0; i < validRecords.length; i++) {
          maxNum++;
          await base44.entities.MovimentacaoPecuaria.create({ ...validRecords[i], empresa_id: empresaSelecionadaId, numero_movimentacao: String(maxNum) });
          setImportProgress((p) => ({ ...p, current: i + 1 }));
        }
        setImportProgress({ current: 0, total: 0, isImporting: false });
        queryClient.invalidateQueries({ queryKey: ["movimentacoes-pecuaria"] });
        toast.success(`${validRecords.length} registro(s) importado(s)!`);
      } else { toast.error("Nenhum registro válido encontrado"); }
      e.target.value = "";
    };
    reader.readAsText(file, "UTF-8");
  };

  return (
    <div className="p-1 md:p-1 space-y-1">
      {!showForm && (
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 bg-white rounded px-1 py-1 shadow-sm border-b border-slate-200">
          <div>
            <h1 className="font-bold text-slate-800">Histórico de Movimentações</h1>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="icon" onClick={() => setShowConfigColunas(true)} className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground h-7 w-7">
              <Settings className="w-4 h-4" />
            </Button>
            <Button onClick={handleExport} variant="outline" size="sm" className="h-7 text-xs gap-1">
              <Download className="w-3.5 h-3.5" /> Exportar
            </Button>
            <Button onClick={handleDownloadTemplate} variant="outline" size="sm" className="h-7 text-xs">Modelo</Button>
            <label>
              <Button variant="outline" size="sm" className="h-7 text-xs cursor-pointer gap-1" asChild>
                <span><Upload className="w-3.5 h-3.5" /> Importar</span>
              </Button>
              <input type="file" accept=".csv" onChange={handleImportFile} className="hidden" />
            </label>
            <Button
              onClick={() => { setItemEditandoManual(null); setShowForm(true); }}
              size="sm"
              className="bg-lime-900 text-primary-foreground px-3 text-xs font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 shadow h-7 hover:bg-emerald-600"
            >
              Adicionar
            </Button>
          </div>
        </div>
      )}
      <AnimatePresence mode="wait">
        {showForm ? (
          <FormularioLancamentoManual
            item={itemEditandoManual}
            onSave={() => {
              setShowForm(false);
              setItemEditandoManual(null);
              queryClient.invalidateQueries({ queryKey: ["movimentacoes-pecuaria"] });
            }}
            onCancel={() => { setShowForm(false); setItemEditandoManual(null); }}
          />
        ) : (
          <>
            <SaldoCategorias movimentacoes={movimentacoes} categoriasManejo={[]} />
            <TabelaMovimentacoesPecuaria
              movimentacoes={movimentacoes}
              onEditCompleto={handleEditCompleto}
              onEditRapido={handleEditRapido}
              onDuplicar={handleDuplicar}
              onDelete={handleDelete}
              showConfigColunas={showConfigColunas}
              setShowConfigColunas={setShowConfigColunas}
            />
          </>
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={!!deleteConfirmId}
        onOpenChange={(open) => !open && setDeleteConfirmId(null)}
        title="Excluir movimentação"
        description={deleteConfirmId?.length > 1 ? `Tem certeza que deseja excluir ${deleteConfirmId.length} movimentações? Esta ação não pode ser desfeita.` : "Tem certeza que deseja excluir esta movimentação? Esta ação não pode ser desfeita."}
        onConfirm={confirmDelete}
        confirmText="Excluir"
        cancelText="Cancelar"
        variant="destructive"
      />

      {/* Edição rápida */}
      <Dialog open={showEditRapido} onOpenChange={setShowEditRapido}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Editar Movimentação</DialogTitle></DialogHeader>
          {editando && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-md border border-gray-300 px-2 pt-1 pb-1">
                  <label className="text-[12px] text-slate-500 pl-1 leading-none">Data<span className="text-red-500 ml-0.5">*</span></label>
                  <Input type="date" value={editando.data_movimentacao?.split("T")[0] || ""} onChange={(e) => setEditando({ ...editando, data_movimentacao: e.target.value })} className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" />
                </div>
                <div className="rounded-md border border-gray-300 px-2 pt-1 pb-1">
                  <label className="text-[12px] text-slate-500 pl-1 leading-none">Qtd Animais<span className="text-red-500 ml-0.5">*</span></label>
                  <Input type="number" value={editando.quantidade_animais || ""} onChange={(e) => setEditando({ ...editando, quantidade_animais: parseInt(e.target.value) || 0 })} className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" />
                </div>
              </div>
              {editando.peso_medio !== undefined && (
                <div className="rounded-md border border-gray-300 px-2 pt-1 pb-1">
                  <label className="text-[12px] text-slate-500 pl-1 leading-none">Peso Médio (kg)</label>
                  <Input type="number" step="0.1" value={editando.peso_medio || ""} onChange={(e) => setEditando({ ...editando, peso_medio: parseFloat(e.target.value) || null })} className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" />
                </div>
              )}
              <div className="rounded-md border border-gray-300 px-2 pt-1 pb-1">
                <label className="text-[12px] text-slate-500 pl-1 leading-none">Observações</label>
                <Textarea value={editando.observacoes || ""} onChange={(e) => setEditando({ ...editando, observacoes: e.target.value })} className="text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" style={{ textTransform: "uppercase" }} rows={3} />
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t">
                <Button onClick={() => setShowEditRapido(false)} variant="outline" size="sm" className="h-8 text-xs">Cancelar</Button>
                <Button onClick={handleSaveEditRapido} size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">Salvar Alterações</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Progresso importação */}
      <Dialog open={importProgress.isImporting} onOpenChange={() => {}}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="text-sm">Importando Movimentações...</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">Progresso</span>
                <span className="font-semibold text-slate-900">{importProgress.current} de {importProgress.total}</span>
              </div>
              <Progress value={importProgress.total ? (importProgress.current / importProgress.total) * 100 : 0} className="h-3" />
              <p className="text-center text-sm font-medium text-emerald-600">{importProgress.total ? Math.round((importProgress.current / importProgress.total) * 100) : 0}%</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}