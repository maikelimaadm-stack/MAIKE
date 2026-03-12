import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Edit2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  putItem,
  deleteItem,
  saveUpdateOffline,
  STORES_NAMES,
} from "../offline/IndexedDBManager";

export default function GerenciarApartacoesDialog({ open, onOpenChange, empresaId, apartacoes, lotes, pesagens, onRefresh, dbReady }) {
  const [tab, setTab] = useState('apartacoes');
  const [isSaving, setIsSaving] = useState(false);
  const [nomeApartacao, setNomeApartacao] = useState("");
  const [editingApartacaoId, setEditingApartacaoId] = useState(null);
  const [apartacaoIdLote, setApartacaoIdLote] = useState("");
  const [nomeLote, setNomeLote] = useState("");
  const [qtdMaxima, setQtdMaxima] = useState("500");
  const [pesoMinimo, setPesoMinimo] = useState("");
  const [pesoMaximo, setPesoMaximo] = useState("");
  const [editingLoteId, setEditingLoteId] = useState(null);
  const [progressoAtualizacao, setProgressoAtualizacao] = useState({ show: false, current: 0, total: 0, texto: "" });

  const lotesFiltrados = useMemo(() => {
    if (!apartacaoIdLote) return lotes;
    return lotes.filter((l) => l.apartacao_id === apartacaoIdLote);
  }, [lotes, apartacaoIdLote]);

  const salvarApartacao = async () => {
    if (isSaving) return;
    if (!nomeApartacao.trim()) { toast.error("Nome obrigatório"); return; }
    const nomeNormalizado = nomeApartacao.trim().toUpperCase();
    const duplicado = apartacoes.find((a) => a.nome_apartacao.toUpperCase() === nomeNormalizado && a.id !== editingApartacaoId);
    if (duplicado) { toast.error("Já existe uma apartação com esse nome!"); return; }

    setIsSaving(true);
    const data = { empresa_id: empresaId, nome_apartacao: nomeApartacao.trim() };

    try {
      if (navigator.onLine) {
        if (editingApartacaoId) {
          await base44.entities.Apartacao.update(editingApartacaoId, data);
          const todosLotes = await base44.entities.LoteApartacao.filter({ apartacao_id: editingApartacaoId });
          if (todosLotes.length > 0) {
            setProgressoAtualizacao({ show: true, current: 0, total: todosLotes.length, texto: "Atualizando lotes..." });
            const batchSize = 5;
            for (let i = 0; i < todosLotes.length; i += batchSize) {
              const batch = todosLotes.slice(i, i + batchSize);
              await Promise.all(batch.map(l => base44.entities.LoteApartacao.update(l.id, { nome_apartacao: nomeApartacao.trim() })));
              setProgressoAtualizacao(prev => ({ ...prev, current: Math.min(i + batchSize, todosLotes.length), texto: `Atualizando ${Math.min(i + batchSize, todosLotes.length)} de ${todosLotes.length} lotes...` }));
            }
            setProgressoAtualizacao({ show: false, current: 0, total: 0, texto: "" });
          }
          toast.success(`Apartação atualizada! ${todosLotes.length} lotes atualizados.`);
        } else {
          await base44.entities.Apartacao.create(data);
          toast.success("Apartação criada!");
        }
      } else {
        if (editingApartacaoId) {
          if (dbReady) {
            await saveUpdateOffline('Apartacao', editingApartacaoId, data);
            await putItem(STORES_NAMES.APARTACOES, { ...apartacoes.find(a => a.id === editingApartacaoId), ...data });
            toast.success("💾 Edição salva offline!");
          } else { toast.error("IndexedDB não disponível"); setIsSaving(false); return; }
          setNomeApartacao(""); setEditingApartacaoId(null); onRefresh(); setIsSaving(false); return;
        }
        const offlineId = `offline_apt_${Date.now()}`;
        if (dbReady) await putItem(STORES_NAMES.APARTACOES, { ...data, id: offlineId, _isOffline: true, _offlineTimestamp: new Date().toISOString() });
        toast.success("💾 Apartação salva offline!");
      }
      setNomeApartacao(""); setEditingApartacaoId(null); onRefresh();
    } catch (error) { toast.error('Erro: ' + error.message); }
    finally { setIsSaving(false); setProgressoAtualizacao({ show: false, current: 0, total: 0, texto: "" }); }
  };

  const salvarLote = async () => {
    if (isSaving) return;
    if (!apartacaoIdLote) { toast.error("Selecione uma apartação"); return; }
    if (!nomeLote.trim()) { toast.error("Nome do lote obrigatório"); return; }
    if (!pesoMinimo || !pesoMaximo) { toast.error("Peso mínimo e máximo obrigatórios"); return; }
    if (parseFloat(pesoMinimo) > parseFloat(pesoMaximo)) { toast.error("Peso mínimo não pode ser maior que o máximo"); return; }
    const nomeNormalizado = nomeLote.trim().toUpperCase();
    const duplicado = lotes.find((l) => l.apartacao_id === apartacaoIdLote && l.nome_lote.toUpperCase() === nomeNormalizado && l.id !== editingLoteId);
    if (duplicado) { toast.error("Já existe um lote com esse nome nesta apartação!"); return; }

    setIsSaving(true);
    const apt = apartacoes.find((a) => a.id === apartacaoIdLote);
    const data = { empresa_id: empresaId, apartacao_id: apartacaoIdLote, nome_apartacao: apt?.nome_apartacao || "", nome_lote: nomeLote.trim(), quantidade_maxima: parseInt(qtdMaxima) || 500, peso_minimo: parseFloat(pesoMinimo), peso_maximo: parseFloat(pesoMaximo), fechado: false };

    try {
      if (navigator.onLine) {
        if (editingLoteId) { await base44.entities.LoteApartacao.update(editingLoteId, data); toast.success("Lote atualizado!"); }
        else { await base44.entities.LoteApartacao.create(data); toast.success("Lote criado!"); }
      } else {
        if (editingLoteId) {
          if (dbReady) { await saveUpdateOffline('LoteApartacao', editingLoteId, data); await putItem(STORES_NAMES.LOTES, { ...lotes.find(l => l.id === editingLoteId), ...data }); toast.success("💾 Edição salva offline!"); }
          else { toast.error("IndexedDB não disponível"); setIsSaving(false); return; }
          setNomeLote(""); setQtdMaxima("500"); setPesoMinimo(""); setPesoMaximo(""); setEditingLoteId(null); onRefresh(); setIsSaving(false); return;
        }
        const offlineId = `offline_lote_${Date.now()}`;
        if (dbReady) await putItem(STORES_NAMES.LOTES, { ...data, id: offlineId, _isOffline: true, _offlineTimestamp: new Date().toISOString() });
        toast.success("💾 Lote salvo offline!");
      }
      setNomeLote(""); setQtdMaxima("500"); setPesoMinimo(""); setPesoMaximo(""); setEditingLoteId(null); onRefresh();
    } catch (error) { toast.error('Erro: ' + error.message); }
    finally { setIsSaving(false); }
  };

  const excluirApartacao = async (id) => {
    const pesagensVinculadas = pesagens.filter((p) => p.apartacao_id === id);
    const lotesVinculados = lotes.filter((l) => l.apartacao_id === id);
    if (pesagensVinculadas.length > 0) { alert(`Esta apartação possui ${pesagensVinculadas.length} pesagens vinculadas. Remova-as primeiro.`); return; }
    if (!confirm(`Excluir esta apartação e ${lotesVinculados.length} lote(s)?`)) return;
    if (id.startsWith('offline_')) {
      if (dbReady) { await deleteItem(STORES_NAMES.APARTACOES, id); for (const l of lotesVinculados) await deleteItem(STORES_NAMES.LOTES, l.id); }
      toast.success("Removida!"); onRefresh(); return;
    }
    if (navigator.onLine) { for (const l of lotesVinculados) { if (!l.id.startsWith('offline_')) await base44.entities.LoteApartacao.delete(l.id); } await base44.entities.Apartacao.delete(id); toast.success("Excluída!"); onRefresh(); }
    else toast.error("Requer conexão");
  };

  const excluirLote = async (id) => {
    const pesagensVinculadas = pesagens.filter((p) => p.lote_id === id);
    const loteInfo = lotes.find((l) => l.id === id);
    if (pesagensVinculadas.length > 0) { alert(`Lote "${loteInfo?.nome_lote}" possui ${pesagensVinculadas.length} pesagens vinculadas.`); return; }
    if (!confirm(`Excluir lote "${loteInfo?.nome_lote}"?`)) return;
    if (id.startsWith('offline_')) { if (dbReady) await deleteItem(STORES_NAMES.LOTES, id); toast.success("Removido!"); onRefresh(); return; }
    if (navigator.onLine) { await base44.entities.LoteApartacao.delete(id); toast.success("Excluído!"); onRefresh(); } else toast.error("Requer conexão");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader><DialogTitle>Gerenciar Apartações e Lotes</DialogTitle></DialogHeader>
        <div className="flex gap-2 border-b pb-2">
          <Button variant={tab === 'apartacoes' ? 'default' : 'outline'} size="sm" onClick={() => setTab('apartacoes')}>Apartações</Button>
          <Button variant={tab === 'lotes' ? 'default' : 'outline'} size="sm" onClick={() => setTab('lotes')}>Lotes</Button>
        </div>
        <div className="flex-1 overflow-auto">
          {tab === 'apartacoes' ? (
            <div className="space-y-3">
              <div className="flex gap-2 items-end bg-slate-50 p-3 rounded">
                <div className="flex-1 space-y-1">
                  <Label className="text-xs">Nome da Apartação</Label>
                  <Input value={nomeApartacao} onChange={(e) => setNomeApartacao(e.target.value)} className="h-9 text-sm" placeholder="Ex: ROTINA" />
                </div>
                <Button onClick={salvarApartacao} disabled={isSaving} size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
                  {isSaving ? 'Salvando...' : editingApartacaoId ? 'Atualizar' : 'Adicionar'}
                </Button>
                {editingApartacaoId && <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => {setEditingApartacaoId(null);setNomeApartacao("");}}>Cancelar</Button>}
              </div>
              {progressoAtualizacao.show && (
                <div className="bg-blue-50 border border-blue-200 rounded p-3 mb-3">
                  <div className="flex justify-between text-xs text-blue-800 mb-1"><span>{progressoAtualizacao.texto}</span><span className="font-bold">{Math.round(progressoAtualizacao.current / progressoAtualizacao.total * 100)}%</span></div>
                  <div className="w-full bg-blue-200 rounded-full h-2"><div className="bg-blue-600 h-2 rounded-full transition-all" style={{ width: `${progressoAtualizacao.current / progressoAtualizacao.total * 100}%` }} /></div>
                </div>
              )}
              <Table>
                <TableHeader><TableRow><TableHead className="text-xs">Nome</TableHead><TableHead className="text-xs text-center">Lotes</TableHead><TableHead className="text-xs text-center">Pesagens</TableHead><TableHead className="text-xs w-24">Ações</TableHead></TableRow></TableHeader>
                <TableBody>
                  {apartacoes.map((a) => {
                    const qtdLotes = lotes.filter((l) => l.apartacao_id === a.id).length;
                    const qtdPesagens = pesagens.filter((p) => p.apartacao_id === a.id).length;
                    return (
                      <TableRow key={a.id}>
                        <TableCell className="text-xs font-medium">{a.nome_apartacao}</TableCell>
                        <TableCell className="text-xs text-center">{qtdLotes}</TableCell>
                        <TableCell className="text-xs text-center">{qtdPesagens > 0 ? <Badge variant="outline" className="text-[10px]">{qtdPesagens}</Badge> : '-'}</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => {setNomeApartacao(a.nome_apartacao);setEditingApartacaoId(a.id);}}><Edit2 className="w-3 h-3" /></Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={() => excluirApartacao(a.id)}><Trash2 className="w-3 h-3" /></Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {apartacoes.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-xs text-slate-400 py-6">Nenhuma apartação cadastrada</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-6 gap-2 items-end bg-slate-50 p-3 rounded">
                <div className="space-y-1"><Label className="text-xs">Apartação</Label><Select value={apartacaoIdLote} onValueChange={setApartacaoIdLote}><SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{apartacoes.map((a) => <SelectItem key={a.id} value={a.id}>{a.nome_apartacao}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-1"><Label className="text-xs">Nome Lote</Label><Input value={nomeLote} onChange={(e) => setNomeLote(e.target.value)} className="h-9 text-xs" placeholder="Ex: BOIADA" /></div>
                <div className="space-y-1"><Label className="text-xs">Qtd Máx</Label><Input type="number" value={qtdMaxima} onChange={(e) => setQtdMaxima(e.target.value)} className="h-9 text-xs" /></div>
                <div className="space-y-1"><Label className="text-xs">Peso Mín</Label><Input type="number" value={pesoMinimo} onChange={(e) => setPesoMinimo(e.target.value)} className="h-9 text-xs" /></div>
                <div className="space-y-1"><Label className="text-xs">Peso Máx</Label><Input type="number" value={pesoMaximo} onChange={(e) => setPesoMaximo(e.target.value)} className="h-9 text-xs" /></div>
                <div className="flex gap-1">
                  <Button onClick={salvarLote} disabled={isSaving} size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">{isSaving ? 'Salvando...' : editingLoteId ? 'Atualizar' : 'Adicionar'}</Button>
                  {editingLoteId && <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => {setEditingLoteId(null);setNomeLote("");setQtdMaxima("500");setPesoMinimo("");setPesoMaximo("");}}>Cancelar</Button>}
                </div>
              </div>
              <Table>
                <TableHeader><TableRow><TableHead className="text-xs">Apartação</TableHead><TableHead className="text-xs">Lote</TableHead><TableHead className="text-xs text-center">Qtd Máx</TableHead><TableHead className="text-xs text-center">Peso Mín</TableHead><TableHead className="text-xs text-center">Peso Máx</TableHead><TableHead className="text-xs text-center">Pesagens</TableHead><TableHead className="text-xs w-24">Ações</TableHead></TableRow></TableHeader>
                <TableBody>
                  {lotesFiltrados.map((l) => {
                    const qtdPesagens = pesagens.filter((p) => p.lote_id === l.id).length;
                    return (
                      <TableRow key={l.id}>
                        <TableCell className="text-xs">{l.nome_apartacao}</TableCell>
                        <TableCell className="text-xs font-medium">{l.nome_lote}</TableCell>
                        <TableCell className="text-xs text-center">{l.quantidade_maxima}</TableCell>
                        <TableCell className="text-xs text-center">{l.peso_minimo}</TableCell>
                        <TableCell className="text-xs text-center">{l.peso_maximo}</TableCell>
                        <TableCell className="text-xs text-center">{qtdPesagens > 0 ? <Badge variant="outline" className="text-[10px]">{qtdPesagens}</Badge> : '-'}</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => {setApartacaoIdLote(l.apartacao_id);setNomeLote(l.nome_lote);setQtdMaxima(String(l.quantidade_maxima));setPesoMinimo(String(l.peso_minimo));setPesoMaximo(String(l.peso_maximo));setEditingLoteId(l.id);}}><Edit2 className="w-3 h-3" /></Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={() => excluirLote(l.id)}><Trash2 className="w-3 h-3" /></Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {lotesFiltrados.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-xs text-slate-400 py-6">{apartacaoIdLote ? 'Nenhum lote nesta apartação' : 'Selecione uma apartação'}</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}