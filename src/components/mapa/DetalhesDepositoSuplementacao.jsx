import React, { useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import FormularioTransferenciaDeposito from "./FormularioTransferenciaDeposito";
import HistoricoDepositoSuplementacao from "../suplementacao/HistoricoDepositoSuplementacao";
import IndicadorCopoNivel from "../suplementacao/IndicadorCopoNivel";
import { formatKg } from "../suplementacao/formatters";
import { kgParaSacos } from "../suplementacao/unidadeConversaoUtils";
import { getDepositoIndicator } from "./pontoStatusUtils";
import { normalizeText } from "../suplementacao/estoqueSuplementacaoUtils";

export default function DetalhesDepositoSuplementacao({ deposito, onClose }) {
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
    enabled: !!empresaSelecionadaId && !!deposito.local_estoque_id,
  });

  const { data: produtos = [] } = useQuery({
    queryKey: ["produtos-deposito-detalhe", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Produto.list();
      return all.filter((produto) => produto.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: iconesConfig = [] } = useQuery({
    queryKey: ["configuracao-icones-deposito-detalhe", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.ConfiguracaoIcone.list();
      return all.filter((item) => item.ativo !== false && item.tipo_entidade === "Ponto");
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: pontosSuplementacao = [] } = useQuery({
    queryKey: ["cochos-vinculados-deposito", deposito.id],
    queryFn: async () => {
      const all = await base44.entities.PontoSuplementacao.list();
      return all.filter((ponto) => ponto.empresa_id === empresaSelecionadaId && ponto.status === "Ativo");
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: lotes = [] } = useQuery({
    queryKey: ["lotes-deposito-detalhe", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Lote.list();
      return all.filter((lote) => lote.empresa_id === empresaSelecionadaId && lote.status === "Ativo");
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: movimentacoes = [] } = useQuery({
    queryKey: ["movimentacoes-deposito-detalhe", deposito.id],
    queryFn: async () => {
      const all = await base44.entities.MovimentacaoEstoque.list("-data_movimentacao");
      return all.filter((item) => item.empresa_id === empresaSelecionadaId && (item.local_estoque_origem === deposito.local_estoque_id || item.local_estoque_destino === deposito.local_estoque_id));
    },
    enabled: !!empresaSelecionadaId && !!deposito.local_estoque_id,
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
    return iconesConfig.find((item) => normalizeText(item.categoria) === normalizeText(deposito?.categoria_ponto || "DEPOSITO"));
  }, [iconesConfig, deposito?.categoria_ponto]);
  const subIconePonto = iconePonto?.sub_icone_url || iconePonto?.icone_url || "";

  const ultimoRegistro = indicador.latestRecord;

  const handleSaved = () => {
    queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && ["saldo-deposito", "cochos-vinculados-deposito", "movimentacoes-deposito-detalhe", "mapa-pontos-supl", "mapa-pontos", "pontos", "pontos-suplementacao"].includes(query.queryKey[0]) });
    window.dispatchEvent(new CustomEvent("atualizar-mapa"));
  };

  return (
    <div className="space-y-4" translate="no">
      <div className="pb-2 border-b space-y-2">
        <div className="text-sm font-bold text-slate-900">{deposito.nome_ponto}</div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-xs text-slate-700 border-slate-300 bg-white">Depósito</Badge>
          <Badge variant="outline" className="text-xs text-slate-700 border-slate-300 bg-white">{deposito.local_estoque_nome || "Sem local"}</Badge>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => { setTransferDirection("entrada"); setShowTransferencia(true); }}>Entrada</Button>
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => { setTransferDirection("saida"); setShowTransferencia(true); }}>Saída</Button>
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowHistorico(true)}>Histórico</Button>
      </div>

      <div className="space-y-2 text-[10px]">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Card className="border-slate-200 shadow-sm"><CardContent className="p-2.5"><div className="text-slate-500">Produtos com saldo</div><div className="text-sm font-bold text-slate-900">{saldosAgrupados.length}</div></CardContent></Card>
          <Card className="border-slate-200 shadow-sm"><CardContent className="p-2.5"><div className="text-slate-500">Cochos vinculados</div><div className="text-sm font-bold text-slate-900">{cochosVinculados.length}</div></CardContent></Card>
          <Card className="border-slate-200 shadow-sm"><CardContent className="p-2.5"><div className="text-slate-500">Saldo atual</div><div className="text-sm font-bold text-slate-900">{formatKg(indicador.saldoAtual)}</div></CardContent></Card>
          <Card className="border-slate-200 shadow-sm"><CardContent className="p-2.5"><div className="text-slate-500">% uso</div><div className="text-sm font-bold text-slate-900">{Math.round((indicador?.percent || 0) * 100)}%</div></CardContent></Card>
        </div>
        <Card className="border-slate-200 shadow-sm"><CardContent className="p-2.5">
          <div className="grid grid-cols-1 md:grid-cols-[auto,1fr] gap-3 items-center">
            <div className="flex items-center gap-3">
              <IndicadorCopoNivel
                titulo="Depósito"
                subtitulo={formatKg(indicador.saldoAtual)}
                percent={indicador?.percent || 0}
                cor="#64748b"
              />
              {subIconePonto && (
                <img src={subIconePonto} alt={deposito.categoria_ponto || "Depósito"} className="w-10 h-10 object-contain" />
              )}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-[10px]">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                <div className="text-slate-500">Saldo em sacos</div>
                <div className="text-sm font-bold text-slate-900">{saldosAgrupados.reduce((total, item) => total + (item.saldoSacos || 0), 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} sacos</div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                <div className="text-slate-500">Necessidade estimada</div>
                <div className="text-sm font-bold text-slate-900">{formatKg(indicador.necessidadeEstimada)}</div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                <div className="text-slate-500">Nível</div>
                <div className="text-sm font-bold text-slate-900">{Math.round((indicador?.percent || 0) * 100)}%</div>
              </div>
            </div>
          </div>
        </CardContent></Card>
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-3 space-y-2">
          <div className="text-[11px] font-bold text-slate-900">Último Registro</div>
          {ultimoRegistro ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-[10px] space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-900">{ultimoRegistro.produto_nome}</span>
                <Badge variant="outline" className="text-xs">{formatKg(ultimoRegistro.quantidade || 0)}</Badge>
              </div>
              <div className="grid grid-cols-2 gap-2 text-slate-600">
                <div>Tipo: <span className="font-semibold text-slate-900">{ultimoRegistro.tipo_movimentacao}</span></div>
                <div>Data: <span className="font-semibold text-slate-900">{new Date(ultimoRegistro.data_movimentacao).toLocaleString("pt-BR")}</span></div>
                <div>Origem: <span className="font-semibold text-slate-900">{ultimoRegistro.local_origem || "-"}</span></div>
                <div>Destino: <span className="font-semibold text-slate-900">{ultimoRegistro.local_destino || "-"}</span></div>
              </div>
              {ultimoRegistro.observacoes && <div className="text-slate-500 italic">{ultimoRegistro.observacoes}</div>}
            </div>
          ) : (
            <div className="text-xs text-slate-500">Nenhum registro ainda.</div>
          )}
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-3 space-y-2">
          <div className="text-[11px] font-bold text-slate-900">Saldo por Produto</div>
          {saldosAgrupados.length === 0 ? (
            <div className="text-xs text-slate-500">Sem saldo disponível neste depósito.</div>
          ) : (
            <div className="space-y-2">
              {saldosAgrupados.map((item) => (
                <div key={item.produto_id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-medium text-slate-900">{item.produto_nome}</div>
                    <Badge variant="outline" className="text-xs text-slate-700 border-slate-300 bg-white">{formatKg(item.saldo)}</Badge>
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1">Sacos: {(item.saldoSacos || 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-3 space-y-2">
          <div className="text-[11px] font-bold text-slate-900">Pastos atendidos pela saída do estoque</div>
          {cochosVinculados.length === 0 ? (
            <div className="text-xs text-slate-500">Nenhum cocho vinculado a este depósito.</div>
          ) : (
            <div className="space-y-2">
              {cochosVinculados.map((cocho) => (
                <div key={cocho.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="text-xs font-semibold text-slate-900">{cocho.area_vinculada_nome || "Sem pasto vinculado"}</div>
                  <div className="text-[10px] text-slate-500">Cocho: {cocho.nome_ponto}</div>
                  <div className="text-[10px] text-slate-500">Saída do estoque para: {cocho.area_vinculada_nome || "Pasto não informado"}</div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showTransferencia} onOpenChange={setShowTransferencia}>
        <DialogContent className="max-w-[880px]">
          <DialogHeader><DialogTitle className="text-sm">Transferência do Depósito</DialogTitle></DialogHeader>
          <FormularioTransferenciaDeposito deposito={deposito} initialDirection={transferDirection} onSuccess={() => { setShowTransferencia(false); handleSaved(); }} onCancel={() => setShowTransferencia(false)} />
        </DialogContent>
      </Dialog>

      <Dialog open={showHistorico} onOpenChange={setShowHistorico}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="text-sm">Histórico do Depósito</DialogTitle></DialogHeader>
          <HistoricoDepositoSuplementacao deposito={deposito} />
        </DialogContent>
      </Dialog>
    </div>
  );
}