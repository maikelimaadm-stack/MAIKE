import React, { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Edit2, MoreVertical, Trash2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";
import { putItem } from "../offline/IndexedDBManager";

export default function GerenciarEmbarquesDialog({ open, onOpenChange, empresaId, embarques, documentos, onRefresh, dbReady, pesagens = [], pendingPesagens = [] }) {
  const [tab, setTab] = useState("embarques");
  const [isSaving, setIsSaving] = useState(false);

  // Embarque form
  const [embEditingId, setEmbEditingId] = useState(null);
  const [embNome, setEmbNome] = useState("");
  const [embData, setEmbData] = useState("");
  const [embFrigorifico, setEmbFrigorifico] = useState("");
  const [embStatus, setEmbStatus] = useState("Planejado");

  const [embSelecionado, setEmbSelecionado] = useState("");

  // Documento form
  const [docEditingId, setDocEditingId] = useState(null);
  const [docTipo, setDocTipo] = useState("GTA");
  const [docNumeroGTA, setDocNumeroGTA] = useState("");
  const [docNumeroNfe, setDocNumeroNfe] = useState("");
  const [docMotorista, setDocMotorista] = useState("");
  const [docPlaca, setDocPlaca] = useState("");
  const [docPrevM, setDocPrevM] = useState("");
  const [docPrevF, setDocPrevF] = useState("");

  const documentosDoEmbarque = useMemo(() => documentos.filter(d => d.embarque_id === embSelecionado), [documentos, embSelecionado]);

  // Pesos por documento (inclui pendentes offline)
  const allPesagens = useMemo(() => [
    ...(pendingPesagens || []),
    ...(pesagens || [])
  ], [pendingPesagens, pesagens]);

  const sumByDoc = useMemo(() => {
    const m = {};
    allPesagens.forEach(p => {
      const id = p.documento_embarque_id;
      if (!id) return;
      const peso = p.peso || 0;
      if (!m[id]) m[id] = { totalPeso: 0, count: 0 };
      m[id].totalPeso += peso;
      m[id].count += 1;
    });
    Object.keys(m).forEach(id => {
      m[id].media = m[id].count ? m[id].totalPeso / m[id].count : 0;
    });
    return m;
  }, [allPesagens]);

  const salvarEmbarque = async () => {
    if (!embNome.trim()) { toast.error("Nome obrigatório"); return; }
    setIsSaving(true);
    const data = { empresa_id: empresaId, nome: embNome.trim(), data: embData || null, frigorifico: embFrigorifico || null, status: embStatus };
    try {
      if (navigator.onLine) {
        if (embEditingId) await base44.entities.Embarque.update(embEditingId, data); else await base44.entities.Embarque.create(data);
        toast.success(embEditingId ? "Embarque atualizado" : "Embarque criado");
      } else if (dbReady) {
        const offline = { ...data, id: embEditingId || `offline_emb_${Date.now()}`, _isOffline: true };
        await putItem('embarques', offline);
        toast.success("Embarque salvo offline. Sincronize quando estiver online.");
      }
      setEmbEditingId(null); setEmbNome(""); setEmbData(""); setEmbFrigorifico(""); setEmbStatus("Planejado");
      onRefresh?.();
    } catch (e) { toast.error(e.message); } finally { setIsSaving(false); }
  };

  const salvarDocumento = async () => {
    if (!embSelecionado) { toast.error("Selecione um embarque"); return; }
    setIsSaving(true);
    const embNome = embarques.find(e => e.id === embSelecionado)?.nome || "";
    const data = {
      empresa_id: empresaId,
      embarque_id: embSelecionado,
      embarque_nome: embNome,
      tipo_documento: docTipo,
      numero_gta: docNumeroGTA || null,
      numero_nfe: docNumeroNfe || null,
      motorista_nome: docMotorista || null,
      placa_carreta: docPlaca || null,
      qtd_prev_machos: docPrevM ? parseInt(docPrevM) : 0,
      qtd_prev_femeas: docPrevF ? parseInt(docPrevF) : 0
    };
    try {
      if (navigator.onLine) {
        if (docEditingId) await base44.entities.DocumentoEmbarque.update(docEditingId, data); else await base44.entities.DocumentoEmbarque.create(data);
        toast.success(docEditingId ? "Documento atualizado" : "Documento criado");
      } else if (dbReady) {
        const offline = { ...data, id: docEditingId || `offline_doc_${Date.now()}`, _isOffline: true };
        await putItem('documentos_embarque', offline);
        toast.success("Documento salvo offline. Sincronize quando estiver online.");
      }
      setDocEditingId(null); setDocTipo("GTA"); setDocNumeroGTA(""); setDocNumeroNfe(""); setDocMotorista(""); setDocPlaca(""); setDocPrevM(""); setDocPrevF("");
      onRefresh?.();
    } catch (e) { toast.error(e.message); } finally { setIsSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Documentação de Embarque</DialogTitle>
        </DialogHeader>

        <div className="flex gap-2 border-b pb-2">
          <Button variant={tab === 'embarques' ? 'default' : 'outline'} size="sm" className="h-8 text-xs" onClick={() => setTab('embarques')}>Embarques</Button>
          <Button variant={tab === 'documentos' ? 'default' : 'outline'} size="sm" className="h-8 text-xs" onClick={() => setTab('documentos')}>Documentos</Button>
        </div>

        <div className="flex-1 overflow-auto">
          {tab === 'embarques' ? (
            <div className="space-y-3">
              <div className="grid grid-cols-6 gap-2 items-end bg-slate-50 p-3 rounded">
                <div className="space-y-1 col-span-2">
                  <Label className="text-xs">Nome</Label>
                  <Input value={embNome} onChange={(e)=>setEmbNome(e.target.value)} className="h-8 text-xs" placeholder="Ex: Embarque JBS" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Data</Label>
                  <Input type="date" value={embData} onChange={(e)=>setEmbData(e.target.value)} className="h-8 text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Frigorífico</Label>
                  <Input value={embFrigorifico} onChange={(e)=>setEmbFrigorifico(e.target.value)} className="h-8 text-xs" placeholder="Destino" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Status</Label>
                  <Select value={embStatus} onValueChange={setEmbStatus}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Planejado">Planejado</SelectItem>
                      <SelectItem value="Em andamento">Em andamento</SelectItem>
                      <SelectItem value="Concluido">Concluído</SelectItem>
                      <SelectItem value="Cancelado">Cancelado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex gap-2">
                  <Button onClick={salvarEmbarque} disabled={isSaving} size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">{isSaving ? 'Salvando...' : embEditingId ? 'Atualizar' : 'Adicionar'}</Button>
                  {embEditingId && <Button variant="outline" size="sm" className="h-8 text-xs" onClick={()=>{setEmbEditingId(null);setEmbNome('');setEmbData('');setEmbFrigorifico('');setEmbStatus('Planejado');}}>Cancelar</Button>}
                </div>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Nome</TableHead>
                    <TableHead className="text-xs">Data</TableHead>
                    <TableHead className="text-xs">Frigorífico</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs w-16">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {embarques.map(e => (
                    <TableRow key={e.id}>
                      <TableCell className="text-xs font-medium">{e.nome}</TableCell>
                      <TableCell className="text-xs">{e.data || '-'}</TableCell>
                      <TableCell className="text-xs">{e.frigorifico || '-'}</TableCell>
                      <TableCell className="text-xs">{e.status || '-'}</TableCell>
                      <TableCell className="text-xs">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-6 w-6"><MoreVertical className="w-3.5 h-3.5" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={()=>{setEmbEditingId(e.id);setEmbNome(e.nome||'');setEmbData(e.data||'');setEmbFrigorifico(e.frigorifico||'');setEmbStatus(e.status||'Planejado');}}>Editar</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-6 gap-2 items-end bg-slate-50 p-3 rounded">
                <div className="space-y-1 col-span-2">
                  <Label className="text-xs">Embarque</Label>
                  <Select value={embSelecionado} onValueChange={setEmbSelecionado}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {embarques.map(e=> <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Tipo Doc</Label>
                  <Select value={docTipo} onValueChange={setDocTipo}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="GTA">GTA</SelectItem>
                      <SelectItem value="NF-e">NF-e</SelectItem>
                      <SelectItem value="GTA+NF-e">GTA+NF-e</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Nº GTA</Label>
                  <Input value={docNumeroGTA} onChange={(e)=>setDocNumeroGTA(e.target.value)} className="h-8 text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Nº NF-e</Label>
                  <Input value={docNumeroNfe} onChange={(e)=>setDocNumeroNfe(e.target.value)} className="h-8 text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Motorista</Label>
                  <Input value={docMotorista} onChange={(e)=>setDocMotorista(e.target.value)} className="h-8 text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Placa</Label>
                  <Input value={docPlaca} onChange={(e)=>setDocPlaca(e.target.value)} className="h-8 text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Prev. Machos</Label>
                  <Input type="number" value={docPrevM} onChange={(e)=>setDocPrevM(e.target.value)} className="h-8 text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Prev. Fêmeas</Label>
                  <Input type="number" value={docPrevF} onChange={(e)=>setDocPrevF(e.target.value)} className="h-8 text-xs" />
                </div>
                <div className="flex gap-2 col-span-2">
                  <Button onClick={salvarDocumento} disabled={isSaving} size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">{isSaving ? 'Salvando...' : docEditingId ? 'Atualizar' : 'Adicionar'}</Button>
                  {docEditingId && <Button variant="outline" size="sm" className="h-8 text-xs" onClick={()=>{setDocEditingId(null);setDocTipo('GTA');setDocNumeroGTA('');setDocNumeroNfe('');setDocMotorista('');setDocPlaca('');setDocPrevM('');setDocPrevF('');}}>Cancelar</Button>}
                </div>
              </div>

              <Table>
                <TableHeader>
                  {/* Cabeçalho conforme padrão de tabelas: text-xs, font-bold, py-1, border */}
                  <TableRow>
                    <TableHead className="text-xs font-bold py-1 border border-black">GTA</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black">NF-e</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black text-center">Prev M/F</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black text-right">Peso Total</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black text-right">Peso Médio</TableHead>
                    <TableHead className="text-xs font-bold py-1 border border-black w-16">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {/* Linhas com hover e células com bordas seguindo o padrão */}
                  {documentosDoEmbarque.map(d => (
                    <TableRow key={d.id} className="hover:bg-gray-50">
                      <TableCell className="text-xs py-1 border border-gray-300">{d.numero_gta || '-'}</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300">{d.numero_nfe || '-'}</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300 text-center">{d.qtd_prev_machos || 0} / {d.qtd_prev_femeas || 0}</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono">{(sumByDoc[d.id]?.totalPeso || 0).toFixed(2)}</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono">{(sumByDoc[d.id]?.media || 0).toFixed(2)}</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-6 w-6"><MoreVertical className="w-3.5 h-3.5" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={()=>{setDocEditingId(d.id);setEmbSelecionado(d.embarque_id);setDocTipo(d.tipo_documento||'GTA');setDocNumeroGTA(d.numero_gta||'');setDocNumeroNfe(d.numero_nfe||'');setDocMotorista(d.motorista_nome||'');setDocPlaca(d.placa_carreta||'');setDocPrevM(String(d.qtd_prev_machos||''));setDocPrevF(String(d.qtd_prev_femeas||''));}}>Editar</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}