import React, { useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import FormularioTransferenciaDeposito from "./FormularioTransferenciaDeposito";
import { normalizeText } from "../suplementacao/estoqueSuplementacaoUtils";

export default function DetalhesDepositoSuplementacao({ deposito, onClose }) {
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");
  const [showTransferencia, setShowTransferencia] = useState(false);
  const [transferDirection, setTransferDirection] = useState("entrada");

  const { data: lotesNota = [] } = useQuery({
    queryKey: ["saldo-deposito", deposito.id],
    queryFn: async () => {
      const all = await base44.entities.EstoqueLoteNota.list();
      return all.filter((lote) => lote.empresa_id === empresaSelecionadaId && lote.local_estoque_id === deposito.local_estoque_id && lote.status === "Disponivel");
    },
    enabled: !!empresaSelecionadaId && !!deposito.local_estoque_id,
  });

  const { data: pontosSuplementacao = [] } = useQuery({
    queryKey: ["cochos-vinculados-deposito", deposito.id],
    queryFn: async () => {
      const all = await base44.entities.PontoSuplementacao.list();
      return all.filter((ponto) => ponto.empresa_id === empresaSelecionadaId && ponto.status === "Ativo");
    },
    enabled: !!empresaSelecionadaId,
  });

  const saldosAgrupados = useMemo(() => {
    const mapa = new Map();
    lotesNota.forEach((lote) => {
      const current = mapa.get(lote.produto_id) || {
        produto_id: lote.produto_id,
        produto_nome: lote.produto_nome,
        saldo: 0,
      };
      current.saldo += lote.quantidade_disponivel || 0;
      mapa.set(lote.produto_id, current);
    });
    return Array.from(mapa.values()).sort((a, b) => a.produto_nome.localeCompare(b.produto_nome));
  }, [lotesNota]);

  const cochosVinculados = useMemo(() => {
    return pontosSuplementacao.filter((ponto) => {
      const categoria = normalizeText(ponto.categoria_ponto || "COCHO");
      return categoria === "COCHO" && ponto.deposito_origem_id === deposito.id;
    });
  }, [pontosSuplementacao, deposito.id]);

  return (
    <div className="space-y-4" translate="no">
      <div className="flex items-start justify-between pb-2 border-b">
        <div>
          <div className="text-sm font-bold text-slate-900 mb-1">{deposito.nome_ponto}</div>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="text-xs">Depósito</Badge>
            <Badge variant="outline" className="text-xs">{deposito.local_estoque_nome || "Sem local"}</Badge>
          </div>
        </div>
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-3 space-y-2">
          <div className="text-[11px] font-bold text-slate-900">Resumo do Depósito</div>
          <div className="grid grid-cols-2 gap-2 text-[10px]">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
              <div className="text-slate-500">Produtos com saldo</div>
              <div className="text-sm font-bold text-slate-900">{saldosAgrupados.length}</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
              <div className="text-slate-500">Cochos vinculados</div>
              <div className="text-sm font-bold text-slate-900">{cochosVinculados.length}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-3 space-y-2">
          <div className="text-[11px] font-bold text-slate-900">Saldo de Suplementação</div>
          {saldosAgrupados.length === 0 ? (
            <div className="text-xs text-slate-500">Sem saldo disponível neste depósito.</div>
          ) : (
            <div className="space-y-2">
              {saldosAgrupados.map((item) => (
                <div key={item.produto_id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="text-xs font-medium text-slate-900">{item.produto_nome}</div>
                  <Badge variant="outline" className="text-xs">{item.saldo.toFixed(2)}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-3 space-y-2">
          <div className="text-[11px] font-bold text-slate-900">Cochos Vinculados</div>
          {cochosVinculados.length === 0 ? (
            <div className="text-xs text-slate-500">Nenhum cocho vinculado a este depósito.</div>
          ) : (
            <div className="space-y-2">
              {cochosVinculados.map((cocho) => (
                <div key={cocho.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="text-xs font-semibold text-slate-900">{cocho.nome_ponto}</div>
                  <div className="text-[10px] text-slate-500">{cocho.area_vinculada_nome || "Sem área vinculada"}</div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          onClick={() => {
            setTransferDirection("entrada");
            setShowTransferencia(true);
          }}
        >
          Entrada
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          onClick={() => {
            setTransferDirection("saida");
            setShowTransferencia(true);
          }}
        >
          Saída
        </Button>
      </div>

      <Dialog open={showTransferencia} onOpenChange={setShowTransferencia}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-sm">Transferência do Depósito</DialogTitle>
          </DialogHeader>
          <FormularioTransferenciaDeposito
            deposito={deposito}
            initialDirection={transferDirection}
            onSuccess={() => setShowTransferencia(false)}
            onCancel={() => setShowTransferencia(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}