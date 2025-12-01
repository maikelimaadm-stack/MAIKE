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
  { id: 'data_pesagem', label: 'Data', default: true },
  { id: 'numero_animal', label: 'Animal', default: true },
  { id: 'sexo', label: 'Sexo', default: true },
  { id: 'raca', label: 'Raça', default: true },
  { id: 'peso', label: 'Peso (kg)', default: true },
  { id: 'nome_lote', label: 'Lote', default: true },
  { id: 'nome_apartacao', label: 'Apartação', default: true },
  { id: 'data_anterior', label: 'Data Anterior', default: false },
  { id: 'peso_anterior', label: 'Peso Anterior', default: false },
  { id: 'dias', label: 'Dias', default: true },
  { id: 'ganho', label: 'Ganho (kg)', default: true },
  { id: 'gmd', label: 'GMD', default: true },
  { id: 'observacao', label: 'Observação', default: false },
];

const EIXO_X_OPCOES = [
  { value: 'nome_lote', label: 'Lote' },
  { value: 'nome_apartacao', label: 'Apartação' },
  { value: 'sexo', label: 'Sexo' },
  { value: 'raca', label: 'Raça' },
  { value: 'mes', label: 'Mês' },
];

const EIXO_Y_OPCOES = [
  { value: 'nome_lote', label: 'Lote' },
  { value: 'nome_apartacao', label: 'Apartação' },
  { value: 'sexo', label: 'Sexo' },
  { value: 'raca', label: 'Raça' },
  { value: 'mes', label: 'Mês' },
];

const ORDENACAO_OPCOES = [
  { value: 'data_desc', label: 'Data (Mais Recente)' },
  { value: 'data_asc', label: 'Data (Mais Antiga)' },
  { value: 'peso_desc', label: 'Peso (Maior)' },
  { value: 'peso_asc', label: 'Peso (Menor)' },
  { value: 'gmd_desc', label: 'GMD (Maior)' },
  { value: 'gmd_asc', label: 'GMD (Menor)' },
  { value: 'animal_asc', label: 'Animal (A-Z)' },
  { value: 'lote_asc', label: 'Lote (A-Z)' },
];

export default function RelatorioPesagensIndividuais() {
  const [tipoRelatorio, setTipoRelatorio] = useState("analitico");
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [orientacao, setOrientacao] = useState("paisagem");
  const [agrupamentosAtivos, setAgrupamentosAtivos] = useState([]);
  const [ordenacao, setOrdenacao] = useState('data_desc');
  const [eixoXSintetico, setEixoXSintetico] = useState('nome_lote');
  const [eixoYSintetico, setEixoYSintetico] = useState('sexo');

  const [colunasVisiveis, setColunasVisiveis] = useState(() => {
    const saved = localStorage.getItem('colunas_relatorio_pesagens_ind');
    if (saved) {
      try { return JSON.parse(saved); } catch { }
    }
    return COLUNAS_DISPONIVEIS.filter(c => c.default).map(c => c.id);
  });

  const [lotesSelecionados, setLotesSelecionados] = useState([]);
  const [apartacoesSelecionadas, setApartacoesSelecionadas] = useState([]);
  const [sexosSelecionados, setSexosSelecionados] = useState([]);
  const [racasSelecionadas, setRacasSelecionadas] = useState([]);

  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  const { data: pesagens = [], isLoading } = useQuery({
    queryKey: ['pesagens-individuais-relatorio', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.PesagemIndividual.list('-data_pesagem');
      return all.filter(p => p.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: lotesApartacao = [] } = useQuery({
    queryKey: ['lotes-apartacao-relatorio', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.LoteApartacao.list();
      return all.filter(l => l.empresa_id === empresaSelecionadaId);
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

  const lotesUnicos = [...new Set(pesagens.map(p => p.nome_lote))].filter(Boolean).sort();
  const apartacoesUnicas = [...new Set(pesagens.map(p => p.nome_apartacao))].filter(Boolean).sort();
  const sexosUnicos = [...new Set(pesagens.map(p => p.sexo))].filter(Boolean).sort();
  const racasUnicas = [...new Set(pesagens.map(p => p.raca))].filter(Boolean).sort();

  const formatarData = (dataString) => {
    if (!dataString) return '--/--/----';
    try {
      const date = new Date(dataString);
      if (isNaN(date.getTime())) return '--/--/----';
      return format(date, "dd/MM/yyyy", { locale: ptBR });
    } catch { return '--/--/----'; }
  };

  const pesagensFiltradas = useMemo(() => {
    let filtered = pesagens.filter(p => {
      if (dataInicio && p.data_pesagem) {
        const pDate = new Date(p.data_pesagem);
        const iDate = new Date(dataInicio);
        iDate.setHours(0, 0, 0, 0);
        if (pDate < iDate) return false;
      }
      if (dataFim && p.data_pesagem) {
        const pDate = new Date(p.data_pesagem);
        const fDate = new Date(dataFim);
        fDate.setHours(23, 59, 59, 999);
        if (pDate > fDate) return false;
      }
      if (lotesSelecionados.length > 0 && !lotesSelecionados.includes(p.nome_lote)) return false;
      if (apartacoesSelecionadas.length > 0 && !apartacoesSelecionadas.includes(p.nome_apartacao)) return false;
      if (sexosSelecionados.length > 0 && !sexosSelecionados.includes(p.sexo)) return false;
      if (racasSelecionadas.length > 0 && !racasSelecionadas.includes(p.raca)) return false;
      return true;
    });

    filtered.sort((a, b) => {
      switch (ordenacao) {
        case 'data_desc': return new Date(b.data_pesagem || 0) - new Date(a.data_pesagem || 0);
        case 'data_asc': return new Date(a.data_pesagem || 0) - new Date(b.data_pesagem || 0);
        case 'peso_desc': return (b.peso || 0) - (a.peso || 0);
        case 'peso_asc': return (a.peso || 0) - (b.peso || 0);
        case 'gmd_desc': return (b.gmd || 0) - (a.gmd || 0);
        case 'gmd_asc': return (a.gmd || 0) - (b.gmd || 0);
        case 'animal_asc': return (a.numero_animal || '').localeCompare(b.numero_animal || '');
        case 'lote_asc': return (a.nome_lote || '').localeCompare(b.nome_lote || '');
        default: return 0;
      }
    });

    return filtered;
  }, [pesagens, dataInicio, dataFim, lotesSelecionados, apartacoesSelecionadas, sexosSelecionados, racasSelecionadas, ordenacao]);

  const pesagensAgrupadas = useMemo(() => {
    if (agrupamentosAtivos.length === 0) {
      return { "Todos os Registros": pesagensFiltradas };
    }

    const grupos = {};
    pesagensFiltradas.forEach(p => {
      let chaveArray = [];
      agrupamentosAtivos.forEach(tipo => {
        let valor;
        switch (tipo) {
          case "lote": valor = p.nome_lote || "Sem lote"; break;
          case "apartacao": valor = p.nome_apartacao || "Sem apartação"; break;
          case "sexo": valor = p.sexo === 'M' ? 'Macho' : p.sexo === 'F' ? 'Fêmea' : 'Sem sexo'; break;
          case "raca": valor = p.raca || "Sem raça"; break;
          default: valor = "Sem classificação";
        }
        chaveArray.push(valor);
      });
      const chave = chaveArray.join(" → ");
      if (!grupos[chave]) grupos[chave] = [];
      grupos[chave].push(p);
    });

    return grupos;
  }, [pesagensFiltradas, agrupamentosAtivos]);

  const toggleColuna = (colunaId) => {
    setColunasVisiveis(prev => {
      const novas = prev.includes(colunaId) ? prev.filter(id => id !== colunaId) : [...prev, colunaId];
      localStorage.setItem('colunas_relatorio_pesagens_ind', JSON.stringify(novas));
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
    setLotesSelecionados([]);
    setApartacoesSelecionadas([]);
    setSexosSelecionados([]);
    setRacasSelecionadas([]);
    setAgrupamentosAtivos([]);
    setOrdenacao('data_desc');
    setTipoRelatorio('analitico');
  };

  // Estatísticas gerais
  const totalAnimais = pesagensFiltradas.length;
  const pesoMedio = totalAnimais > 0 ? pesagensFiltradas.reduce((s, p) => s + (p.peso || 0), 0) / totalAnimais : 0;
  const gmdMedio = pesagensFiltradas.filter(p => p.gmd).length > 0 
    ? pesagensFiltradas.filter(p => p.gmd).reduce((s, p) => s + p.gmd, 0) / pesagensFiltradas.filter(p => p.gmd).length 
    : 0;
  const ganhoTotal = pesagensFiltradas.reduce((s, p) => s + (p.ganho || 0), 0);

  return (
    <div className="p-4 md:p-6 space-y-2">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 print:hidden">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Relatório de Pesagens Individuais</h1>
          <p className="text-xs text-slate-600">Análise e impressão</p>
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
                  <SelectItem value="sintetico">Sintético (Matriz)</SelectItem>
                  <SelectItem value="apartacao">Por Apartação/Lote</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {tipoRelatorio === 'sintetico' && (
              <>
                <div className="space-y-1">
                  <Label className="text-xs">Linhas (Eixo Y)</Label>
                  <Select value={eixoYSintetico} onValueChange={setEixoYSintetico}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {EIXO_Y_OPCOES.map(opt => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Colunas (Eixo X)</Label>
                  <Select value={eixoXSintetico} onValueChange={setEixoXSintetico}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {EIXO_X_OPCOES.map(opt => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
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

          {tipoRelatorio === 'analitico' && (
            <div className="space-y-1">
              <Label className="text-xs">Agrupar Por</Label>
              <div className="flex flex-wrap gap-1">
                {['lote', 'apartacao', 'sexo', 'raca'].map((tipo) => (
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
          )}

          <div className="flex gap-2 flex-wrap">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 text-xs">Lotes {lotesSelecionados.length > 0 && `(${lotesSelecionados.length})`}</Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 max-h-96 overflow-auto">
                <div className="space-y-2">
                  <h4 className="font-semibold text-sm mb-2">Lotes</h4>
                  {lotesUnicos.map(l => (
                    <div key={l} className="flex items-center space-x-2">
                      <Checkbox checked={lotesSelecionados.includes(l)} onCheckedChange={() => toggleFiltro(lotesSelecionados, setLotesSelecionados, l)} />
                      <label className="text-sm cursor-pointer">{l}</label>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 text-xs">Apartações {apartacoesSelecionadas.length > 0 && `(${apartacoesSelecionadas.length})`}</Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 max-h-96 overflow-auto">
                <div className="space-y-2">
                  <h4 className="font-semibold text-sm mb-2">Apartações</h4>
                  {apartacoesUnicas.map(a => (
                    <div key={a} className="flex items-center space-x-2">
                      <Checkbox checked={apartacoesSelecionadas.includes(a)} onCheckedChange={() => toggleFiltro(apartacoesSelecionadas, setApartacoesSelecionadas, a)} />
                      <label className="text-sm cursor-pointer">{a}</label>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 text-xs">Sexo {sexosSelecionados.length > 0 && `(${sexosSelecionados.length})`}</Button>
              </PopoverTrigger>
              <PopoverContent className="w-48">
                <div className="space-y-2">
                  <h4 className="font-semibold text-sm mb-2">Sexo</h4>
                  {sexosUnicos.map(s => (
                    <div key={s} className="flex items-center space-x-2">
                      <Checkbox checked={sexosSelecionados.includes(s)} onCheckedChange={() => toggleFiltro(sexosSelecionados, setSexosSelecionados, s)} />
                      <label className="text-sm cursor-pointer">{s === 'M' ? 'Macho' : s === 'F' ? 'Fêmea' : s}</label>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 text-xs">Raças {racasSelecionadas.length > 0 && `(${racasSelecionadas.length})`}</Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 max-h-96 overflow-auto">
                <div className="space-y-2">
                  <h4 className="font-semibold text-sm mb-2">Raças</h4>
                  {racasUnicas.map(r => (
                    <div key={r} className="flex items-center space-x-2">
                      <Checkbox checked={racasSelecionadas.includes(r)} onCheckedChange={() => toggleFiltro(racasSelecionadas, setRacasSelecionadas, r)} />
                      <label className="text-sm cursor-pointer">{r}</label>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            {tipoRelatorio === 'analitico' && (
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
            )}

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
              <h2 className="text-base font-bold">Relatório de Pesagens Individuais {tipoRelatorio === 'analitico' ? '(Analítico)' : tipoRelatorio === 'apartacao' ? '(Por Apartação)' : '(Sintético)'}</h2>
              {(dataInicio || dataFim) && (
                <p className="text-xs text-gray-600">
                  Período: {dataInicio ? formatarData(dataInicio) : "Início"} a {dataFim ? formatarData(dataFim) : "Hoje"}
                </p>
              )}
            </div>
          </div>

          {pesagensFiltradas.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <p>Nenhuma pesagem encontrada com os filtros aplicados.</p>
            </div>
          ) : tipoRelatorio === 'apartacao' ? (
            /* RELATÓRIO POR APARTAÇÃO/LOTE */
            (() => {
              // Agrupar por apartação e lote
              const porApartacao = {};
              pesagensFiltradas.forEach(p => {
                const apt = p.nome_apartacao || 'Sem Apartação';
                const lote = p.nome_lote || 'Sem Lote';
                if (!porApartacao[apt]) porApartacao[apt] = {};
                if (!porApartacao[apt][lote]) porApartacao[apt][lote] = [];
                porApartacao[apt][lote].push(p);
              });

              // Função para buscar faixa exigida do lote cadastrado
              const getFaixaExigida = (nomeApartacao, nomeLote) => {
                const lote = lotesApartacao.find(l => l.nome_apartacao === nomeApartacao && l.nome_lote === nomeLote);
                if (lote) {
                  return `${formatarNumero(lote.peso_minimo)}-${formatarNumero(lote.peso_maximo)}`;
                }
                return '-';
              };

              return (
                <div className="space-y-4">
                  {Object.entries(porApartacao).sort((a, b) => a[0].localeCompare(b[0])).map(([apartacao, lotes]) => {
                    // Calcular totais da apartação
                    const todosAnimaisApt = Object.values(lotes).flat();
                    const totalApt = todosAnimaisApt.length;
                    const pesoMedioApt = totalApt > 0 ? todosAnimaisApt.reduce((s, p) => s + (p.peso || 0), 0) / totalApt : 0;
                    const gmdMedioApt = todosAnimaisApt.filter(p => p.gmd).length > 0 
                      ? todosAnimaisApt.filter(p => p.gmd).reduce((s, p) => s + p.gmd, 0) / todosAnimaisApt.filter(p => p.gmd).length 
                      : 0;

                    return (
                      <div key={apartacao} className="border-2 border-black overflow-hidden">
                        {/* Cabeçalho da Apartação */}
                        <div className="bg-gray-300 px-3 py-2 border-b border-black">
                          <h3 className="font-bold text-sm">APARTAÇÃO: {apartacao}</h3>
                          <p className="text-xs">
                            {formatarNumero(totalApt)} animais | Peso Médio: {pesoMedioApt.toLocaleString('pt-BR', {minimumFractionDigits: 1, maximumFractionDigits: 1})} kg | GMD Médio: {gmdMedioApt > 0 ? gmdMedioApt.toLocaleString('pt-BR', {minimumFractionDigits: 3, maximumFractionDigits: 3}) : '-'} kg/dia
                          </p>
                        </div>

                        {/* Tabela de Lotes */}
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-gray-200">
                              <TableHead className="text-xs font-bold py-2 border border-gray-400">Lote</TableHead>
                              <TableHead className="text-xs font-bold text-center py-2 border border-gray-400">Qtd</TableHead>
                              <TableHead className="text-xs font-bold text-center py-2 border border-gray-400">Faixa Exigida</TableHead>
                              <TableHead className="text-xs font-bold text-center py-2 border border-gray-400">Menor</TableHead>
                              <TableHead className="text-xs font-bold text-center py-2 border border-gray-400">Maior</TableHead>
                              <TableHead className="text-xs font-bold text-center py-2 border border-gray-400">Peso Médio</TableHead>
                              <TableHead className="text-xs font-bold text-center py-2 border border-gray-400">Peso Total</TableHead>
                              <TableHead className="text-xs font-bold text-center py-2 border border-gray-400">GMD Médio</TableHead>
                              <TableHead className="text-xs font-bold text-center py-2 border border-gray-400">Machos</TableHead>
                              <TableHead className="text-xs font-bold text-center py-2 border border-gray-400">Fêmeas</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {Object.entries(lotes).sort((a, b) => a[0].localeCompare(b[0])).map(([lote, animais]) => {
                              const qtd = animais.length;
                              const pesos = animais.map(a => a.peso || 0).filter(p => p > 0);
                              const menorPeso = pesos.length > 0 ? Math.min(...pesos) : 0;
                              const maiorPeso = pesos.length > 0 ? Math.max(...pesos) : 0;
                              const pesoMedioLote = qtd > 0 ? animais.reduce((s, a) => s + (a.peso || 0), 0) / qtd : 0;
                              const pesoTotalLote = animais.reduce((s, a) => s + (a.peso || 0), 0);
                              const gmdMedioLote = animais.filter(a => a.gmd).length > 0 
                                ? animais.filter(a => a.gmd).reduce((s, a) => s + a.gmd, 0) / animais.filter(a => a.gmd).length 
                                : 0;
                              const machos = animais.filter(a => a.sexo === 'M').length;
                              const femeas = animais.filter(a => a.sexo === 'F').length;

                              return (
                                <TableRow key={lote}>
                                  <TableCell className="text-xs font-semibold py-2 border border-gray-300">{lote}</TableCell>
                                  <TableCell className="text-xs text-center font-bold py-2 border border-gray-300">{formatarNumero(qtd)}</TableCell>
                                  <TableCell className="text-xs text-center py-2 font-mono border border-gray-300">{getFaixaExigida(apartacao, lote)} kg</TableCell>
                                  <TableCell className="text-xs text-center py-2 font-mono border border-gray-300">{formatarNumero(menorPeso)} kg</TableCell>
                                  <TableCell className="text-xs text-center py-2 font-mono border border-gray-300">{formatarNumero(maiorPeso)} kg</TableCell>
                                  <TableCell className="text-xs text-center py-2 font-mono font-semibold border border-gray-300">{pesoMedioLote.toLocaleString('pt-BR', {minimumFractionDigits: 1, maximumFractionDigits: 1})} kg</TableCell>
                                  <TableCell className="text-xs text-center py-2 font-mono border border-gray-300">{pesoTotalLote.toLocaleString('pt-BR', {minimumFractionDigits: 1, maximumFractionDigits: 1})} kg</TableCell>
                                  <TableCell className="text-xs text-center py-2 font-mono border border-gray-300">
                                    {gmdMedioLote > 0 ? gmdMedioLote.toLocaleString('pt-BR', {minimumFractionDigits: 3, maximumFractionDigits: 3}) : '-'}
                                  </TableCell>
                                  <TableCell className="text-xs text-center py-2 border border-gray-300">{machos > 0 ? formatarNumero(machos) : '-'}</TableCell>
                                  <TableCell className="text-xs text-center py-2 border border-gray-300">{femeas > 0 ? formatarNumero(femeas) : '-'}</TableCell>
                                </TableRow>
                              );
                            })}
                            {/* Subtotal da Apartação */}
                            <TableRow className="bg-gray-100 font-bold">
                              <TableCell className="text-xs font-bold py-2 border border-gray-400">SUBTOTAL</TableCell>
                              <TableCell className="text-xs text-center font-bold py-2 border border-gray-400">{formatarNumero(totalApt)}</TableCell>
                              <TableCell className="text-xs text-center py-2 border border-gray-400">-</TableCell>
                              <TableCell className="text-xs text-center py-2 font-mono border border-gray-400">{formatarNumero(Math.min(...todosAnimaisApt.map(a => a.peso || 999999).filter(p => p > 0)))} kg</TableCell>
                              <TableCell className="text-xs text-center py-2 font-mono border border-gray-400">{formatarNumero(Math.max(...todosAnimaisApt.map(a => a.peso || 0)))} kg</TableCell>
                              <TableCell className="text-xs text-center py-2 font-mono font-bold border border-gray-400">{pesoMedioApt.toLocaleString('pt-BR', {minimumFractionDigits: 1, maximumFractionDigits: 1})} kg</TableCell>
                              <TableCell className="text-xs text-center py-2 font-mono border border-gray-400">{todosAnimaisApt.reduce((s, a) => s + (a.peso || 0), 0).toLocaleString('pt-BR', {minimumFractionDigits: 1, maximumFractionDigits: 1})} kg</TableCell>
                              <TableCell className="text-xs text-center py-2 font-mono font-bold border border-gray-400">{gmdMedioApt > 0 ? gmdMedioApt.toLocaleString('pt-BR', {minimumFractionDigits: 3, maximumFractionDigits: 3}) : '-'}</TableCell>
                              <TableCell className="text-xs text-center py-2 border border-gray-400">{formatarNumero(todosAnimaisApt.filter(a => a.sexo === 'M').length)}</TableCell>
                              <TableCell className="text-xs text-center py-2 border border-gray-400">{formatarNumero(todosAnimaisApt.filter(a => a.sexo === 'F').length)}</TableCell>
                            </TableRow>
                          </TableBody>
                        </Table>
                      </div>
                    );
                  })}

                  {/* Resumo Geral */}
                  <div className="mt-4 border-2 border-black">
                    <div className="bg-gray-300 px-3 py-2 border-b border-black">
                      <h4 className="font-bold text-sm">RESUMO GERAL</h4>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-gray-200">
                          <TableHead className="text-xs font-bold py-2 border border-gray-400">Apartação</TableHead>
                          <TableHead className="text-xs font-bold text-center py-2 border border-gray-400">Lotes</TableHead>
                          <TableHead className="text-xs font-bold text-center py-2 border border-gray-400">Animais</TableHead>
                          <TableHead className="text-xs font-bold text-center py-2 border border-gray-400">Menor Peso</TableHead>
                          <TableHead className="text-xs font-bold text-center py-2 border border-gray-400">Maior Peso</TableHead>
                          <TableHead className="text-xs font-bold text-center py-2 border border-gray-400">Peso Médio</TableHead>
                          <TableHead className="text-xs font-bold text-center py-2 border border-gray-400">Peso Total</TableHead>
                          <TableHead className="text-xs font-bold text-center py-2 border border-gray-400">GMD Médio</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {Object.entries(porApartacao).sort((a, b) => a[0].localeCompare(b[0])).map(([apartacao, lotes]) => {
                          const todosAnimais = Object.values(lotes).flat();
                          const qtd = todosAnimais.length;
                          const pesos = todosAnimais.map(a => a.peso || 0).filter(p => p > 0);
                          const menorPeso = pesos.length > 0 ? Math.min(...pesos) : 0;
                          const maiorPeso = pesos.length > 0 ? Math.max(...pesos) : 0;
                          const pesoMedioApt = qtd > 0 ? todosAnimais.reduce((s, a) => s + (a.peso || 0), 0) / qtd : 0;
                          const pesoTotalApt = todosAnimais.reduce((s, a) => s + (a.peso || 0), 0);
                          const gmdMedioApt = todosAnimais.filter(a => a.gmd).length > 0 
                            ? todosAnimais.filter(a => a.gmd).reduce((s, a) => s + a.gmd, 0) / todosAnimais.filter(a => a.gmd).length 
                            : 0;

                          return (
                            <TableRow key={apartacao}>
                              <TableCell className="text-xs font-semibold py-2 border border-gray-300">{apartacao}</TableCell>
                              <TableCell className="text-xs text-center py-2 border border-gray-300">{formatarNumero(Object.keys(lotes).length)}</TableCell>
                              <TableCell className="text-xs text-center font-bold py-2 border border-gray-300">{formatarNumero(qtd)}</TableCell>
                              <TableCell className="text-xs text-center py-2 font-mono border border-gray-300">{formatarNumero(menorPeso)} kg</TableCell>
                              <TableCell className="text-xs text-center py-2 font-mono border border-gray-300">{formatarNumero(maiorPeso)} kg</TableCell>
                              <TableCell className="text-xs text-center py-2 font-mono font-semibold border border-gray-300">{pesoMedioApt.toLocaleString('pt-BR', {minimumFractionDigits: 1, maximumFractionDigits: 1})} kg</TableCell>
                              <TableCell className="text-xs text-center py-2 font-mono border border-gray-300">{pesoTotalApt.toLocaleString('pt-BR', {minimumFractionDigits: 1, maximumFractionDigits: 1})} kg</TableCell>
                              <TableCell className="text-xs text-center py-2 font-mono border border-gray-300">
                                {gmdMedioApt > 0 ? gmdMedioApt.toLocaleString('pt-BR', {minimumFractionDigits: 3, maximumFractionDigits: 3}) : '-'}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                        {/* Linha Total */}
                        <TableRow className="bg-gray-300 font-bold">
                          <TableCell className="text-xs font-bold py-2 border border-gray-400">TOTAL GERAL</TableCell>
                          <TableCell className="text-xs text-center font-bold py-2 border border-gray-400">{formatarNumero(Object.values(porApartacao).reduce((s, lotes) => s + Object.keys(lotes).length, 0))}</TableCell>
                          <TableCell className="text-xs text-center font-bold py-2 border border-gray-400">{formatarNumero(totalAnimais)}</TableCell>
                          <TableCell className="text-xs text-center py-2 font-mono border border-gray-400">{formatarNumero(pesagensFiltradas.length > 0 ? Math.min(...pesagensFiltradas.map(p => p.peso || 999999).filter(p => p > 0)) : 0)} kg</TableCell>
                          <TableCell className="text-xs text-center py-2 font-mono border border-gray-400">{formatarNumero(pesagensFiltradas.length > 0 ? Math.max(...pesagensFiltradas.map(p => p.peso || 0)) : 0)} kg</TableCell>
                          <TableCell className="text-xs text-center py-2 font-mono font-bold border border-gray-400">{pesoMedio.toLocaleString('pt-BR', {minimumFractionDigits: 1, maximumFractionDigits: 1})} kg</TableCell>
                          <TableCell className="text-xs text-center py-2 font-mono border border-gray-400">{pesagensFiltradas.reduce((s, p) => s + (p.peso || 0), 0).toLocaleString('pt-BR', {minimumFractionDigits: 1, maximumFractionDigits: 1})} kg</TableCell>
                          <TableCell className="text-xs text-center py-2 font-mono font-bold border border-gray-400">{gmdMedio.toLocaleString('pt-BR', {minimumFractionDigits: 3, maximumFractionDigits: 3})}</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>

                  <div className="mt-4 pt-2 border-t border-gray-300 text-center text-xs text-gray-500">
                    <p>Impresso em: {format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</p>
                  </div>
                </div>
              );
            })()
          ) : tipoRelatorio === 'sintetico' ? (
            /* RELATÓRIO SINTÉTICO - MATRIZ */
            (() => {
              const getValorEixo = (p, eixo) => {
                switch (eixo) {
                  case 'nome_lote': return p.nome_lote || 'Sem Lote';
                  case 'nome_apartacao': return p.nome_apartacao || 'Sem Apartação';
                  case 'sexo': return p.sexo === 'M' ? 'Macho' : p.sexo === 'F' ? 'Fêmea' : 'Sem Sexo';
                  case 'raca': return p.raca || 'Sem Raça';
                  case 'mes': 
                    if (!p.data_pesagem) return 'Sem Data';
                    return format(new Date(p.data_pesagem), 'MMM/yyyy', { locale: ptBR });
                  default: return 'N/A';
                }
              };

              const linhasY = [...new Set(pesagensFiltradas.map(p => getValorEixo(p, eixoYSintetico)))].sort();
              const colunasX = [...new Set(pesagensFiltradas.map(p => getValorEixo(p, eixoXSintetico)))].sort();

              const matriz = {};
              const totaisLinha = {};
              const totaisColuna = {};

              linhasY.forEach(linha => {
                matriz[linha] = {};
                totaisLinha[linha] = { qtd: 0, pesoTotal: 0, gmdTotal: 0, gmdCount: 0 };
                colunasX.forEach(col => {
                  matriz[linha][col] = { qtd: 0, pesoTotal: 0, gmdTotal: 0, gmdCount: 0 };
                });
              });
              colunasX.forEach(col => {
                totaisColuna[col] = { qtd: 0, pesoTotal: 0, gmdTotal: 0, gmdCount: 0 };
              });

              pesagensFiltradas.forEach(p => {
                const linha = getValorEixo(p, eixoYSintetico);
                const col = getValorEixo(p, eixoXSintetico);

                matriz[linha][col].qtd++;
                matriz[linha][col].pesoTotal += (p.peso || 0);
                if (p.gmd) {
                  matriz[linha][col].gmdTotal += p.gmd;
                  matriz[linha][col].gmdCount++;
                }

                totaisLinha[linha].qtd++;
                totaisLinha[linha].pesoTotal += (p.peso || 0);
                if (p.gmd) {
                  totaisLinha[linha].gmdTotal += p.gmd;
                  totaisLinha[linha].gmdCount++;
                }

                totaisColuna[col].qtd++;
                totaisColuna[col].pesoTotal += (p.peso || 0);
                if (p.gmd) {
                  totaisColuna[col].gmdTotal += p.gmd;
                  totaisColuna[col].gmdCount++;
                }
              });

              const totalGeral = {
                qtd: pesagensFiltradas.length,
                pesoMedio: pesoMedio,
                gmdMedio: gmdMedio,
              };

              const eixoYLabel = EIXO_Y_OPCOES.find(o => o.value === eixoYSintetico)?.label || 'Linha';
              const eixoXLabel = EIXO_X_OPCOES.find(o => o.value === eixoXSintetico)?.label || 'Coluna';

              return (
                <div className="overflow-x-auto">
                  <div className="text-xs mb-1">
                    <strong>Linhas:</strong> {eixoYLabel} | <strong>Colunas:</strong> {eixoXLabel} | <strong>Valores:</strong> Qtd / Peso Médio / GMD Médio
                  </div>
                  
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="border border-black text-xs font-bold py-1 min-w-[120px]">
                          {eixoYLabel}
                        </TableHead>
                        {colunasX.map(col => (
                          <TableHead key={col} className="border border-black text-xs font-bold text-center py-1 min-w-[100px] whitespace-nowrap">
                            {col}
                          </TableHead>
                        ))}
                        <TableHead className="border border-black text-xs font-bold text-center py-1 min-w-[100px] bg-emerald-50">
                          TOTAL
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {linhasY.map((linha) => (
                        <TableRow key={linha}>
                          <TableCell className="border border-gray-300 text-xs font-semibold py-1">
                            {linha}
                          </TableCell>
                          {colunasX.map(col => {
                            const celula = matriz[linha][col];
                            const pesoMed = celula.qtd > 0 ? celula.pesoTotal / celula.qtd : 0;
                            const gmdMed = celula.gmdCount > 0 ? celula.gmdTotal / celula.gmdCount : 0;
                            return (
                              <TableCell key={col} className="border border-gray-300 text-xs text-center py-1 font-mono">
                                {celula.qtd > 0 ? (
                                  <div className="leading-tight">
                                    <div className="font-semibold">{celula.qtd}</div>
                                    <div className="text-[10px] text-slate-500">{pesoMed.toFixed(0)}kg</div>
                                    <div className="text-[10px] text-emerald-600">{gmdMed.toFixed(3)}</div>
                                  </div>
                                ) : ''}
                              </TableCell>
                            );
                          })}
                          <TableCell className="border border-black text-xs text-center font-mono py-1 bg-emerald-50">
                            <div className="leading-tight">
                              <div className="font-bold">{totaisLinha[linha].qtd}</div>
                              <div className="text-[10px] text-slate-600">{(totaisLinha[linha].pesoTotal / totaisLinha[linha].qtd).toFixed(0)}kg</div>
                              <div className="text-[10px] text-emerald-700">{totaisLinha[linha].gmdCount > 0 ? (totaisLinha[linha].gmdTotal / totaisLinha[linha].gmdCount).toFixed(3) : '-'}</div>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                      {/* Linha de Total */}
                      <TableRow className="font-bold">
                        <TableCell className="border border-black text-xs font-bold py-1 bg-emerald-50">
                          TOTAL
                        </TableCell>
                        {colunasX.map(col => {
                          const tc = totaisColuna[col];
                          const pesoMed = tc.qtd > 0 ? tc.pesoTotal / tc.qtd : 0;
                          const gmdMed = tc.gmdCount > 0 ? tc.gmdTotal / tc.gmdCount : 0;
                          return (
                            <TableCell key={col} className="border border-black text-xs text-center font-mono py-1 bg-emerald-50">
                              <div className="leading-tight">
                                <div className="font-bold">{tc.qtd}</div>
                                <div className="text-[10px] text-slate-600">{pesoMed.toFixed(0)}kg</div>
                                <div className="text-[10px] text-emerald-700">{gmdMed.toFixed(3)}</div>
                              </div>
                            </TableCell>
                          );
                        })}
                        <TableCell className="border border-black text-xs text-center font-mono font-bold py-1 bg-emerald-100">
                          <div className="leading-tight">
                            <div className="font-bold text-emerald-900">{totalGeral.qtd}</div>
                            <div className="text-[10px] text-slate-700">{totalGeral.pesoMedio.toFixed(0)}kg</div>
                            <div className="text-[10px] text-emerald-800">{totalGeral.gmdMedio.toFixed(3)}</div>
                          </div>
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              );
            })()
          ) : (
            /* RELATÓRIO ANALÍTICO */
            <>
              {Object.entries(pesagensAgrupadas).map(([grupo, registros], idx) => {
                const totalGrupo = registros.length;
                const pesoMedioGrupo = totalGrupo > 0 ? registros.reduce((s, r) => s + (r.peso || 0), 0) / totalGrupo : 0;
                const gmdMedioGrupo = registros.filter(r => r.gmd).length > 0 
                  ? registros.filter(r => r.gmd).reduce((s, r) => s + r.gmd, 0) / registros.filter(r => r.gmd).length 
                  : 0;

                return (
                  <div key={idx} className="mb-4">
                    {agrupamentosAtivos.length > 0 && (
                      <div className="bg-gray-200 px-2 py-1 mb-1">
                        <h3 className="font-bold text-xs">{grupo}</h3>
                      </div>
                    )}

                    <Table>
                      <TableHeader>
                        <TableRow className="border-black">
                          {colunasVisiveis.includes('data_pesagem') && <TableHead className="border border-black text-xs font-bold py-1">Data</TableHead>}
                          {colunasVisiveis.includes('numero_animal') && <TableHead className="border border-black text-xs font-bold py-1">Animal</TableHead>}
                          {colunasVisiveis.includes('sexo') && <TableHead className="border border-black text-xs font-bold py-1">Sexo</TableHead>}
                          {colunasVisiveis.includes('raca') && <TableHead className="border border-black text-xs font-bold py-1">Raça</TableHead>}
                          {colunasVisiveis.includes('peso') && <TableHead className="border border-black text-xs font-bold text-right py-1">Peso</TableHead>}
                          {colunasVisiveis.includes('nome_lote') && <TableHead className="border border-black text-xs font-bold py-1">Lote</TableHead>}
                          {colunasVisiveis.includes('nome_apartacao') && <TableHead className="border border-black text-xs font-bold py-1">Apartação</TableHead>}
                          {colunasVisiveis.includes('data_anterior') && <TableHead className="border border-black text-xs font-bold py-1">Dt.Ant.</TableHead>}
                          {colunasVisiveis.includes('peso_anterior') && <TableHead className="border border-black text-xs font-bold text-right py-1">Peso Ant.</TableHead>}
                          {colunasVisiveis.includes('dias') && <TableHead className="border border-black text-xs font-bold text-right py-1">Dias</TableHead>}
                          {colunasVisiveis.includes('ganho') && <TableHead className="border border-black text-xs font-bold text-right py-1">Ganho</TableHead>}
                          {colunasVisiveis.includes('gmd') && <TableHead className="border border-black text-xs font-bold text-right py-1">GMD</TableHead>}
                          {colunasVisiveis.includes('observacao') && <TableHead className="border border-black text-xs font-bold py-1">Obs</TableHead>}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {registros.map((p) => (
                          <TableRow key={p.id}>
                            {colunasVisiveis.includes('data_pesagem') && <TableCell className="border border-gray-300 text-xs py-1">{formatarData(p.data_pesagem)}</TableCell>}
                            {colunasVisiveis.includes('numero_animal') && <TableCell className="border border-gray-300 text-xs font-medium py-1">{p.numero_animal}</TableCell>}
                            {colunasVisiveis.includes('sexo') && <TableCell className="border border-gray-300 text-xs py-1">{p.sexo === 'M' ? 'M' : p.sexo === 'F' ? 'F' : '-'}</TableCell>}
                            {colunasVisiveis.includes('raca') && <TableCell className="border border-gray-300 text-xs py-1">{p.raca || '-'}</TableCell>}
                            {colunasVisiveis.includes('peso') && <TableCell className="border border-gray-300 text-xs text-right font-mono py-1">{p.peso?.toLocaleString('pt-BR')}</TableCell>}
                            {colunasVisiveis.includes('nome_lote') && <TableCell className="border border-gray-300 text-xs py-1">{p.nome_lote || '-'}</TableCell>}
                            {colunasVisiveis.includes('nome_apartacao') && <TableCell className="border border-gray-300 text-xs py-1">{p.nome_apartacao || '-'}</TableCell>}
                            {colunasVisiveis.includes('data_anterior') && <TableCell className="border border-gray-300 text-xs py-1">{formatarData(p.data_anterior)}</TableCell>}
                            {colunasVisiveis.includes('peso_anterior') && <TableCell className="border border-gray-300 text-xs text-right font-mono py-1">{p.peso_anterior?.toLocaleString('pt-BR') || '-'}</TableCell>}
                            {colunasVisiveis.includes('dias') && <TableCell className="border border-gray-300 text-xs text-right font-mono py-1">{p.dias || '-'}</TableCell>}
                            {colunasVisiveis.includes('ganho') && <TableCell className="border border-gray-300 text-xs text-right font-mono py-1">{p.ganho?.toLocaleString('pt-BR') || '-'}</TableCell>}
                            {colunasVisiveis.includes('gmd') && <TableCell className={`border border-gray-300 text-xs text-right font-mono py-1 ${p.gmd && p.gmd > 0 ? 'text-emerald-600' : p.gmd && p.gmd < 0 ? 'text-red-600' : ''}`}>{p.gmd?.toFixed(3) || '-'}</TableCell>}
                            {colunasVisiveis.includes('observacao') && <TableCell className="border border-gray-300 text-xs py-1 max-w-[80px] truncate">{p.observacao || '-'}</TableCell>}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>

                    <Table className="mt-1">
                      <TableBody>
                        <TableRow className="bg-gray-100 font-bold">
                          <TableCell colSpan={20} className="border border-black text-xs py-1">
                            Subtotal: {totalGrupo} animais | Peso Médio: {pesoMedioGrupo.toFixed(1)} kg | GMD Médio: {gmdMedioGrupo.toFixed(3)} kg/dia
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                );
              })}

              {/* Total Geral */}
              <div className="mt-4 border-t-2 border-black pt-2">
                <div className="text-xs font-bold">
                  TOTAL GERAL: {totalAnimais} pesagens | Peso Médio: {pesoMedio.toFixed(1)} kg | GMD Médio: {gmdMedio.toFixed(3)} kg/dia | Ganho Total: {formatarNumero(ganhoTotal.toFixed(1))} kg
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