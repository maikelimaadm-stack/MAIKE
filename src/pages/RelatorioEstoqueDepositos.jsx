import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Printer } from "lucide-react";

const fmt = (n) => Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function RelatorioEstoqueDepositos() {
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");
  const [filtroDeposito, setFiltroDeposito] = useState("todos");
  const [filtroProduto, setFiltroProduto] = useState("");
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");

  // Depósitos cadastrados no mapa (PontoSuplementacao com categoria_ponto === "DEPOSITO")
  const { data: depositos = [] } = useQuery({
    queryKey: ["depositos-relatorio", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.PontoSuplementacao.list();
      return all.filter(
        (p) => p.empresa_id === empresaSelecionadaId && p.categoria_ponto === "DEPOSITO" && p.status === "Ativo"
      );
    },
    enabled: !!empresaSelecionadaId,
  });

  const localEstoqueIds = useMemo(() => new Set(depositos.map((d) => d.local_estoque_id).filter(Boolean)), [depositos]);

  // Saldos (lotes nota disponíveis nos locais de estoque dos depósitos)
  const { data: lotesNota = [] } = useQuery({
    queryKey: ["lotes-nota-depositos-rel", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.EstoqueLoteNota.list();
      return all.filter(
        (l) => l.empresa_id === empresaSelecionadaId && localEstoqueIds.has(l.local_estoque_id) && l.status === "Disponivel"
      );
    },
    enabled: !!empresaSelecionadaId && localEstoqueIds.size > 0,
  });

  // Movimentações dos locais de estoque dos depósitos
  const { data: movimentacoes = [] } = useQuery({
    queryKey: ["movimentacoes-depositos-rel", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.MovimentacaoEstoque.list("-data_movimentacao");
      return all.filter(
        (m) =>
          m.empresa_id === empresaSelecionadaId &&
          (localEstoqueIds.has(m.local_estoque_origem) || localEstoqueIds.has(m.local_estoque_destino))
      );
    },
    enabled: !!empresaSelecionadaId && localEstoqueIds.size > 0,
  });

  // Produtos
  const { data: produtos = [] } = useQuery({
    queryKey: ["produtos-depositos-rel", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Produto.list();
      return all.filter((p) => p.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });
  const produtoById = useMemo(() => new Map(produtos.map((p) => [p.id, p])), [produtos]);

  // Mapa local_estoque_id -> depósito
  const depositoByLocalEstoque = useMemo(() => {
    const m = new Map();
    depositos.forEach((d) => { if (d.local_estoque_id) m.set(d.local_estoque_id, d); });
    return m;
  }, [depositos]);

  // Filtrar movimentações por data
  const movsFiltradasPorData = useMemo(() => {
    return movimentacoes.filter((m) => {
      const d = m.data_movimentacao ? new Date(m.data_movimentacao) : null;
      if (!d) return true;
      if (dataInicio && d < new Date(dataInicio)) return false;
      if (dataFim && d > new Date(dataFim + "T23:59:59")) return false;
      return true;
    });
  }, [movimentacoes, dataInicio, dataFim]);

  // Montar linhas: por depósito × produto
  const linhas = useMemo(() => {
    const chaves = new Map(); // "depositoId_produtoId" -> linha

    // Saldo atual por produto por depósito
    lotesNota.forEach((lote) => {
      const deposito = depositoByLocalEstoque.get(lote.local_estoque_id);
      if (!deposito) return;
      if (filtroDeposito !== "todos" && deposito.id !== filtroDeposito) return;
      if (filtroProduto && !(lote.produto_nome || "").toLowerCase().includes(filtroProduto.toLowerCase())) return;

      const key = `${deposito.id}_${lote.produto_id}`;
      const produto = produtoById.get(lote.produto_id);
      const pesoPorSaco = Number(produto?.peso_por_saco_kg || 0);
      const saldoKg = lote.quantidade_disponivel || 0;
      const saldoSacos = pesoPorSaco > 0 ? saldoKg / pesoPorSaco : 0;

      if (!chaves.has(key)) {
        chaves.set(key, {
          deposito_id: deposito.id,
          deposito_nome: deposito.nome_ponto,
          produto_id: lote.produto_id,
          produto_nome: lote.produto_nome,
          saldo_kg: 0,
          saldo_sacos: 0,
          entradas_kg: 0,
          entradas_sacos: 0,
          saidas_kg: 0,
          saidas_sacos: 0,
          pesoPorSaco,
        });
      }
      const linha = chaves.get(key);
      linha.saldo_kg += saldoKg;
      linha.saldo_sacos += saldoSacos;
    });

    // Entradas e saídas por produto por depósito
    movsFiltradasPorData.forEach((mov) => {
      const localId = localEstoqueIds.has(mov.local_estoque_destino) ? mov.local_estoque_destino : mov.local_estoque_origem;
      const deposito = depositoByLocalEstoque.get(localId);
      if (!deposito) return;
      if (filtroDeposito !== "todos" && deposito.id !== filtroDeposito) return;

      const prodId = mov.produto_id;
      const prodNome = mov.produto_nome || "—";
      if (filtroProduto && !prodNome.toLowerCase().includes(filtroProduto.toLowerCase())) return;

      const key = `${deposito.id}_${prodId}`;
      if (!chaves.has(key)) {
        const produto = produtoById.get(prodId);
        const pesoPorSaco = Number(produto?.peso_por_saco_kg || 0);
        chaves.set(key, {
          deposito_id: deposito.id,
          deposito_nome: deposito.nome_ponto,
          produto_id: prodId,
          produto_nome: prodNome,
          saldo_kg: 0,
          saldo_sacos: 0,
          entradas_kg: 0,
          entradas_sacos: 0,
          saidas_kg: 0,
          saidas_sacos: 0,
          pesoPorSaco,
        });
      }
      const linha = chaves.get(key);
      const qtd = Number(mov.quantidade || 0);
      const sacos = linha.pesoPorSaco > 0 ? qtd / linha.pesoPorSaco : 0;

      const isEntrada = localEstoqueIds.has(mov.local_estoque_destino) && mov.local_estoque_destino === deposito.local_estoque_id;
      const isSaida = localEstoqueIds.has(mov.local_estoque_origem) && mov.local_estoque_origem === deposito.local_estoque_id;

      if (isEntrada) { linha.entradas_kg += qtd; linha.entradas_sacos += sacos; }
      if (isSaida) { linha.saidas_kg += qtd; linha.saidas_sacos += sacos; }
    });

    return Array.from(chaves.values()).sort((a, b) =>
      a.deposito_nome.localeCompare(b.deposito_nome) || a.produto_nome.localeCompare(b.produto_nome)
    );
  }, [lotesNota, movsFiltradasPorData, depositoByLocalEstoque, localEstoqueIds, produtoById, filtroDeposito, filtroProduto]);

  const totais = useMemo(() => ({
    entradas_kg: linhas.reduce((s, l) => s + l.entradas_kg, 0),
    entradas_sacos: linhas.reduce((s, l) => s + l.entradas_sacos, 0),
    saidas_kg: linhas.reduce((s, l) => s + l.saidas_kg, 0),
    saidas_sacos: linhas.reduce((s, l) => s + l.saidas_sacos, 0),
    saldo_kg: linhas.reduce((s, l) => s + l.saldo_kg, 0),
    saldo_sacos: linhas.reduce((s, l) => s + l.saldo_sacos, 0),
  }), [linhas]);

  return (
    <div className="absolute inset-0 overflow-y-auto p-4 space-y-4" translate="no">
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .relatorio-depositos-print, .relatorio-depositos-print * { visibility: visible !important; }
          .relatorio-depositos-print { position: fixed !important; inset: 0 !important; overflow: auto !important; background: white !important; padding: 20px !important; z-index: 99999 !important; }
          .no-print { display: none !important; }
        }
      `}</style>

      {/* Filtros */}
      <Card className="no-print">
        <CardHeader className="py-3 bg-slate-50 border-b">
          <CardTitle className="text-sm font-semibold">Relatório de Estoque — Depósitos do Mapa</CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <Label className="text-xs">Depósito</Label>
              <Select value={filtroDeposito} onValueChange={setFiltroDeposito}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos" className="text-xs">Todos</SelectItem>
                  {depositos.map((d) => <SelectItem key={d.id} value={d.id} className="text-xs">{d.nome_ponto}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Produto</Label>
              <Input className="h-8 text-xs" value={filtroProduto} onChange={(e) => setFiltroProduto(e.target.value)} placeholder="Buscar produto..." />
            </div>
            <div>
              <Label className="text-xs">Data Início (movim.)</Label>
              <Input type="date" className="h-8 text-xs" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Data Fim (movim.)</Label>
              <Input type="date" className="h-8 text-xs" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => { setFiltroDeposito("todos"); setFiltroProduto(""); setDataInicio(""); setDataFim(""); }}>
              Limpar Filtros
            </Button>
            <Button size="sm" className="h-8 text-xs bg-slate-700 hover:bg-slate-800 text-white" onClick={() => window.print()}>
              <Printer className="w-3.5 h-3.5 mr-1" /> Imprimir
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Tabela */}
      <div className="relatorio-depositos-print">
        <div className="hidden print:block mb-4">
          <h1 className="text-base font-bold">Relatório de Estoque — Depósitos do Mapa</h1>
          <p className="text-xs text-slate-500">Gerado em {new Date().toLocaleDateString("pt-BR")}</p>
        </div>

        <Card>
          <CardHeader className="py-3 bg-slate-50 border-b">
            <CardTitle className="text-sm font-semibold">Estoque por Depósito e Produto ({linhas.length} linhas)</CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            {linhas.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-sm">Nenhum dado encontrado com os filtros aplicados.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-100">
                    <TableHead className="text-xs font-bold py-2 border border-slate-300">Depósito</TableHead>
                    <TableHead className="text-xs font-bold py-2 border border-slate-300">Produto</TableHead>
                    <TableHead className="text-xs font-bold py-2 border border-slate-300 text-right">Entradas (kg)</TableHead>
                    <TableHead className="text-xs font-bold py-2 border border-slate-300 text-right">Entradas (sacos)</TableHead>
                    <TableHead className="text-xs font-bold py-2 border border-slate-300 text-right">Saídas (kg)</TableHead>
                    <TableHead className="text-xs font-bold py-2 border border-slate-300 text-right">Saídas (sacos)</TableHead>
                    <TableHead className="text-xs font-bold py-2 border border-slate-300 text-right bg-emerald-50">Saldo (kg)</TableHead>
                    <TableHead className="text-xs font-bold py-2 border border-slate-300 text-right bg-emerald-50">Saldo (sacos)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {linhas.map((l, i) => (
                    <TableRow key={`${l.deposito_id}_${l.produto_id}`} className={i % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                      <TableCell className="text-xs py-1.5 border border-slate-200 font-medium">{l.deposito_nome}</TableCell>
                      <TableCell className="text-xs py-1.5 border border-slate-200">{l.produto_nome}</TableCell>
                      <TableCell className="text-xs py-1.5 border border-slate-200 text-right text-emerald-700 font-medium">{fmt(l.entradas_kg)}</TableCell>
                      <TableCell className="text-xs py-1.5 border border-slate-200 text-right text-emerald-700 font-medium">{fmt(l.entradas_sacos)}</TableCell>
                      <TableCell className="text-xs py-1.5 border border-slate-200 text-right text-red-600 font-medium">{fmt(l.saidas_kg)}</TableCell>
                      <TableCell className="text-xs py-1.5 border border-slate-200 text-right text-red-600 font-medium">{fmt(l.saidas_sacos)}</TableCell>
                      <TableCell className="text-xs py-1.5 border border-slate-200 text-right font-bold bg-emerald-50">{fmt(l.saldo_kg)}</TableCell>
                      <TableCell className="text-xs py-1.5 border border-slate-200 text-right font-bold bg-emerald-50">{fmt(l.saldo_sacos)}</TableCell>
                    </TableRow>
                  ))}
                  {/* Totais */}
                  <TableRow className="bg-slate-200 font-bold">
                    <TableCell className="text-xs py-2 border border-slate-400 font-bold" colSpan={2}>TOTAL</TableCell>
                    <TableCell className="text-xs py-2 border border-slate-400 text-right text-emerald-800 font-bold">{fmt(totais.entradas_kg)}</TableCell>
                    <TableCell className="text-xs py-2 border border-slate-400 text-right text-emerald-800 font-bold">{fmt(totais.entradas_sacos)}</TableCell>
                    <TableCell className="text-xs py-2 border border-slate-400 text-right text-red-700 font-bold">{fmt(totais.saidas_kg)}</TableCell>
                    <TableCell className="text-xs py-2 border border-slate-400 text-right text-red-700 font-bold">{fmt(totais.saidas_sacos)}</TableCell>
                    <TableCell className="text-xs py-2 border border-slate-400 text-right font-bold bg-emerald-100">{fmt(totais.saldo_kg)}</TableCell>
                    <TableCell className="text-xs py-2 border border-slate-400 text-right font-bold bg-emerald-100">{fmt(totais.saldo_sacos)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}