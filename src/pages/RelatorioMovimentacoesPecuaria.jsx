import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Printer, Settings } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const formatarNumero = (numero) => {
  if (!numero && numero !== 0) return "";
  return numero.toLocaleString('pt-BR');
};

const COLUNAS_DISPONIVEIS = [
  { id: 'data', label: 'Data', default: true },
  { id: 'tipo', label: 'Tipo', default: true },
  { id: 'motivo', label: 'Motivo', default: true },
  { id: 'quantidade', label: 'Quantidade', default: true },
  { id: 'categoria', label: 'Categoria', default: true },
  { id: 'marca', label: 'Marca', default: true },
  { id: 'sexo', label: 'Sexo', default: false },
  { id: 'setor', label: 'Setor', default: false },
  { id: 'area', label: 'Área', default: false },
  { id: 'peso_medio', label: 'Peso Médio', default: false },
  { id: 'peso_total', label: 'Peso Total', default: false },
  { id: 'valor_unitario', label: 'Valor Unit.', default: false },
  { id: 'valor_total', label: 'Valor Total', default: false },
  { id: 'fornecedor', label: 'Fornecedor', default: false },
  { id: 'comprador', label: 'Comprador', default: false },
  { id: 'nota_fiscal', label: 'Nota Fiscal', default: false },
  { id: 'gta', label: 'GTA', default: false },
  { id: 'observacoes', label: 'Observações', default: false },
];

const ORDENACAO_OPCOES = [
  { value: 'data_desc', label: 'Data (Mais Recente)' },
  { value: 'data_asc', label: 'Data (Mais Antiga)' },
  { value: 'quantidade_desc', label: 'Quantidade (Maior)' },
  { value: 'quantidade_asc', label: 'Quantidade (Menor)' },
  { value: 'categoria_asc', label: 'Categoria (A-Z)' },
  { value: 'marca_asc', label: 'Marca (A-Z)' },
];

export default function RelatorioMovimentacoesPecuaria() {
  const [tipoRelatorio, setTipoRelatorio] = useState("analitico");
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [orientacao, setOrientacao] = useState("paisagem");
  const [agrupamentosAtivos, setAgrupamentosAtivos] = useState([]);
  const [ordenacao, setOrdenacao] = useState('data_desc');

  const [colunasVisiveis, setColunasVisiveis] = useState(() => {
    const saved = localStorage.getItem('colunas_relatorio_mov_pecuaria');
    if (saved) {
      try { return JSON.parse(saved); } catch { }
    }
    return COLUNAS_DISPONIVEIS.filter(c => c.default).map(c => c.id);
  });

  const [tiposSelecionados, setTiposSelecionados] = useState([]);
  const [categoriasSelecionadas, setCategoriasSelecionadas] = useState([]);
  const [marcasSelecionadas, setMarcasSelecionadas] = useState([]);
  const [motivosSelecionados, setMotivosSelecionados] = useState([]);
  const [setoresSelecionados, setSetoresSelecionados] = useState([]);

  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  const { data: movimentacoes = [], isLoading } = useQuery({
    queryKey: ['movimentacoes-pecuaria-relatorio', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.MovimentacaoPecuaria.list('-data_movimentacao');
      return all.filter(m => m.empresa_id === empresaSelecionadaId && !m.lote_id);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: empresaAtual } = useQuery({
    queryKey: ['empresa-atual-relatorio', empresaSelecionadaId],
    queryFn: async () => {
      if (!empresaSelecionadaId) return null;
      const empresas = await base44.entities.Empresa.list();
      return empresas.find(e => e.id === empresaSelecionadaId) || null;
    },
    enabled: !!empresaSelecionadaId,
  });

  const tiposUnicos = ['Entrada', 'Saída'];
  const categoriasUnicas = [...new Set(movimentacoes.map(m => m.categoria_animal))].filter(Boolean).sort();
  const marcasUnicas = [...new Set(movimentacoes.map(m => m.marca))].filter(Boolean).sort();
  const motivosUnicos = [...new Set(movimentacoes.map(m => m.motivo))].filter(Boolean).sort();
  const setoresUnicos = [...new Set(movimentacoes.map(m => m.setor_nome))].filter(Boolean).sort();

  const formatarData = (dataString) => {
    if (!dataString) return '--/--/----';
    try {
      const date = new Date(dataString);
      if (isNaN(date.getTime())) return '--/--/----';
      return format(date, "dd/MM/yyyy", { locale: ptBR });
    } catch { return '--/--/----'; }
  };

  const movimentacoesFiltradas = useMemo(() => {
    let filtered = movimentacoes.filter(m => {
      if (dataInicio && m.data_movimentacao) {
        const mDate = new Date(m.data_movimentacao);
        const iDate = new Date(dataInicio);
        iDate.setHours(0, 0, 0, 0);
        if (mDate < iDate) return false;
      }
      if (dataFim && m.data_movimentacao) {
        const mDate = new Date(m.data_movimentacao);
        const fDate = new Date(dataFim);
        fDate.setHours(23, 59, 59, 999);
        if (mDate > fDate) return false;
      }
      if (tiposSelecionados.length > 0 && !tiposSelecionados.includes(m.tipo)) return false;
      if (categoriasSelecionadas.length > 0 && !categoriasSelecionadas.includes(m.categoria_animal)) return false;
      if (marcasSelecionadas.length > 0 && !marcasSelecionadas.includes(m.marca)) return false;
      if (motivosSelecionados.length > 0 && !motivosSelecionados.includes(m.motivo)) return false;
      if (setoresSelecionados.length > 0 && !setoresSelecionados.includes(m.setor_nome)) return false;
      return true;
    });

    filtered.sort((a, b) => {
      switch (ordenacao) {
        case 'data_desc': return new Date(b.data_movimentacao || 0) - new Date(a.data_movimentacao || 0);
        case 'data_asc': return new Date(a.data_movimentacao || 0) - new Date(b.data_movimentacao || 0);
        case 'quantidade_desc': return (b.quantidade_animais || 0) - (a.quantidade_animais || 0);
        case 'quantidade_asc': return (a.quantidade_animais || 0) - (b.quantidade_animais || 0);
        case 'categoria_asc': return (a.categoria_animal || '').localeCompare(b.categoria_animal || '');
        case 'marca_asc': return (a.marca || '').localeCompare(b.marca || '');
        default: return 0;
      }
    });

    return filtered;
  }, [movimentacoes, dataInicio, dataFim, tiposSelecionados, categoriasSelecionadas, marcasSelecionadas, motivosSelecionados, setoresSelecionados, ordenacao]);

  const movimentacoesAgrupadas = useMemo(() => {
    if (agrupamentosAtivos.length === 0) {
      return { "Todos os Registros": movimentacoesFiltradas };
    }

    const grupos = {};
    movimentacoesFiltradas.forEach(m => {
      let chaveArray = [];
      agrupamentosAtivos.forEach(tipo => {
        let valor;
        switch (tipo) {
          case "tipo": valor = m.tipo || "Sem tipo"; break;
          case "categoria": valor = m.categoria_animal || "Sem categoria"; break;
          case "marca": valor = m.marca || "Sem marca"; break;
          case "motivo": valor = m.motivo || "Sem motivo"; break;
          case "setor": valor = m.setor_nome || "Sem setor"; break;
          case "sexo": valor = m.sexo || "Sem sexo"; break;
          default: valor = "Sem classificação";
        }
        chaveArray.push(valor);
      });
      const chave = chaveArray.join(" → ");
      if (!grupos[chave]) grupos[chave] = [];
      grupos[chave].push(m);
    });

    return grupos;
  }, [movimentacoesFiltradas, agrupamentosAtivos]);

  const toggleColuna = (colunaId) => {
    setColunasVisiveis(prev => {
      const novas = prev.includes(colunaId) ? prev.filter(id => id !== colunaId) : [...prev, colunaId];
      localStorage.setItem('colunas_relatorio_mov_pecuaria', JSON.stringify(novas));
      return novas;
    });
  };

  const toggleFiltro = (lista, setLista, valor) => {
    setLista(prev => prev.includes(valor) ? prev.filter(v => v !== valor) : [...prev, valor]);
  };

  const toggleAgrupamento = (tipo) => {
    setAgrupamentosAtivos(prev => prev.includes(tipo) ? prev.filter(t => t !== tipo) : [...prev, tipo]);
  };

  const limparFiltros = () => {
    setDataInicio("");
    setDataFim("");
    setTiposSelecionados([]);
    setCategoriasSelecionadas([]);
    setMarcasSelecionadas([]);
    setMotivosSelecionados([]);
    setSetoresSelecionados([]);
    setAgrupamentosAtivos([]);
    setOrdenacao('data_desc');
    setTipoRelatorio('analitico');
  };

  const totalEntradas = movimentacoesFiltradas.filter(m => m.tipo === 'Entrada').reduce((s, m) => s + (m.quantidade_animais || 0), 0);
  const totalSaidas = movimentacoesFiltradas.filter(m => m.tipo === 'Saída').reduce((s, m) => s + (m.quantidade_animais || 0), 0);
  const saldoPeriodo = totalEntradas - totalSaidas;

  return (
    <div className="p-4 md:p-6 space-y-2">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 print:hidden">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Relatório de Movimentações Pecuárias</h1>
          <p className="text-xs text-slate-600">Análise e impressão</p>
        </div>
        <Button onClick={() => window.print()} size="sm" className="h-8 gap-1 text-xs bg-emerald-600 hover:bg-emerald-700">
          <Printer className="w-3.5 h-3.5" />
          Imprimir
        </Button>
      </div>

      {/* Filtros na Tela */}
      <Card className="print:hidden">
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Data Início</Label>
              <Input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Data Fim</Label>
              <Input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Orientação</Label>
              <Select value={orientacao} onValueChange={setOrientacao}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="retrato">Retrato</SelectItem>
                  <SelectItem value="paisagem">Paisagem</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tipo Relatório</Label>
              <Select value={tipoRelatorio} onValueChange={setTipoRelatorio}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="analitico">Analítico (Detalhado)</SelectItem>
                  <SelectItem value="sintetico">Sintético (Resumido)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Ordenar Por</Label>
              <Select value={ordenacao} onValueChange={setOrdenacao}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ORDENACAO_OPCOES.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Agrupar Por</Label>
            <div className="flex flex-wrap gap-1">
              {['tipo', 'categoria', 'marca', 'motivo', 'setor', 'sexo'].map((tipo) => (
                <Button
                  key={tipo}
                  variant={agrupamentosAtivos.includes(tipo) ? "default" : "outline"}
                  size="sm"
                  onClick={() => toggleAgrupamento(tipo)}
                  className={`h-7 text-xs ${agrupamentosAtivos.includes(tipo) ? "bg-emerald-600 hover:bg-emerald-700" : ""}`}
                >
                  {tipo.charAt(0).toUpperCase() + tipo.slice(1)}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex gap-2 flex-wrap">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 text-xs">Tipos {tiposSelecionados.length > 0 && `(${tiposSelecionados.length})`}</Button>
              </PopoverTrigger>
              <PopoverContent className="w-48">
                <div className="space-y-2">
                  <h4 className="font-semibold text-sm mb-2">Tipos</h4>
                  {tiposUnicos.map(t => (
                    <div key={t} className="flex items-center space-x-2">
                      <Checkbox checked={tiposSelecionados.includes(t)} onCheckedChange={() => toggleFiltro(tiposSelecionados, setTiposSelecionados, t)} />
                      <label className="text-sm cursor-pointer">{t}</label>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 text-xs">Categorias {categoriasSelecionadas.length > 0 && `(${categoriasSelecionadas.length})`}</Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 max-h-96 overflow-auto">
                <div className="space-y-2">
                  <h4 className="font-semibold text-sm mb-2">Categorias</h4>
                  {categoriasUnicas.map(c => (
                    <div key={c} className="flex items-center space-x-2">
                      <Checkbox checked={categoriasSelecionadas.includes(c)} onCheckedChange={() => toggleFiltro(categoriasSelecionadas, setCategoriasSelecionadas, c)} />
                      <label className="text-sm cursor-pointer">{c}</label>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 text-xs">Marcas {marcasSelecionadas.length > 0 && `(${marcasSelecionadas.length})`}</Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 max-h-96 overflow-auto">
                <div className="space-y-2">
                  <h4 className="font-semibold text-sm mb-2">Marcas</h4>
                  {marcasUnicas.map(m => (
                    <div key={m} className="flex items-center space-x-2">
                      <Checkbox checked={marcasSelecionadas.includes(m)} onCheckedChange={() => toggleFiltro(marcasSelecionadas, setMarcasSelecionadas, m)} />
                      <label className="text-sm cursor-pointer">{m}</label>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 text-xs">Motivos {motivosSelecionados.length > 0 && `(${motivosSelecionados.length})`}</Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 max-h-96 overflow-auto">
                <div className="space-y-2">
                  <h4 className="font-semibold text-sm mb-2">Motivos</h4>
                  {motivosUnicos.map(m => (
                    <div key={m} className="flex items-center space-x-2">
                      <Checkbox checked={motivosSelecionados.includes(m)} onCheckedChange={() => toggleFiltro(motivosSelecionados, setMotivosSelecionados, m)} />
                      <label className="text-sm cursor-pointer">{m}</label>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 text-xs">Setores {setoresSelecionados.length > 0 && `(${setoresSelecionados.length})`}</Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 max-h-96 overflow-auto">
                <div className="space-y-2">
                  <h4 className="font-semibold text-sm mb-2">Setores</h4>
                  {setoresUnicos.map(s => (
                    <div key={s} className="flex items-center space-x-2">
                      <Checkbox checked={setoresSelecionados.includes(s)} onCheckedChange={() => toggleFiltro(setoresSelecionados, setSetoresSelecionados, s)} />
                      <label className="text-sm cursor-pointer">{s}</label>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 text-xs gap-1">
                  <Settings className="w-3.5 h-3.5" />
                  Colunas
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 max-h-96 overflow-y-auto">
                <DropdownMenuLabel>Colunas Visíveis</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {COLUNAS_DISPONIVEIS.map((coluna) => (
                  <DropdownMenuCheckboxItem
                    key={coluna.id}
                    checked={colunasVisiveis.includes(coluna.id)}
                    onCheckedChange={() => toggleColuna(coluna.id)}
                  >
                    {coluna.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={limparFiltros}>Limpar Filtros</Button>
          </div>
        </CardContent>
      </Card>

      {/* Área de Impressão */}
      <div className={`bg-white print:shadow-none ${orientacao === 'paisagem' ? 'print:landscape' : ''}`}>
        <style dangerouslySetInnerHTML={{__html: `
          @media print {
            @page { size: ${orientacao === 'paisagem' ? 'A4 landscape' : 'A4 portrait'}; margin: 1.5cm 1cm 2cm 1cm; }
            body * { visibility: hidden; }
            .print-area, .print-area * { visibility: visible; }
            .print-area { position: absolute; left: 0; top: 0; width: 100%; }
            header, nav, .no-print, .print\\:hidden { display: none !important; }
          }
        `}} />

        <div className="print-area p-8 print:p-0">
          {/* Cabeçalho */}
          <div className="border-b-2 border-black pb-1 mb-2">
            <div className="flex items-center justify-between gap-3">
              {empresaAtual?.logotipo_url && (
                <img src={empresaAtual.logotipo_url} alt={empresaAtual.apelido || "Logo"} className="h-24 w-24 object-contain" />
              )}
              <div className="flex-1 text-center">
                <h1 className="text-base font-bold leading-tight uppercase">{empresaAtual?.nome || 'Empresa'}</h1>
                {empresaAtual?.apelido && empresaAtual.apelido !== empresaAtual.nome && (
                  <p className="text-xs leading-tight">{empresaAtual.apelido}</p>
                )}
                {empresaAtual?.endereco && (
                  <p className="text-xs leading-tight">
                    {empresaAtual.endereco}
                    {empresaAtual?.cidade && empresaAtual?.estado && `, ${empresaAtual.cidade}-${empresaAtual.estado}`}
                  </p>
                )}
              </div>
            </div>
            <div>
              <h2 className="text-base font-bold">Relatório de Movimentações Pecuárias {tipoRelatorio === 'analitico' ? '(Analítico)' : '(Sintético)'}</h2>
              {(dataInicio || dataFim) && (
                <p className="text-xs text-gray-600">
                  Período: {dataInicio ? formatarData(dataInicio) : "Início"} a {dataFim ? formatarData(dataFim) : "Hoje"}
                </p>
              )}
              <p className="text-xs text-gray-600">
                {movimentacoesFiltradas.length} registro(s) • Entradas: +{formatarNumero(totalEntradas)} cab • Saídas: -{formatarNumero(totalSaidas)} cab • Saldo: {saldoPeriodo >= 0 ? '+' : ''}{formatarNumero(saldoPeriodo)} cab
              </p>
            </div>
          </div>

          {movimentacoesFiltradas.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <p>Nenhuma movimentação encontrada com os filtros aplicados.</p>
            </div>
          ) : (
            <>
              {Object.entries(movimentacoesAgrupadas).map(([grupo, registros], idx) => {
                const totalGrupoEnt = registros.filter(r => r.tipo === 'Entrada').reduce((s, r) => s + (r.quantidade_animais || 0), 0);
                const totalGrupoSai = registros.filter(r => r.tipo === 'Saída').reduce((s, r) => s + (r.quantidade_animais || 0), 0);
                const saldoGrupo = totalGrupoEnt - totalGrupoSai;

                return (
                  <div key={idx} className="mb-4">
                    {agrupamentosAtivos.length > 0 && (
                      <div className="bg-gray-200 px-2 py-1 mb-1">
                        <h3 className="font-bold text-xs">{grupo}</h3>
                      </div>
                    )}

                    {tipoRelatorio === 'analitico' && (
                      <Table>
                        <TableHeader>
                          <TableRow className="border-black">
                            {colunasVisiveis.includes('data') && <TableHead className="border border-black text-xs font-bold py-1">Data</TableHead>}
                            {colunasVisiveis.includes('tipo') && <TableHead className="border border-black text-xs font-bold py-1">Tipo</TableHead>}
                            {colunasVisiveis.includes('motivo') && <TableHead className="border border-black text-xs font-bold py-1">Motivo</TableHead>}
                            {colunasVisiveis.includes('quantidade') && <TableHead className="border border-black text-xs font-bold text-right py-1">Qtd</TableHead>}
                            {colunasVisiveis.includes('categoria') && <TableHead className="border border-black text-xs font-bold py-1">Categoria</TableHead>}
                            {colunasVisiveis.includes('marca') && <TableHead className="border border-black text-xs font-bold py-1">Marca</TableHead>}
                            {colunasVisiveis.includes('sexo') && <TableHead className="border border-black text-xs font-bold py-1">Sexo</TableHead>}
                            {colunasVisiveis.includes('setor') && <TableHead className="border border-black text-xs font-bold py-1">Setor</TableHead>}
                            {colunasVisiveis.includes('area') && <TableHead className="border border-black text-xs font-bold py-1">Área</TableHead>}
                            {colunasVisiveis.includes('peso_medio') && <TableHead className="border border-black text-xs font-bold text-right py-1">P.Médio</TableHead>}
                            {colunasVisiveis.includes('peso_total') && <TableHead className="border border-black text-xs font-bold text-right py-1">P.Total</TableHead>}
                            {colunasVisiveis.includes('valor_unitario') && <TableHead className="border border-black text-xs font-bold text-right py-1">Vlr.Unit</TableHead>}
                            {colunasVisiveis.includes('valor_total') && <TableHead className="border border-black text-xs font-bold text-right py-1">Vlr.Total</TableHead>}
                            {colunasVisiveis.includes('fornecedor') && <TableHead className="border border-black text-xs font-bold py-1">Fornec.</TableHead>}
                            {colunasVisiveis.includes('comprador') && <TableHead className="border border-black text-xs font-bold py-1">Comprador</TableHead>}
                            {colunasVisiveis.includes('nota_fiscal') && <TableHead className="border border-black text-xs font-bold py-1">NF</TableHead>}
                            {colunasVisiveis.includes('gta') && <TableHead className="border border-black text-xs font-bold py-1">GTA</TableHead>}
                            {colunasVisiveis.includes('observacoes') && <TableHead className="border border-black text-xs font-bold py-1">Obs</TableHead>}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {registros.map((m) => {
                            const areaExibir = m.tipo === 'Entrada' ? m.area_destino_nome : m.area_origem_nome;
                            return (
                              <TableRow key={m.id}>
                                {colunasVisiveis.includes('data') && <TableCell className="border border-gray-300 text-xs py-1">{formatarData(m.data_movimentacao)}</TableCell>}
                                {colunasVisiveis.includes('tipo') && <TableCell className="border border-gray-300 text-xs py-1">{m.tipo}</TableCell>}
                                {colunasVisiveis.includes('motivo') && <TableCell className="border border-gray-300 text-xs py-1">{m.motivo || ''}</TableCell>}
                                {colunasVisiveis.includes('quantidade') && <TableCell className="border border-gray-300 text-xs text-right py-1">{m.quantidade_animais}</TableCell>}
                                {colunasVisiveis.includes('categoria') && <TableCell className="border border-gray-300 text-xs py-1">{m.categoria_animal || ''}</TableCell>}
                                {colunasVisiveis.includes('marca') && <TableCell className="border border-gray-300 text-xs py-1">{m.marca || ''}</TableCell>}
                                {colunasVisiveis.includes('sexo') && <TableCell className="border border-gray-300 text-xs py-1">{m.sexo || ''}</TableCell>}
                                {colunasVisiveis.includes('setor') && <TableCell className="border border-gray-300 text-xs py-1">{m.setor_nome || ''}</TableCell>}
                                {colunasVisiveis.includes('area') && <TableCell className="border border-gray-300 text-xs py-1">{areaExibir || ''}</TableCell>}
                                {colunasVisiveis.includes('peso_medio') && <TableCell className="border border-gray-300 text-xs text-right py-1">{m.peso_medio ? `${m.peso_medio} kg` : ''}</TableCell>}
                                {colunasVisiveis.includes('peso_total') && <TableCell className="border border-gray-300 text-xs text-right py-1">{m.peso_total ? `${m.peso_total} kg` : ''}</TableCell>}
                                {colunasVisiveis.includes('valor_unitario') && <TableCell className="border border-gray-300 text-xs text-right py-1">{m.valor_unitario ? `R$ ${m.valor_unitario.toFixed(2)}` : ''}</TableCell>}
                                {colunasVisiveis.includes('valor_total') && <TableCell className="border border-gray-300 text-xs text-right py-1">{m.valor_total ? `R$ ${m.valor_total.toFixed(2)}` : ''}</TableCell>}
                                {colunasVisiveis.includes('fornecedor') && <TableCell className="border border-gray-300 text-xs py-1">{m.fornecedor_origem || ''}</TableCell>}
                                {colunasVisiveis.includes('comprador') && <TableCell className="border border-gray-300 text-xs py-1">{m.destino_venda || ''}</TableCell>}
                                {colunasVisiveis.includes('nota_fiscal') && <TableCell className="border border-gray-300 text-xs py-1">{m.nota_fiscal || ''}</TableCell>}
                                {colunasVisiveis.includes('gta') && <TableCell className="border border-gray-300 text-xs py-1">{m.gta || ''}</TableCell>}
                                {colunasVisiveis.includes('observacoes') && <TableCell className="border border-gray-300 text-xs py-1 max-w-[100px] truncate">{m.observacoes || ''}</TableCell>}
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    )}

                    <Table className="mt-1">
                      <TableBody>
                        <TableRow className="bg-gray-100 font-bold">
                          <TableCell colSpan={20} className="border border-black text-xs py-1">
                            SUBTOTAL ({registros.length} reg): Ent: +{formatarNumero(totalGrupoEnt)} • Saí: -{formatarNumero(totalGrupoSai)} • Saldo: {saldoGrupo >= 0 ? '+' : ''}{formatarNumero(saldoGrupo)} cab
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                );
              })}

              {/* Total Geral */}
              <div className="mt-4 border-t-2 border-black pt-2">
                <div className="flex justify-between items-center">
                  <div className="text-xs font-bold">TOTAL GERAL: {movimentacoesFiltradas.length} registro(s)</div>
                  <div className="text-xs font-bold">
                    Entradas: +{formatarNumero(totalEntradas)} cab | Saídas: -{formatarNumero(totalSaidas)} cab | Saldo: {saldoPeriodo >= 0 ? '+' : ''}{formatarNumero(saldoPeriodo)} cab
                  </div>
                </div>
              </div>

              <div className="mt-6 pt-2 border-t border-gray-300 text-center text-xs text-gray-500">
                <p>Impresso em: {format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}