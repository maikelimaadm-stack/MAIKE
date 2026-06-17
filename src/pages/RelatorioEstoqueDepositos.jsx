import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Printer, X } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const formatarNumero = (num, decimais = 2) => {
  if (num === null || num === undefined || isNaN(num)) return "0,00";
  return Number(num).toLocaleString("pt-BR", { minimumFractionDigits: decimais, maximumFractionDigits: decimais });
};

const formatarData = (dataString) => {
  if (!dataString) return "-";
  try { return format(new Date(dataString), "dd/MM/yyyy", { locale: ptBR }); } catch { return "-"; }
};

export default function RelatorioEstoqueDepositos() {
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");
  const [filtroDeposito, setFiltroDeposito] = useState("todos");
  const [filtroProduto, setFiltroProduto] = useState("");
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [orientacao, setOrientacao] = useState("paisagem");

  const { data: empresaAtual } = useQuery({
    queryKey: ["empresa-depositos-rel", empresaSelecionadaId],
    queryFn: async () => {
      const empresas = await base44.entities.Empresa.list();
      return empresas.find((e) => e.id === empresaSelecionadaId) || null;
    },
    enabled: !!empresaSelecionadaId,
  });

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

  const { data: produtos = [] } = useQuery({
    queryKey: ["produtos-depositos-rel", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Produto.list();
      return all.filter((p) => p.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });
  const produtoById = useMemo(() => new Map(produtos.map((p) => [p.id, p])), [produtos]);

  const depositoByLocalEstoque = useMemo(() => {
    const m = new Map();
    depositos.forEach((d) => { if (d.local_estoque_id) m.set(d.local_estoque_id, d); });
    return m;
  }, [depositos]);

  const movsFiltradasPorData = useMemo(() => {
    return movimentacoes.filter((m) => {
      const d = m.data_movimentacao ? new Date(m.data_movimentacao) : null;
      if (!d) return true;
      if (dataInicio) { const di = new Date(dataInicio); di.setHours(0, 0, 0, 0); if (d < di) return false; }
      if (dataFim) { const df = new Date(dataFim); df.setHours(23, 59, 59, 999); if (d > df) return false; }
      return true;
    });
  }, [movimentacoes, dataInicio, dataFim]);

  const linhas = useMemo(() => {
    const chaves = new Map();

    lotesNota.forEach((lote) => {
      const deposito = depositoByLocalEstoque.get(lote.local_estoque_id);
      if (!deposito) return;
      if (filtroDeposito !== "todos" && deposito.id !== filtroDeposito) return;
      if (filtroProduto && !(lote.produto_nome || "").toLowerCase().includes(filtroProduto.toLowerCase())) return;

      const key = `${deposito.id}_${lote.produto_id}`;
      const produto = produtoById.get(lote.produto_id);
      const pesoPorSaco = Number(produto?.peso_por_saco_kg || 0);
      const saldoKg = lote.quantidade_disponivel || 0;

      if (!chaves.has(key)) {
        chaves.set(key, {
          deposito_id: deposito.id,
          deposito_nome: deposito.nome_ponto,
          produto_id: lote.produto_id,
          produto_nome: lote.produto_nome,
          unidade: produto?.unidade_medida || "KG",
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
      linha.saldo_sacos += pesoPorSaco > 0 ? saldoKg / pesoPorSaco : 0;
    });

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
          unidade: produto?.unidade_medida || "KG",
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

  const limparFiltros = () => {
    setFiltroDeposito("todos");
    setFiltroProduto("");
    setDataInicio("");
    setDataFim("");
  };

  return (
    <div className="absolute inset-0 overflow-y-auto p-4 md:p-6 space-y-2" translate="no">

      {/* Cabeçalho */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 print:hidden">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Estoque — Depósitos do Mapa</h1>
          <p className="text-xs text-slate-600">Entradas, saídas e saldo atual dos depósitos de suplementação</p>
        </div>
        <Button onClick={() => window.print()} size="sm" className="h-8 gap-1 text-xs bg-emerald-600 hover:bg-emerald-700">
          <Printer className="w-3.5 h-3.5" />
          Imprimir
        </Button>
      </div>

      {/* Filtros */}
      <Card className="print:hidden">
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">Depósito</Label>
              <Select value={filtroDeposito} onValueChange={setFiltroDeposito}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos" className="text-xs">Todos</SelectItem>
                  {depositos.map((d) => <SelectItem key={d.id} value={d.id} className="text-xs">{d.nome_ponto}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Orientação</Label>
              <Select value={orientacao} onValueChange={setOrientacao}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="paisagem" className="text-xs">Paisagem</SelectItem>
                  <SelectItem value="retrato" className="text-xs">Retrato</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Data Início (movim.)</Label>
              <Input type="date" className="h-8 text-xs" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Data Fim (movim.)</Label>
              <Input type="date" className="h-8 text-xs" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">Produto</Label>
              <Input className="h-8 text-xs" value={filtroProduto} onChange={(e) => setFiltroProduto(e.target.value)} placeholder="Buscar produto..." />
            </div>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={limparFiltros}>
              <X className="w-3.5 h-3.5 mr-1" />
              Limpar Filtros
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Área de Impressão */}
      <div className="bg-white print:shadow-none">
        <style dangerouslySetInnerHTML={{__html: `
          @media print {
            @page { size: A4 ${orientacao}; margin: 1.5cm 1cm 2cm 1cm; }
            body * { visibility: hidden; }
            .print-area, .print-area * { visibility: visible; }
            .print-area { position: absolute; left: 0; top: 0; width: 100%; }
            header, nav, .no-print, .print\\:hidden { display: none !important; }
          }
        `}} />

        <div className="print-area p-4 print:p-0">
          {/* Cabeçalho do Relatório */}
          <div className="border-b-2 border-black pb-1 mb-2">
            <div className="flex items-center justify-between gap-3">
              {empresaAtual?.logotipo_url && (
                <img src={empresaAtual.logotipo_url} alt="Logo" className="h-16 w-16 object-contain" />
              )}
              <div className="flex-1 text-center">
                <h1 className="text-base font-bold uppercase">{empresaAtual?.nome || "Empresa"}</h1>
                {empresaAtual?.endereco && (
                  <p className="text-xs">{empresaAtual.endereco}{empresaAtual?.cidade && `, ${empresaAtual.cidade}-${empresaAtual.estado}`}</p>
                )}
              </div>
            </div>
            <div className="mt-1">
              <h2 className="text-sm font-bold">Estoque — Depósitos do Mapa</h2>
              <p className="text-xs text-gray-600">
                {linhas.length} registro(s)
                {filtroDeposito !== "todos" && ` | Depósito: ${depositos.find((d) => d.id === filtroDeposito)?.nome_ponto || filtroDeposito}`}
                {filtroProduto && ` | Produto: ${filtroProduto}`}
                {dataInicio && ` | De: ${formatarData(dataInicio)}`}
                {dataFim && ` até ${formatarData(dataFim)}`}
              </p>
            </div>
          </div>

          {/* Tabela */}
          {linhas.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <p className="text-sm">Nenhum registro encontrado com os filtros aplicados</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs font-bold py-1 border border-black">Depósito</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black">Produto</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black">UN</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black text-right">Entradas (kg)</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black text-right">Entradas (sacos)</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black text-right">Saídas (kg)</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black text-right">Saídas (sacos)</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black text-right bg-blue-50">Saldo (kg)</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black text-right bg-blue-50">Saldo (sacos)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {linhas.map((l, i) => (
                  <TableRow key={`${l.deposito_id}_${l.produto_id}`} className="hover:bg-gray-50">
                    <TableCell className="text-xs py-1 border border-gray-300 font-medium">{l.deposito_nome}</TableCell>
                    <TableCell className="text-xs py-1 border border-gray-300">{l.produto_nome}</TableCell>
                    <TableCell className="text-xs py-1 border border-gray-300">{l.unidade}</TableCell>
                    <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono text-green-700">{formatarNumero(l.entradas_kg)}</TableCell>
                    <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono text-green-700">{l.pesoPorSaco > 0 ? formatarNumero(l.entradas_sacos) : "-"}</TableCell>
                    <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono text-red-700">{formatarNumero(l.saidas_kg)}</TableCell>
                    <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono text-red-700">{l.pesoPorSaco > 0 ? formatarNumero(l.saidas_sacos) : "-"}</TableCell>
                    <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono font-semibold bg-blue-50">{formatarNumero(l.saldo_kg)}</TableCell>
                    <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono font-semibold bg-blue-50">{l.pesoPorSaco > 0 ? formatarNumero(l.saldo_sacos) : "-"}</TableCell>
                  </TableRow>
                ))}

                {/* Totais */}
                <TableRow className="bg-gray-100 font-bold">
                  <TableCell colSpan={3} className="text-xs py-1 border border-black">TOTAL</TableCell>
                  <TableCell className="text-xs py-1 border border-black text-right font-mono text-green-700">{formatarNumero(totais.entradas_kg)}</TableCell>
                  <TableCell className="text-xs py-1 border border-black text-right font-mono text-green-700">{formatarNumero(totais.entradas_sacos)}</TableCell>
                  <TableCell className="text-xs py-1 border border-black text-right font-mono text-red-700">{formatarNumero(totais.saidas_kg)}</TableCell>
                  <TableCell className="text-xs py-1 border border-black text-right font-mono text-red-700">{formatarNumero(totais.saidas_sacos)}</TableCell>
                  <TableCell className="text-xs py-1 border border-black text-right font-mono bg-blue-50">{formatarNumero(totais.saldo_kg)}</TableCell>
                  <TableCell className="text-xs py-1 border border-black text-right font-mono bg-blue-50">{formatarNumero(totais.saldo_sacos)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}

          {/* Rodapé */}
          <div className="mt-4 pt-2 border-t border-gray-300 text-center text-xs text-gray-500">
            <p>Impresso em: {format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</p>
          </div>
        </div>
      </div>
    </div>
  );
}