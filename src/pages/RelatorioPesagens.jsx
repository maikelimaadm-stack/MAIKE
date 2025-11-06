import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Printer, Settings, FileText } from "lucide-react";
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
  if (!numero && numero !== 0) return "0,00";
  return numero.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};

const COLUNAS_DISPONIVEIS = [
  { id: 'data', label: 'Data', default: true },
  { id: 'tipo', label: 'Tipo', default: true },
  { id: 'placa', label: 'Placa', default: true },
  { id: 'motorista', label: 'Motorista', default: true },
  { id: 'produto', label: 'Produto', default: true },
  { id: 'fornecedor', label: 'Fornecedor/Destino', default: true },
  { id: 'tara', label: 'Tara (kg)', default: true },
  { id: 'bruto', label: 'Bruto (kg)', default: true },
  { id: 'liquido', label: 'Líquido (kg)', default: true },
  { id: 'observacoes', label: 'Observações', default: false },
];

export default function RelatorioPesagens() {
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [orientacao, setOrientacao] = useState("retrato");
  const [agruparPor, setAgruparPor] = useState("nenhum");
  const [colunasVisiveis, setColunasVisiveis] = useState(
    COLUNAS_DISPONIVEIS.filter(c => c.default).map(c => c.id)
  );

  const [produtosSelecionados, setProdutosSelecionados] = useState([]);
  const [placasSelecionadas, setPlacasSelecionadas] = useState([]);
  const [tiposSelecionados, setTiposSelecionados] = useState([]);
  const [motoristasSelecionados, setMotoristasSelecionados] = useState([]);
  const [fornecedoresSelecionados, setFornecedoresSelecionados] = useState([]);
  const [buscaObservacoes, setBuscaObservacoes] = useState("");

  const { data: pesagens, isLoading } = useQuery({
    queryKey: ['pesagens'],
    queryFn: () => base44.entities.Pesagem.list('-data_pesagem'),
    initialData: [],
  });

  const produtosUnicos = [...new Set(pesagens.map(p => p.produto))].filter(Boolean);
  const placasUnicas = [...new Set(pesagens.map(p => p.placa_caminhao))].filter(Boolean);
  const tiposUnicos = ['Entrada', 'Saída', 'Ambos'];
  const motoristasUnicos = [...new Set(pesagens.map(p => p.nome_motorista))].filter(Boolean);
  const fornecedoresUnicos = [...new Set(pesagens.map(p => p.fornecedor_destino))].filter(Boolean);

  const pesagensFiltradas = useMemo(() => {
    return pesagens.filter(p => {
      if (dataInicio && new Date(p.data_pesagem) < new Date(dataInicio)) return false;
      if (dataFim && new Date(p.data_pesagem) > new Date(dataFim)) return false;
      if (produtosSelecionados.length > 0 && !produtosSelecionados.includes(p.produto)) return false;
      if (placasSelecionadas.length > 0 && !placasSelecionadas.includes(p.placa_caminhao)) return false;
      if (tiposSelecionados.length > 0 && !tiposSelecionados.includes(p.tipo_pesagem)) return false;
      if (motoristasSelecionados.length > 0 && !motoristasSelecionados.includes(p.nome_motorista)) return false;
      if (fornecedoresSelecionados.length > 0 && !fornecedoresSelecionados.includes(p.fornecedor_destino)) return false;
      if (buscaObservacoes && !p.observacoes?.toLowerCase().includes(buscaObservacoes.toLowerCase())) return false;
      return true;
    });
  }, [pesagens, dataInicio, dataFim, produtosSelecionados, placasSelecionadas, tiposSelecionados, motoristasSelecionados, fornecedoresSelecionados, buscaObservacoes]);

  const pesagensAgrupadas = useMemo(() => {
    if (agruparPor === "nenhum") {
      return { "Todos os Registros": pesagensFiltradas };
    }

    const grupos = {};
    pesagensFiltradas.forEach(p => {
      let chave;
      switch (agruparPor) {
        case "placa":
          chave = p.placa_caminhao || "Sem placa";
          break;
        case "tipo":
          chave = p.tipo_pesagem || "Sem tipo";
          break;
        case "data":
          chave = format(new Date(p.data_pesagem), "dd/MM/yyyy", { locale: ptBR });
          break;
        case "motorista":
          chave = p.nome_motorista || "Sem motorista";
          break;
        case "produto":
          chave = p.produto || "Sem produto";
          break;
        case "fornecedor":
          chave = p.fornecedor_destino || "Sem fornecedor/destino";
          break;
        default:
          chave = "Todos";
      }
      
      if (!grupos[chave]) {
        grupos[chave] = [];
      }
      grupos[chave].push(p);
    });

    return grupos;
  }, [pesagensFiltradas, agruparPor]);

  const toggleColuna = (colunaId) => {
    setColunasVisiveis(prev => 
      prev.includes(colunaId) ? prev.filter(id => id !== colunaId) : [...prev, colunaId]
    );
  };

  const toggleFiltro = (lista, setLista, valor) => {
    setLista(prev =>
      prev.includes(valor) ? prev.filter(v => v !== valor) : [...prev, valor]
    );
  };

  const limparFiltros = () => {
    setDataInicio("");
    setDataFim("");
    setProdutosSelecionados([]);
    setPlacasSelecionadas([]);
    setTiposSelecionados([]);
    setMotoristasSelecionados([]);
    setFornecedoresSelecionados([]);
    setBuscaObservacoes("");
    setAgruparPor("nenhum");
  };

  const imprimir = () => {
    window.print();
  };

  const totalPesoLiquido = pesagensFiltradas.reduce((sum, p) => sum + (p.peso_liquido || 0), 0);

  return (
    <div className="p-6 space-y-6">
      {/* Controles */}
      <div className="print:hidden flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-gradient-to-br from-green-600 to-green-700 rounded-xl flex items-center justify-center shadow-lg">
            <FileText className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-green-900">Relatório de Pesagens</h1>
            <p className="text-green-700">Configure e imprima o relatório</p>
          </div>
        </div>
        <Button onClick={imprimir} className="bg-green-600 hover:bg-green-700 gap-2">
          <Printer className="w-4 h-4" />
          Imprimir
        </Button>
      </div>

      {/* Filtros e Configurações */}
      <Card className="shadow-lg border-green-200 print:hidden">
        <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50 border-b">
          <CardTitle className="text-green-900">Filtros e Configurações</CardTitle>
        </CardHeader>
        <CardContent className="p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label>Data Início</Label>
              <Input
                type="date"
                value={dataInicio}
                onChange={(e) => setDataInicio(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Data Fim</Label>
              <Input
                type="date"
                value={dataFim}
                onChange={(e) => setDataFim(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Orientação</Label>
              <select
                value={orientacao}
                onChange={(e) => setOrientacao(e.target.value)}
                className="w-full h-10 px-3 border rounded-md"
              >
                <option value="retrato">Retrato</option>
                <option value="paisagem">Paisagem</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>Agrupar Por</Label>
              <Select value={agruparPor} onValueChange={setAgruparPor}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="nenhum">Sem agrupamento</SelectItem>
                  <SelectItem value="data">Data</SelectItem>
                  <SelectItem value="placa">Placa</SelectItem>
                  <SelectItem value="tipo">Tipo</SelectItem>
                  <SelectItem value="motorista">Motorista</SelectItem>
                  <SelectItem value="produto">Produto</SelectItem>
                  <SelectItem value="fornecedor">Fornecedor/Destino</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Buscar em Observações</Label>
            <Input
              placeholder="Digite para buscar nas observações..."
              value={buscaObservacoes}
              onChange={(e) => setBuscaObservacoes(e.target.value)}
            />
          </div>

          <div className="flex gap-3 flex-wrap">
            {/* Filtros existentes - mantidos */}
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="gap-2">
                  Tipos {tiposSelecionados.length > 0 && `(${tiposSelecionados.length})`}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64">
                <div className="space-y-2">
                  <h4 className="font-semibold text-sm mb-3">Selecione Tipos</h4>
                  {tiposUnicos.map(tipo => (
                    <div key={tipo} className="flex items-center space-x-2">
                      <Checkbox
                        checked={tiposSelecionados.includes(tipo)}
                        onCheckedChange={() => toggleFiltro(tiposSelecionados, setTiposSelecionados, tipo)}
                      />
                      <label className="text-sm cursor-pointer">{tipo}</label>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="gap-2">
                  Placas {placasSelecionadas.length > 0 && `(${placasSelecionadas.length})`}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 max-h-96 overflow-auto">
                <div className="space-y-2">
                  <h4 className="font-semibold text-sm mb-3">Selecione Placas</h4>
                  {placasUnicas.map(placa => (
                    <div key={placa} className="flex items-center space-x-2">
                      <Checkbox
                        checked={placasSelecionadas.includes(placa)}
                        onCheckedChange={() => toggleFiltro(placasSelecionadas, setPlacasSelecionadas, placa)}
                      />
                      <label className="text-sm cursor-pointer uppercase">{placa}</label>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="gap-2">
                  Motoristas {motoristasSelecionados.length > 0 && `(${motoristasSelecionados.length})`}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 max-h-96 overflow-auto">
                <div className="space-y-2">
                  <h4 className="font-semibold text-sm mb-3">Selecione Motoristas</h4>
                  {motoristasUnicos.map(motorista => (
                    <div key={motorista} className="flex items-center space-x-2">
                      <Checkbox
                        checked={motoristasSelecionados.includes(motorista)}
                        onCheckedChange={() => toggleFiltro(motoristasSelecionados, setMotoristasSelecionados, motorista)}
                      />
                      <label className="text-sm cursor-pointer">{motorista}</label>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="gap-2">
                  Produtos {produtosSelecionados.length > 0 && `(${produtosSelecionados.length})`}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 max-h-96 overflow-auto">
                <div className="space-y-2">
                  <h4 className="font-semibold text-sm mb-3">Selecione Produtos</h4>
                  {produtosUnicos.map(produto => (
                    <div key={produto} className="flex items-center space-x-2">
                      <Checkbox
                        checked={produtosSelecionados.includes(produto)}
                        onCheckedChange={() => toggleFiltro(produtosSelecionados, setProdutosSelecionados, produto)}
                      />
                      <label className="text-sm cursor-pointer">{produto}</label>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="gap-2">
                  Fornec./Dest. {fornecedoresSelecionados.length > 0 && `(${fornecedoresSelecionados.length})`}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 max-h-96 overflow-auto">
                <div className="space-y-2">
                  <h4 className="font-semibold text-sm mb-3">Selecione Fornecedores/Destinos</h4>
                  {fornecedoresUnicos.map(fornecedor => (
                    <div key={fornecedor} className="flex items-center space-x-2">
                      <Checkbox
                        checked={fornecedoresSelecionados.includes(fornecedor)}
                        onCheckedChange={() => toggleFiltro(fornecedoresSelecionados, setFornecedoresSelecionados, fornecedor)}
                      />
                      <label className="text-sm cursor-pointer">{fornecedor}</label>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="gap-2">
                  <Settings className="w-4 h-4" />
                  Colunas
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
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

            <Button variant="outline" onClick={limparFiltros}>Limpar Filtros</Button>
          </div>
        </CardContent>
      </Card>

      {/* Área de Impressão */}
      <div className={`bg-white print:shadow-none ${orientacao === 'paisagem' ? 'print:landscape' : ''}`}>
        <style dangerouslySetInnerHTML={{__html: `
          @media print {
            @page {
              size: ${orientacao === 'paisagem' ? 'A4 landscape' : 'A4 portrait'};
              margin: 0.5cm;
            }
            body * {
              visibility: hidden;
            }
            .print-area, .print-area * {
              visibility: visible;
            }
            .print-area {
              position: absolute;
              left: 0;
              top: 0;
              width: 100%;
            }
            .page-footer {
              position: fixed;
              bottom: 0;
              left: 0;
              right: 0;
              height: 20px;
              font-size: 9px;
              display: flex;
              justify-content: space-between;
              padding: 0 0.5cm;
            }
          }
        `}} />
        
        <div className="print-area p-8 print:p-0">
          {/* Cabeçalho */}
          <div className="flex items-start justify-between border-b-2 border-black pb-4 mb-6">
            <img 
              src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/690cd380760c45b456c6ef81/7f0d28c9d_Imagem1.jpg" 
              alt="Fazenda Palmital"
              className="h-20"
            />
            <div className="text-right">
              <h1 className="text-2xl font-bold">Fazenda Palmital</h1>
              <p className="text-base">Antonio Lemos Beraldo</p>
              <p className="text-sm">Vila Bela da Ss. Trindade - MT</p>
            </div>
          </div>

          {/* Título */}
          <div className="mb-6">
            <h2 className="text-xl font-bold">Relatório de Pesagens</h2>
            {(dataInicio || dataFim) && (
              <p className="text-sm text-gray-600">
                Período: {dataInicio ? format(new Date(dataInicio), "dd/MM/yyyy", { locale: ptBR }) : "Início"} a {dataFim ? format(new Date(dataFim), "dd/MM/yyyy", { locale: ptBR }) : "Hoje"}
              </p>
            )}
            {agruparPor !== "nenhum" && (
              <p className="text-sm text-gray-600">
                Agrupado por: <strong>{agruparPor.charAt(0).toUpperCase() + agruparPor.slice(1)}</strong>
              </p>
            )}
          </div>

          {/* Tabelas Agrupadas */}
          {Object.entries(pesagensAgrupadas).map(([grupo, registros], idx) => {
            const totalGrupo = registros.reduce((sum, p) => sum + (p.peso_liquido || 0), 0);
            
            return (
              <div key={idx} className="mb-8">
                {agruparPor !== "nenhum" && (
                  <div className="bg-gray-200 px-3 py-2 mb-2">
                    <h3 className="font-bold text-sm">{grupo} ({registros.length} {registros.length === 1 ? 'registro' : 'registros'})</h3>
                  </div>
                )}
                
                <Table>
                  <TableHeader>
                    <TableRow className="border-black">
                      {colunasVisiveis.includes('data') && <TableHead className="border border-black text-xs font-bold">Data</TableHead>}
                      {colunasVisiveis.includes('tipo') && <TableHead className="border border-black text-xs font-bold">Tipo</TableHead>}
                      {colunasVisiveis.includes('placa') && <TableHead className="border border-black text-xs font-bold">Placa</TableHead>}
                      {colunasVisiveis.includes('motorista') && <TableHead className="border border-black text-xs font-bold">Motorista</TableHead>}
                      {colunasVisiveis.includes('produto') && <TableHead className="border border-black text-xs font-bold">Produto</TableHead>}
                      {colunasVisiveis.includes('fornecedor') && <TableHead className="border border-black text-xs font-bold">Forn./Dest.</TableHead>}
                      {colunasVisiveis.includes('tara') && <TableHead className="border border-black text-xs font-bold text-right">Tara</TableHead>}
                      {colunasVisiveis.includes('bruto') && <TableHead className="border border-black text-xs font-bold text-right">Bruto</TableHead>}
                      {colunasVisiveis.includes('liquido') && <TableHead className="border border-black text-xs font-bold text-right">Líquido</TableHead>}
                      {colunasVisiveis.includes('observacoes') && <TableHead className="border border-black text-xs font-bold">Observações</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {registros.map((p) => (
                      <TableRow key={p.id}>
                        {colunasVisiveis.includes('data') && <TableCell className="border border-gray-300 text-xs">{format(new Date(p.data_pesagem), "dd/MM/yyyy", { locale: ptBR })}</TableCell>}
                        {colunasVisiveis.includes('tipo') && <TableCell className="border border-gray-300 text-xs">{p.tipo_pesagem}</TableCell>}
                        {colunasVisiveis.includes('placa') && <TableCell className="border border-gray-300 text-xs uppercase">{p.placa_caminhao}</TableCell>}
                        {colunasVisiveis.includes('motorista') && <TableCell className="border border-gray-300 text-xs">{p.nome_motorista}</TableCell>}
                        {colunasVisiveis.includes('produto') && <TableCell className="border border-gray-300 text-xs">{p.produto}</TableCell>}
                        {colunasVisiveis.includes('fornecedor') && <TableCell className="border border-gray-300 text-xs">{p.fornecedor_destino || '-'}</TableCell>}
                        {colunasVisiveis.includes('tara') && <TableCell className="border border-gray-300 text-xs text-right">{formatarNumero(p.peso_tara)}</TableCell>}
                        {colunasVisiveis.includes('bruto') && <TableCell className="border border-gray-300 text-xs text-right">{formatarNumero(p.peso_bruto)}</TableCell>}
                        {colunasVisiveis.includes('liquido') && <TableCell className="border border-gray-300 text-xs text-right font-semibold">{formatarNumero(p.peso_liquido)}</TableCell>}
                        {colunasVisiveis.includes('observacoes') && <TableCell className="border border-gray-300 text-xs">{p.observacoes || '-'}</TableCell>}
                      </TableRow>
                    ))}
                    <TableRow className="bg-gray-100 font-bold">
                      <TableCell colSpan={colunasVisiveis.length - 1} className="border border-black text-xs">
                        SUBTOTAL ({registros.length} {registros.length === 1 ? 'registro' : 'registros'})
                      </TableCell>
                      <TableCell className="border border-black text-xs text-right">{formatarNumero(totalGrupo)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            );
          })}

          {/* Total Geral */}
          <div className="mt-6 border-t-2 border-black pt-4">
            <div className="flex justify-between items-center">
              <div className="text-sm font-bold">
                TOTAL GERAL: {pesagensFiltradas.length} {pesagensFiltradas.length === 1 ? 'pesagem' : 'pesagens'}
              </div>
              <div className="text-sm font-bold">
                Peso Líquido Total: {formatarNumero(totalPesoLiquido)} kg
              </div>
            </div>
          </div>

          {/* Rodapé customizado */}
          <div className="page-footer hidden print:flex">
            <span>Página 1 de 1</span>
            <span>Impresso em: {format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</span>
          </div>
        </div>
      </div>
    </div>
  );
}