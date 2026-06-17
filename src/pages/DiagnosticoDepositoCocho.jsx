import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertTriangle, CheckCircle, XCircle, Info, RefreshCw, Wrench } from "lucide-react";
import { toast } from "sonner";

const normalizeText = (str) => (str || "").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

const StatusBadge = ({ ok, label }) => ok
  ? <Badge className="bg-emerald-100 text-emerald-800 text-[10px]"><CheckCircle className="w-3 h-3 mr-1" />{label}</Badge>
  : <Badge className="bg-red-100 text-red-700 text-[10px]"><XCircle className="w-3 h-3 mr-1" />{label}</Badge>;

const WarnBadge = ({ label }) =>
  <Badge className="bg-amber-100 text-amber-700 text-[10px]"><AlertTriangle className="w-3 h-3 mr-1" />{label}</Badge>;

export default function DiagnosticoDepositoCocho() {
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");
  const queryClient = useQueryClient();
  const [fixDialog, setFixDialog] = useState(null); // { cocho, field }
  const [fixValue, setFixValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [filtro, setFiltro] = useState("todos"); // todos | problemas | ok

  const { data: pontos = [], isLoading: loadingPontos } = useQuery({
    queryKey: ["diagnostico-pontos", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.PontoSuplementacao.list();
      return all.filter((p) => p.empresa_id === empresaSelecionadaId && p.status === "Ativo");
    },
    enabled: !!empresaSelecionadaId,
  });

  const cochos = useMemo(() => pontos.filter((p) => normalizeText(p.categoria_ponto) === "COCHO"), [pontos]);
  const depositos = useMemo(() => pontos.filter((p) => normalizeText(p.categoria_ponto) === "DEPOSITO"), [pontos]);

  const { data: lotes = [] } = useQuery({
    queryKey: ["diagnostico-lotes", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Lote.list();
      return all.filter((l) => l.empresa_id === empresaSelecionadaId && l.status === "Ativo");
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: lotesNota = [] } = useQuery({
    queryKey: ["diagnostico-lotes-nota", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.EstoqueLoteNota.list();
      return all.filter((l) => l.empresa_id === empresaSelecionadaId && l.status === "Disponivel");
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: areas = [] } = useQuery({
    queryKey: ["diagnostico-areas", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.AreaPastagem.list();
      return all.filter((a) => a.empresa_id === empresaSelecionadaId && a.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  // Mapa depósito.id -> saldo total
  const saldoPorDeposito = useMemo(() => {
    const m = new Map();
    depositos.forEach((d) => {
      if (!d.local_estoque_id) { m.set(d.id, 0); return; }
      const saldo = lotesNota
        .filter((l) => l.local_estoque_id === d.local_estoque_id)
        .reduce((s, l) => s + (l.quantidade_disponivel || 0), 0);
      m.set(d.id, saldo);
    });
    return m;
  }, [depositos, lotesNota]);

  // Diagnóstico por cocho
  const diagnosticos = useMemo(() => {
    return cochos.map((cocho) => {
      const areaIds = Array.isArray(cocho.area_vinculada_ids) && cocho.area_vinculada_ids.length > 0
        ? cocho.area_vinculada_ids
        : cocho.area_vinculada_id ? [cocho.area_vinculada_id] : [];

      const areaIdsValidos = areaIds.filter((id) => areas.some((a) => a.id === id));

      const deposito = depositos.find((d) => d.id === cocho.deposito_origem_id)
        || depositos.find((d) => normalizeText(d.nome_ponto) === normalizeText(cocho.deposito_origem_nome));

      const lotesNaArea = lotes.filter((l) => areaIdsValidos.includes(l.area_atual_id));

      const saldoDeposito = deposito ? (saldoPorDeposito.get(deposito.id) || 0) : 0;

      const problemas = [];

      if (areaIds.length === 0) problemas.push("Sem área vinculada");
      else if (areaIdsValidos.length === 0) problemas.push("Área vinculada não encontrada no cadastro");

      if (!cocho.deposito_origem_id && !cocho.deposito_origem_nome) {
        problemas.push("Sem depósito vinculado (sem baixa automática)");
      } else if (!deposito) {
        problemas.push(`Depósito "${cocho.deposito_origem_nome || cocho.deposito_origem_id}" não encontrado`);
      } else if (!deposito.local_estoque_id) {
        problemas.push("Depósito sem local de estoque configurado");
      }

      if (areaIdsValidos.length > 0 && lotesNaArea.length === 0) {
        problemas.push("Área sem lotes ativos (sem cabeças → lançamento bloqueado)");
      }

      if (deposito && saldoDeposito <= 0) {
        problemas.push("Depósito sem saldo de estoque");
      }

      // Alinhamento ids ↔ array
      const areaIdSingle = cocho.area_vinculada_id;
      const areaIdsArr = Array.isArray(cocho.area_vinculada_ids) ? cocho.area_vinculada_ids.filter(Boolean) : [];
      if (areaIdSingle && areaIdsArr.length === 0) {
        problemas.push("area_vinculada_ids vazio mas area_vinculada_id preenchido (inconsistência de campos)");
      }

      return {
        cocho,
        deposito,
        areaIds,
        areaIdsValidos,
        lotesNaArea,
        saldoDeposito,
        problemas,
        ok: problemas.length === 0,
      };
    });
  }, [cochos, depositos, lotes, areas, saldoPorDeposito]);

  // Diagnóstico por depósito
  const diagDepositos = useMemo(() => {
    return depositos.map((dep) => {
      const cochosVinculados = cochos.filter((c) => c.deposito_origem_id === dep.id);
      const saldo = saldoPorDeposito.get(dep.id) || 0;
      const problemas = [];
      if (!dep.local_estoque_id) problemas.push("Sem local de estoque vinculado");
      if (saldo <= 0) problemas.push("Saldo zerado");
      if (cochosVinculados.length === 0) problemas.push("Nenhum cocho vinculado a este depósito");
      return { deposito: dep, saldo, cochosVinculados, problemas, ok: problemas.length === 0 };
    });
  }, [depositos, cochos, saldoPorDeposito]);

  const totalProblemas = diagnosticos.filter((d) => !d.ok).length;
  const totalOk = diagnosticos.filter((d) => d.ok).length;

  const filtrados = useMemo(() => {
    if (filtro === "problemas") return diagnosticos.filter((d) => !d.ok);
    if (filtro === "ok") return diagnosticos.filter((d) => d.ok);
    return diagnosticos;
  }, [diagnosticos, filtro]);

  // Corrigir campo no cocho
  const handleFixOpen = (cocho, field) => {
    setFixDialog({ cocho, field });
    if (field === "deposito") setFixValue(cocho.deposito_origem_id || "");
    if (field === "area_ids_sync") setFixValue("sync");
  };

  const handleFixSave = async () => {
    if (!fixDialog) return;
    setSaving(true);
    try {
      const { cocho, field } = fixDialog;
      if (field === "deposito") {
        const dep = depositos.find((d) => d.id === fixValue);
        await base44.entities.PontoSuplementacao.update(cocho.id, {
          deposito_origem_id: dep?.id || null,
          deposito_origem_nome: dep?.nome_ponto || null,
        });
        toast.success("Depósito vinculado!");
      }
      if (field === "area_ids_sync") {
        // Sincronizar area_vinculada_id -> area_vinculada_ids
        const areaId = cocho.area_vinculada_id;
        const area = areas.find((a) => a.id === areaId);
        await base44.entities.PontoSuplementacao.update(cocho.id, {
          area_vinculada_ids: areaId ? [areaId] : [],
          area_vinculada_nomes: area ? [area.nome] : (cocho.area_vinculada_nome ? [cocho.area_vinculada_nome] : []),
        });
        toast.success("Campo area_vinculada_ids sincronizado!");
      }
      queryClient.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "diagnostico-pontos" });
      setFixDialog(null);
    } catch (e) {
      toast.error("Erro ao salvar: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loadingPontos) return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="animate-spin w-6 h-6 border-2 border-emerald-600 border-t-transparent rounded-full" />
    </div>
  );

  return (
    <div className="absolute inset-0 overflow-y-auto p-4 space-y-4" translate="no">

      {/* Resumo */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="border-slate-200">
          <CardContent className="p-3">
            <div className="text-xs text-slate-500">Total de Cochos</div>
            <div className="text-2xl font-bold text-slate-900">{cochos.length}</div>
          </CardContent>
        </Card>
        <Card className="border-slate-200">
          <CardContent className="p-3">
            <div className="text-xs text-slate-500">Total de Depósitos</div>
            <div className="text-2xl font-bold text-slate-900">{depositos.length}</div>
          </CardContent>
        </Card>
        <Card className="border-emerald-200 bg-emerald-50">
          <CardContent className="p-3">
            <div className="text-xs text-emerald-700">Cochos OK</div>
            <div className="text-2xl font-bold text-emerald-800">{totalOk}</div>
          </CardContent>
        </Card>
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-3">
            <div className="text-xs text-red-700">Cochos com Problemas</div>
            <div className="text-2xl font-bold text-red-800">{totalProblemas}</div>
          </CardContent>
        </Card>
      </div>

      {/* Diagnóstico dos Depósitos */}
      <Card>
        <CardHeader className="py-3 bg-slate-50 border-b">
          <CardTitle className="text-sm font-semibold">Diagnóstico dos Depósitos</CardTitle>
        </CardHeader>
        <CardContent className="p-3 space-y-2">
          {diagDepositos.length === 0 && <div className="text-xs text-slate-500">Nenhum depósito cadastrado.</div>}
          {diagDepositos.map(({ deposito, saldo, cochosVinculados, problemas, ok }) => (
            <div key={deposito.id} className={`rounded-lg border p-3 space-y-1.5 ${ok ? "border-emerald-200 bg-emerald-50/40" : "border-red-200 bg-red-50/40"}`}>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-xs font-bold text-slate-900">{deposito.nome_ponto}</span>
                <div className="flex gap-1 flex-wrap">
                  <StatusBadge ok={!!deposito.local_estoque_id} label={deposito.local_estoque_nome || "Sem local estoque"} />
                  <StatusBadge ok={saldo > 0} label={`Saldo: ${saldo.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} kg`} />
                  <StatusBadge ok={cochosVinculados.length > 0} label={`${cochosVinculados.length} cocho(s) vinculado(s)`} />
                </div>
              </div>
              {problemas.length > 0 && (
                <div className="space-y-0.5">
                  {problemas.map((p, i) => (
                    <div key={i} className="text-[10px] text-red-700 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3 shrink-0" /> {p}
                    </div>
                  ))}
                </div>
              )}
              {cochosVinculados.length > 0 && (
                <div className="text-[10px] text-slate-500">
                  Cochos: {cochosVinculados.map((c) => c.nome_ponto).join(", ")}
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Diagnóstico dos Cochos */}
      <Card>
        <CardHeader className="py-3 bg-slate-50 border-b">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-sm font-semibold">Diagnóstico dos Cochos</CardTitle>
            <div className="flex gap-1">
              {["todos", "problemas", "ok"].map((v) => (
                <Button
                  key={v}
                  size="sm"
                  variant={filtro === v ? "default" : "outline"}
                  className="h-7 text-xs"
                  onClick={() => setFiltro(v)}
                >
                  {v === "todos" ? "Todos" : v === "problemas" ? `⚠ Problemas (${totalProblemas})` : `✓ OK (${totalOk})`}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-3 space-y-2">
          {filtrados.length === 0 && <div className="text-xs text-slate-500 p-4 text-center">Nenhum cocho nesta categoria.</div>}
          {filtrados.map(({ cocho, deposito, areaIds, areaIdsValidos, lotesNaArea, saldoDeposito, problemas, ok }) => {
            const areaIdSingle = cocho.area_vinculada_id;
            const areaIdsArr = Array.isArray(cocho.area_vinculada_ids) ? cocho.area_vinculada_ids.filter(Boolean) : [];
            const temInconsistenciaIds = areaIdSingle && areaIdsArr.length === 0;

            return (
              <div
                key={cocho.id}
                className={`rounded-lg border p-3 space-y-2 ${ok ? "border-emerald-200 bg-emerald-50/30" : "border-red-200 bg-red-50/30"}`}
              >
                {/* Cabeçalho */}
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <span className="text-xs font-bold text-slate-900">{cocho.nome_ponto}</span>
                    <span className="text-[10px] text-slate-500 ml-2">#{cocho.numero_ponto}</span>
                  </div>
                  {ok ? (
                    <Badge className="bg-emerald-100 text-emerald-800 text-[10px]"><CheckCircle className="w-3 h-3 mr-1" />OK</Badge>
                  ) : (
                    <Badge className="bg-red-100 text-red-700 text-[10px]"><XCircle className="w-3 h-3 mr-1" />{problemas.length} problema(s)</Badge>
                  )}
                </div>

                {/* Status dos vínculos */}
                <div className="flex flex-wrap gap-1">
                  <StatusBadge ok={areaIdsValidos.length > 0} label={areaIdsValidos.length > 0 ? `Área: ${areaIdsValidos.length}` : "Sem área"} />
                  <StatusBadge ok={!!deposito} label={deposito ? `Depósito: ${deposito.nome_ponto}` : "Sem depósito"} />
                  <StatusBadge ok={lotesNaArea.length > 0} label={`${lotesNaArea.length} lote(s) na área`} />
                  {deposito && <StatusBadge ok={saldoDeposito > 0} label={`Saldo: ${saldoDeposito.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} kg`} />}
                </div>

                {/* Problemas */}
                {problemas.length > 0 && (
                  <div className="rounded bg-red-50 border border-red-200 p-2 space-y-1">
                    {problemas.map((p, i) => (
                      <div key={i} className="text-[10px] text-red-700 flex items-start gap-1">
                        <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" /> {p}
                      </div>
                    ))}
                  </div>
                )}

                {/* Ações de correção */}
                <div className="flex flex-wrap gap-1">
                  {/* Vincular depósito */}
                  {(!cocho.deposito_origem_id || !deposito) && depositos.length > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-[10px] border-amber-300 text-amber-700 hover:bg-amber-50"
                      onClick={() => handleFixOpen(cocho, "deposito")}
                    >
                      <Wrench className="w-3 h-3 mr-1" /> Vincular Depósito
                    </Button>
                  )}
                  {/* Corrigir inconsistência de ids */}
                  {temInconsistenciaIds && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-[10px] border-amber-300 text-amber-700 hover:bg-amber-50"
                      onClick={() => handleFixOpen(cocho, "area_ids_sync")}
                    >
                      <Wrench className="w-3 h-3 mr-1" /> Corrigir campo area_ids
                    </Button>
                  )}
                </div>

                {/* Detalhes extras */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-1 text-[10px]">
                  <div className="rounded border border-slate-200 bg-white px-1.5 py-1">
                    <div className="text-slate-500">Áreas vinculadas</div>
                    <div className="font-semibold text-slate-900 break-words">
                      {areaIdsValidos.length > 0
                        ? areas.filter((a) => areaIdsValidos.includes(a.id)).map((a) => a.nome).join(", ")
                        : cocho.area_vinculada_nome || "—"}
                    </div>
                  </div>
                  <div className="rounded border border-slate-200 bg-white px-1.5 py-1">
                    <div className="text-slate-500">Local de estoque</div>
                    <div className="font-semibold text-slate-900">{deposito?.local_estoque_nome || "—"}</div>
                  </div>
                  <div className="rounded border border-slate-200 bg-white px-1.5 py-1">
                    <div className="text-slate-500">Cabeças nas áreas</div>
                    <div className="font-semibold text-slate-900">
                      {lotesNaArea.reduce((s, l) => s + (l.quantidade_cabecas || 0), 0)} cab
                    </div>
                  </div>
                  <div className="rounded border border-slate-200 bg-white px-1.5 py-1">
                    <div className="text-slate-500">Produto padrão</div>
                    <div className="font-semibold text-slate-900">{cocho.produto_padrao || "—"}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Dialog de correção */}
      <Dialog open={!!fixDialog} onOpenChange={(open) => !open && setFixDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">
              {fixDialog?.field === "deposito" ? "Vincular Depósito" : "Corrigir campo area_ids"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-xs text-slate-600">
              Cocho: <span className="font-bold">{fixDialog?.cocho?.nome_ponto}</span>
            </div>
            {fixDialog?.field === "deposito" && (
              <div>
                <label className="text-xs text-slate-500">Selecione o depósito</label>
                <Select value={fixValue} onValueChange={setFixValue}>
                  <SelectTrigger className="h-8 text-xs mt-1"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__nenhum__" className="text-xs">Nenhum</SelectItem>
                    {depositos.map((d) => (
                      <SelectItem key={d.id} value={d.id} className="text-xs">
                        {d.nome_ponto} {d.local_estoque_id ? "✓" : "⚠ sem local estoque"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {fixDialog?.field === "area_ids_sync" && (
              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                Isso vai copiar <code>area_vinculada_id</code> para o array <code>area_vinculada_ids</code> do cocho. O sistema usa o array para buscar lotes e calcular consumo.
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setFixDialog(null)}>Cancelar</Button>
              <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white" onClick={handleFixSave} disabled={saving}>
                {saving ? "Salvando..." : "Salvar"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}