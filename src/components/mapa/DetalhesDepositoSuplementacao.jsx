import React, { useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import FormularioTransferenciaDeposito from "./FormularioTransferenciaDeposito";
import HistoricoDepositoSuplementacao from "../suplementacao/HistoricoDepositoSuplementacao";
import PontoPercentIcon from "./PontoPercentIcon";
import { formatKg } from "../suplementacao/formatters";
import { kgParaSacos } from "../suplementacao/unidadeConversaoUtils";
import { getDepositoIndicator } from "./pontoStatusUtils";
import { normalizeText } from "../suplementacao/estoqueSuplementacaoUtils";

export default function DetalhesDepositoSuplementacao({ deposito, onClose, permissions = {} }) {
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");
  const queryClient = useQueryClient();
  const [showTransferencia, setShowTransferencia] = useState(false);
  const [showHistorico, setShowHistorico] = useState(false);
  const [transferDirection, setTransferDirection] = useState("entrada");

  const { data: lotesNota = [] } = useQuery({
    queryKey: ["saldo-deposito", deposito.id],
    queryFn: async () => {
      const all = await base44.entities.EstoqueLoteNota.list();
      return all.filter((lote) => lote.empresa_id === empresaSelecionadaId && lote.local_estoque_id === deposito.local_estoque_id && lote.status === "Disponivel");
    },
    enabled: !!empresaSelecionadaId && !!deposito.local_estoque_id
  });

  const { data: produtos = [] } = useQuery({
    queryKey: ["produtos-deposito-detalhe", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Produto.list();
      return all.filter((produto) => produto.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId
  });

  const { data: iconesConfig = [] } = useQuery({
    queryKey: ["configuracao-icones-deposito-detalhe", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.ConfiguracaoIcone.list();
      return all.filter((item) => item.ativo !== false && item.tipo_entidade === "Ponto");
    },
    enabled: !!empresaSelecionadaId
  });

  const { data: pontosSuplementacao = [] } = useQuery({
    queryKey: ["cochos-vinculados-deposito", deposito.id],
    queryFn: async () => {
      const all = await base44.entities.PontoSuplementacao.list();
      return all.filter((ponto) => ponto.empresa_id === empresaSelecionadaId && ponto.status === "Ativo");
    },
    enabled: !!empresaSelecionadaId
  });

  const { data: lotes = [] } = useQuery({
    queryKey: ["lotes-deposito-detalhe", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Lote.list();
      return all.filter((lote) => lote.empresa_id === empresaSelecionadaId && lote.status === "Ativo");
    },
    enabled: !!empresaSelecionadaId
  });

  const { data: areas = [] } = useQuery({
    queryKey: ["areas-deposito-detalhe", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.AreaPastagem.list();
      return all.filter((area) => area.empresa_id === empresaSelecionadaId && area.ativo !== false);
    },
    enabled: !!empresaSelecionadaId
  });

  const { data: movimentacoes = [] } = useQuery({
    queryKey: ["movimentacoes-deposito-detalhe", deposito.id],
    queryFn: async () => {
      const all = await base44.entities.MovimentacaoEstoque.list("-data_movimentacao");
      return all.filter((item) => item.empresa_id === empresaSelecionadaId && (item.local_estoque_origem === deposito.local_estoque_id || item.local_estoque_destino === deposito.local_estoque_id));
    },
    enabled: !!empresaSelecionadaId && !!deposito.local_estoque_id
  });

  const cochosVinculados = useMemo(() => {
    return pontosSuplementacao.filter((ponto) => normalizeText(ponto.categoria_ponto || "COCHO") === "COCHO" && ponto.deposito_origem_id === deposito.id);
  }, [pontosSuplementacao, deposito.id]);

  const saldosAgrupados = useMemo(() => {
    const mapa = new Map();
    lotesNota.forEach((lote) => {
      const produto = produtos.find((item) => item.id === lote.produto_id);
      const pesoPorSaco = Number(produto?.peso_por_saco_kg || 0);
      const current = mapa.get(lote.produto_id) || { produto_id: lote.produto_id, produto_nome: lote.produto_nome, saldo: 0, saldoSacos: 0 };
      current.saldo += lote.quantidade_disponivel || 0;
      current.saldoSacos += pesoPorSaco > 0 ? kgParaSacos(lote.quantidade_disponivel || 0, pesoPorSaco) : 0;
      mapa.set(lote.produto_id, current);
    });
    return Array.from(mapa.values()).sort((a, b) => a.produto_nome.localeCompare(b.produto_nome));
  }, [lotesNota, produtos]);

  const indicador = useMemo(() => {
    return getDepositoIndicator(deposito, pontosSuplementacao, lotes, lotesNota, movimentacoes);
  }, [deposito, pontosSuplementacao, lotes, lotesNota, movimentacoes]);

  const iconePonto = useMemo(() => {
    const categoriaPonto = normalizeText(deposito?.categoria_ponto || "");
    const nomePonto = normalizeText(deposito?.nome_ponto || "");

    return iconesConfig.find((item) => {
      const categoriaIcone = normalizeText(item.categoria || "");
      if (categoriaIcone === categoriaPonto) return true;
      if (categoriaPonto.includes("DEPOSITO") && categoriaIcone === "DEPOSITO") return true;
      if (categoriaPonto.includes("COCHO") && categoriaIcone === "COCHO") return true;
      if (nomePonto.includes("DEPOSITO") && categoriaIcone === "DEPOSITO") return true;
      if (nomePonto.includes("COCHO") && categoriaIcone === "COCHO") return true;
      return false;
    });
  }, [iconesConfig, deposito?.categoria_ponto, deposito?.nome_ponto]);
  const subIconePonto = iconePonto?.sub_icone_url || iconePonto?.icone_url || "";

  const ultimoRegistro = indicador.latestRecord;
  const totalSaldoSacos = useMemo(() => saldosAgrupados.reduce((total, item) => total + (item.saldoSacos || 0), 0), [saldosAgrupados]);
  const ultimoProduto = useMemo(() => {
    if (!ultimoRegistro?.produto_id) return null;
    return produtos.find((produto) => produto.id === ultimoRegistro.produto_id) || null;
  }, [produtos, ultimoRegistro]);
  const ultimoRegistroSacos = useMemo(() => {
    const pesoPorSaco = Number(ultimoProduto?.peso_por_saco_kg || 0);
    if (!ultimoRegistro || pesoPorSaco <= 0) return null;
    return (ultimoRegistro.quantidade || 0) / pesoPorSaco;
  }, [ultimoProduto, ultimoRegistro]);

  const handleSaved = () => {
    queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && ["saldo-deposito", "cochos-vinculados-deposito", "movimentacoes-deposito-detalhe", "mapa-pontos-supl", "mapa-pontos", "pontos", "pontos-suplementacao"].includes(query.queryKey[0]) });
    window.dispatchEvent(new CustomEvent("atualizar-mapa"));
  };

  return (
    <div className="space-y-1" translate="no">
      <div className="pb-1 border-b space-y-1">
        <div className="flex items-center gap-1 flex-wrap">
          <Badge variant="outline" className="bg-yellow-400 text-slate-950 px-2.5 py-0.5 text-xs font-semibold rounded-md inline-flex items-center border border-yellow-300">Local: {deposito.nome_ponto}</Badge>
        </div>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-3 gap-1">
        {permissions.movimentar_depositos !== false && <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => { setTransferDirection("entrada"); setShowTransferencia(true); }}>Entrada</Button>}
        {permissions.movimentar_depositos !== false && <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => { setTransferDirection("saida"); setShowTransferencia(true); }}>Saída</Button>}
        {permissions.visualizar_historico_cocho !== false && <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowHistorico(true)}>Histórico</Button>}
      </div>

      <div className="space-y-1 text-[10px]">
        <Card className="border-slate-200 shadow-sm"><CardContent className="p-1">
          <div className="my-1 grid grid-cols-1 md:grid-cols-[auto,1fr] gap-1 items-center">
            <div className="flex items-center gap-3">
              <PontoPercentIcon
                  imageUrl={subIconePonto}
                  label={deposito.categoria_ponto || "Depósito"}
                  percent={indicador?.percent || 0}
                  fillClassName={indicador?.isCritical ? "bg-red-500" : "bg-lime-400"} />

            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-1 text-[10px]">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                <div className="text-slate-500">Saldo atual kg</div>
                <div className="text-sm font-bold text-slate-900">{formatKg(indicador.saldoAtual)}</div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                <div className="text-slate-500">Saldo em sacos</div>
                <div className="text-sm font-bold text-slate-900">{totalSaldoSacos.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} sacos</div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                <div className="text-slate-500">Necessidade reposição kg</div>
                <div className="text-sm font-bold text-slate-900">{formatKg(indicador.necessidadeReposicao || 0)}</div>
              </div>
            </div>
          </div>
        </CardContent></Card>
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-1 space-y-1">
          <div className="text-[11px] font-bold text-slate-900">Saldo por Produto</div>
          {saldosAgrupados.length === 0 ?
          <div className="text-xs text-slate-500">Sem saldo disponível neste depósito.</div> :

          <div className="space-y-1">
              {saldosAgrupados.map((item) =>
            <div key={item.produto_id} className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 text-xs">
                    <div className="truncate font-medium text-slate-900">{item.produto_nome}</div>
                    <div className="whitespace-nowrap font-semibold text-slate-900">{(item.saldoSacos || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} sacos</div>
                    <div className="whitespace-nowrap font-semibold text-slate-900">{formatKg(item.saldo)}</div>
                  </div>
                </div>
            )}
            </div>
          }
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-1 space-y-1">
          <div className="text-[11px] font-bold text-slate-900">Último Registro</div>
          {ultimoRegistro ?
          <div className="space-y-1.5">
              <div className="text-xs font-semibold text-slate-900">{ultimoRegistro.produto_nome}</div>
              <div>
                <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Movimentação</div>
                <div className="grid grid-cols-2 gap-1 text-[10px]">
                  <div className="rounded border border-slate-200 bg-white px-1.5 py-1"><div className="text-slate-500">Tipo</div><div className="font-semibold text-slate-900">{ultimoRegistro.tipo_movimentacao}</div></div>
                  <div className="rounded border border-slate-200 bg-white px-1.5 py-1"><div className="text-slate-500">Data</div><div className="font-semibold text-slate-900">{new Date(ultimoRegistro.data_movimentacao).toLocaleDateString("pt-BR")}</div></div>
                </div>
              </div>
              <div>
                <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Quantidade</div>
                <div className="grid grid-cols-2 gap-1 text-[10px]">
                  <div className="rounded border border-slate-200 bg-white px-1.5 py-1"><div className="text-slate-500">Quantidade kg</div><div className="font-semibold text-slate-900">{formatKg(ultimoRegistro.quantidade || 0)}</div></div>
                  <div className="rounded border border-slate-200 bg-white px-1.5 py-1"><div className="text-slate-500">Quantidade sacos</div><div className="font-semibold text-slate-900">{ultimoRegistroSacos != null ? ultimoRegistroSacos.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}</div></div>
                </div>
              </div>
              <div>
                <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Local</div>
                <div className="grid grid-cols-2 gap-1 text-[10px]">
                  <div className="rounded border border-slate-200 bg-white px-1.5 py-1"><div className="text-slate-500">Origem</div><div className="font-semibold text-slate-900">{ultimoRegistro.local_origem || "-"}</div></div>
                  <div className="rounded border border-slate-200 bg-white px-1.5 py-1"><div className="text-slate-500">Destino</div><div className="font-semibold text-slate-900">{ultimoRegistro.tipo_detalhado === "suplementacao" ? "Suplementação" : ultimoRegistro.local_destino || "-"}</div></div>
                </div>
              </div>
              {ultimoRegistro.observacoes && <div className="text-[10px] text-slate-500 break-words">Obs: {ultimoRegistro.observacoes}</div>}
            </div> :

          <div className="text-xs text-slate-500">Nenhum registro ainda.</div>
          }
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-1 space-y-1">
          <div className="text-[11px] font-bold text-slate-900">Pastos atendidos pela saída do estoque</div>
          {cochosVinculados.length === 0 ?
          <div className="text-xs text-slate-500">Nenhum cocho vinculado a este depósito.</div> :

          <div className="space-y-2">
              {cochosVinculados.map((cocho) => {
              const areaIds = Array.isArray(cocho.area_vinculada_ids) && cocho.area_vinculada_ids.length > 0 ?
              cocho.area_vinculada_ids :
              cocho.area_vinculada_id ? [cocho.area_vinculada_id] : [];
              const nomesPorId = new Map(areas.map((area) => [area.id, area.nome]));
              const nomesResolvidos = areaIds.map((id) => nomesPorId.get(id)).filter(Boolean);
              const pastosAtendidos = nomesResolvidos.length > 0 ?
              nomesResolvidos.join(', ') :
              Array.isArray(cocho.area_vinculada_nomes) && cocho.area_vinculada_nomes.length > 0 ?
              cocho.area_vinculada_nomes.join(', ') :
              cocho.area_vinculada_nome || 'Sem pasto vinculado';
              return <div key={cocho.id} className="rounded-lg border border-slate-200 bg-slate-50 px-1 py-1">
                  <div className="text-[10px] text-slate-500">Cocho: {cocho.nome_ponto}</div>
                  <div className="text-[10px] text-slate-500">Saída do estoque para: {pastosAtendidos}</div>
                </div>;
            })}
            </div>
          }
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-1 space-y-1">
          <div className="text-[11px] font-bold text-slate-900">Informações do Depósito</div>
          <div className="space-y-1 text-[10px]">
            







            
            <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Número:</span><span className="font-semibold text-slate-900">{deposito.numero_ponto || '-'}</span></div>
            <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Sigla:</span><span className="font-semibold text-slate-900">{deposito.sigla || '-'}</span></div>
            <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Tipo:</span><span className="font-semibold text-slate-900">{deposito.tipo || '-'}</span></div>
            <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Local de estoque:</span><span className="font-semibold text-slate-900">{deposito.local_estoque_nome || '-'}</span></div>
            <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Produto padrão:</span><span className="font-semibold text-slate-900">{deposito.produto_padrao || '-'}</span></div>
            <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Capacidade:</span><span className="font-semibold text-slate-900">{deposito.capacidade_cocho_kg ? formatKg(deposito.capacidade_cocho_kg) : '-'}</span></div>
            <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Estoque mínimo:</span><span className="font-semibold text-slate-900">{deposito.estoque_minimo_kg ? formatKg(deposito.estoque_minimo_kg) : '-'}</span></div>
            <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Frequência padrão:</span><span className="font-semibold text-slate-900">{deposito.frequencia_esperada_dias ? `${deposito.frequencia_esperada_dias} dia(s)` : '-'}</span></div>
            <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Cochos vinculados:</span><span className="font-semibold text-slate-900">{cochosVinculados.length}</span></div>
            <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Observações:</span><span className="font-semibold text-slate-900 break-words">{deposito.observacoes || '-'}</span></div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={showTransferencia} onOpenChange={setShowTransferencia}>
        <DialogContent className="max-w-[880px] max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="text-sm">{transferDirection === "entrada" ? "Entrada no Depósito" : "Saída do Depósito"}</DialogTitle></DialogHeader>
          <FormularioTransferenciaDeposito deposito={deposito} initialDirection={transferDirection} onSuccess={() => {setShowTransferencia(false);handleSaved();}} onCancel={() => setShowTransferencia(false)} />
        </DialogContent>
      </Dialog>

      <Dialog open={showHistorico} onOpenChange={setShowHistorico}>
        <DialogContent className="bg-background px-2 py-2 fixed left-[50%] top-[50%] z-50 grid w-full translate-x-[-50%] translate-y-[-50%] gap-4 border shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg max-w-4xl max-h-[90vh] overflow-y-auto">
          <HistoricoDepositoSuplementacao deposito={deposito} />
        </DialogContent>
      </Dialog>
    </div>);

}