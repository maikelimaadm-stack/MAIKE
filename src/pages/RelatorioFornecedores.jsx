import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileText, Printer, Settings, Users } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Building2, UserCheck, UserX } from "lucide-react";

const COLUNAS_DISPONIVEIS = [
  { id: 'numero', label: 'Nº Cadastro', default: true },
  { id: 'nome', label: 'Nome', default: true },
  { id: 'tipo', label: 'Tipo', default: true },
  { id: 'cpf_cnpj', label: 'CPF/CNPJ', default: true },
  { id: 'telefone', label: 'Telefone', default: true },
  { id: 'email', label: 'E-mail', default: true },
  { id: 'cidade', label: 'Cidade', default: true },
  { id: 'estado', label: 'Estado', default: true },
  { id: 'endereco', label: 'Endereço', default: false },
];

const ORDENACAO_OPCOES = [
  { value: 'nome_asc', label: 'Nome (A-Z)' },
  { value: 'nome_desc', label: 'Nome (Z-A)' },
  { value: 'tipo_asc', label: 'Tipo (A-Z)' },
  { value: 'tipo_desc', label: 'Tipo (Z-A)' },
  { value: 'cidade_asc', label: 'Cidade (A-Z)' },
  { value: 'cidade_desc', label: 'Cidade (Z-A)' },
  { value: 'estado_asc', label: 'Estado (A-Z)' },
  { value: 'estado_desc', label: 'Estado (Z-A)' },
];

export default function RelatorioFornecedores() {
  const [orientacao, setOrientacao] = useState("retrato");
  const [ordenacao, setOrdenacao] = useState('nome_asc');
  const [showConfig, setShowConfig] = useState(false);
  
  // Carregar configuração de colunas do localStorage
  const [colunasVisiveis, setColunasVisiveis] = useState(() => {
    const saved = localStorage.getItem('colunas_relatorio_fornecedores');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return COLUNAS_DISPONIVEIS.filter(c => c.default).map(c => c.id);
      }
    }
    return COLUNAS_DISPONIVEIS.filter(c => c.default).map(c => c.id);
  });

  const [tiposSelecionados, setTiposSelecionados] = useState([]);
  const [cidadesSelecionadas, setCidadesSelecionadas] = useState([]);
  const [estadosSelecionados, setEstadosSelecionados] = useState([]);
  
  // Filtros de busca por texto
  const [buscaTelefone, setBuscaTelefone] = useState("");
  const [buscaEmail, setBuscaEmail] = useState("");
  const [buscaNome, setBuscaNome] = useState("");

  // Pegar empresa selecionada
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  const { data: fornecedores, isLoading } = useQuery({
    queryKey: ['fornecedores', empresaSelecionadaId],
    queryFn: async () => {
      const allFornecedores = await base44.entities.Fornecedor.list('nome');
      return allFornecedores.filter(f => f.empresa_id === empresaSelecionadaId);
    },
    initialData: [],
    enabled: !!empresaSelecionadaId,
  });

  // Buscar dados da empresa selecionada
  const { data: empresaAtual } = useQuery({
    queryKey: ['empresa-atual-relatorio', empresaSelecionadaId],
    queryFn: async () => {
      if (!empresaSelecionadaId) return null;
      const empresas = await base44.entities.Empresa.list();
      return empresas.find(e => e.id === empresaSelecionadaId) || null;
    },
    enabled: !!empresaSelecionadaId,
  });

  const cidadesUnicas = [...new Set(fornecedores.map(f => f.cidade))].filter(Boolean).sort();
  const estadosUnicos = [...new Set(fornecedores.map(f => f.estado))].filter(Boolean).sort();
  const tiposUnicos = ['Física', 'Jurídica'];

  const fornecedoresFiltrados = useMemo(() => {
    let filtered = fornecedores.filter(f => {
      if (tiposSelecionados.length > 0 && !tiposSelecionados.includes(f.tipo_pessoa)) return false;
      if (cidadesSelecionadas.length > 0 && !cidadesSelecionadas.includes(f.cidade)) return false;
      if (estadosSelecionados.length > 0 && !estadosSelecionados.includes(f.estado)) return false;
      if (buscaTelefone && !f.telefone?.includes(buscaTelefone)) return false;
      if (buscaEmail && !f.email?.toLowerCase().includes(buscaEmail.toLowerCase())) return false;
      if (buscaNome && !f.nome?.toLowerCase().includes(buscaNome.toLowerCase())) return false;
      return true;
    });

    // Aplicar ordenação
    filtered.sort((a, b) => {
      switch (ordenacao) {
        case 'nome_asc':
          return (a.nome || '').localeCompare(b.nome || '');
        case 'nome_desc':
          return (b.nome || '').localeCompare(a.nome || '');
        case 'tipo_asc':
          return (a.tipo_pessoa || '').localeCompare(b.tipo_pessoa || '');
        case 'tipo_desc':
          return (b.tipo_pessoa || '').localeCompare(a.tipo_pessoa || '');
        case 'cidade_asc':
          return (a.cidade || '').localeCompare(b.cidade || '');
        case 'cidade_desc':
          return (b.cidade || '').localeCompare(a.cidade || '');
        case 'estado_asc':
          return (a.estado || '').localeCompare(b.estado || '');
        case 'estado_desc':
          return (b.estado || '').localeCompare(a.estado || '');
        default:
          return 0;
      }
    });

    return filtered;
  }, [fornecedores, tiposSelecionados, cidadesSelecionadas, estadosSelecionados, buscaTelefone, buscaEmail, buscaNome, ordenacao]);

  const toggleColuna = (colunaId) => {
    setColunasVisiveis(prev => {
      const novasColunas = prev.includes(colunaId) ? prev.filter(id => id !== colunaId) : [...prev, colunaId];
      
      // Salvar no localStorage
      localStorage.setItem('colunas_relatorio_fornecedores', JSON.stringify(novasColunas));
      
      return novasColunas;
    });
  };

  const toggleFiltro = (lista, setLista, valor) => {
    setLista(prev =>
      prev.includes(valor) ? prev.filter(v => v !== valor) : [...prev, valor]
    );
  };

  const limparFiltros = () => {
    setTiposSelecionados([]);
    setCidadesSelecionadas([]);
    setEstadosSelecionados([]);
    setBuscaTelefone("");
    setBuscaEmail("");
    setBuscaNome("");
    toast.info("Filtros limpos!", {
      description: "Todos os filtros de busca foram redefinidos.",
      duration: 3000,
    });
  };

  const selecionarTodosTipos = () => {
    setTiposSelecionados(tiposUnicos);
  };

  const desmarcarTodosTipos = () => {
    setTiposSelecionados([]);
  };

  const selecionarTodasCidades = () => {
    setCidadesSelecionadas(cidadesUnicas);
  };

  const desmarcarTodasCidades = () => {
    setCidadesSelecionadas([]);
  };

  const selecionarTodosEstados = () => {
    setEstadosSelecionados(estadosUnicos);
  };

  const desmarcarTodosEstados = () => {
    setEstadosSelecionados([]);
  };

  return (
    <div className="p-4 md:p-6 space-y-2">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 print:hidden">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Lista de Fornecedores</h1>
          <p className="text-xs text-slate-600">Relatório completo</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowConfig(true)} className="h-8 gap-1 text-xs">
            <Settings className="w-3.5 h-3.5" />
            Config
          </Button>
          <Button onClick={() => window.print()} size="sm" className="h-8 gap-1 text-xs bg-emerald-600 hover:bg-emerald-700">
            <Printer className="w-3.5 h-3.5" />
            Imprimir
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 mb-2 print:hidden">
        <Card className="shadow-sm border-l-4 border-l-blue-500">
          <CardContent className="p-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-medium text-slate-600 mb-0.5 truncate leading-tight">Total</p>
                <p className="text-lg font-bold text-blue-700 truncate leading-tight">{fornecedoresFiltrados.length}</p>
                <p className="text-[10px] text-slate-500 mt-0.5 truncate leading-tight">Fornecedores/Clientes</p>
              </div>
              <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                <Building2 className="w-3.5 h-3.5 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card className="shadow-sm border-l-4 border-l-emerald-500">
          <CardContent className="p-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-medium text-slate-600 mb-0.5 truncate leading-tight">Pessoa Física</p>
                <p className="text-lg font-bold text-emerald-700 truncate leading-tight">
                  {fornecedoresFiltrados.filter(f => f.tipo_pessoa === 'Física').length}
                </p>
                <p className="text-[10px] text-slate-500 mt-0.5 truncate leading-tight">CPF</p>
              </div>
              <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center flex-shrink-0">
                <UserCheck className="w-3.5 h-3.5 text-emerald-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm border-l-4 border-l-violet-500">
          <CardContent className="p-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-medium text-slate-600 mb-0.5 truncate leading-tight">Pessoa Jurídica</p>
                <p className="text-lg font-bold text-violet-700 truncate leading-tight">
                  {fornecedoresFiltrados.filter(f => f.tipo_pessoa === 'Jurídica').length}
                </p>
                <p className="text-[10px] text-slate-500 mt-0.5 truncate leading-tight">CNPJ</p>
              </div>
              <div className="w-8 h-8 rounded-lg bg-violet-50 flex items-center justify-center flex-shrink-0">
                <Users className="w-3.5 h-3.5 text-violet-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={showConfig} onOpenChange={setShowConfig}>
        <DialogContent className="sm:max-w-[800px] p-0">
          <DialogHeader className="p-6 pb-0">
            <DialogTitle className="text-lg font-semibold">Configurações do Relatório</DialogTitle>
          </DialogHeader>
          <div className="p-6 pt-4">
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                  <Label>Ordenar Por</Label>
                  <Select value={ordenacao} onValueChange={setOrdenacao}>
                    <SelectTrigger>
                      <SelectValue placeholder="Ordenar por..." />
                    </SelectTrigger>
                    <SelectContent>
                      {ORDENACAO_OPCOES.map(opt => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Buscas por texto */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Buscar por Nome</Label>
                  <Input
                    placeholder="Digite o nome..."
                    value={buscaNome}
                    onChange={(e) => setBuscaNome(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Buscar por Telefone</Label>
                  <Input
                    placeholder="Digite o telefone..."
                    value={buscaTelefone}
                    onChange={(e) => setBuscaTelefone(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Buscar por E-mail</Label>
                  <Input
                    placeholder="Digite o e-mail..."
                    value={buscaEmail}
                    onChange={(e) => setBuscaEmail(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex gap-3 flex-wrap">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="gap-2">
                      Tipo Pessoa {tiposSelecionados.length > 0 && `(${tiposSelecionados.length})`}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64">
                    <div className="space-y-2">
                      <div className="flex justify-between items-center mb-3">
                        <h4 className="font-semibold text-sm">Selecione Tipos</h4>
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={selecionarTodosTipos}>
                            Todos
                          </Button>
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={desmarcarTodosTipos}>
                            Nenhum
                          </Button>
                        </div>
                      </div>
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
                      Cidades {cidadesSelecionadas.length > 0 && `(${cidadesSelecionadas.length})`}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 max-h-96 overflow-auto">
                    <div className="space-y-2">
                      <div className="flex justify-between items-center mb-3 sticky top-0 bg-white pb-2">
                        <h4 className="font-semibold text-sm">Selecione Cidades</h4>
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={selecionarTodasCidades}>
                            Todos
                          </Button>
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={desmarcarTodasCidades}>
                            Nenhum
                          </Button>
                        </div>
                      </div>
                      {cidadesUnicas.map(cidade => (
                        <div key={cidade} className="flex items-center space-x-2">
                          <Checkbox
                            checked={cidadesSelecionadas.includes(cidade)}
                            onCheckedChange={() => toggleFiltro(cidadesSelecionadas, setCidadesSelecionadas, cidade)}
                          />
                          <label className="text-sm cursor-pointer">{cidade}</label>
                        </div>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>

                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="gap-2">
                      Estados {estadosSelecionados.length > 0 && `(${estadosSelecionados.length})`}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 max-h-96 overflow-auto">
                    <div className="space-y-2">
                      <div className="flex justify-between items-center mb-3 sticky top-0 bg-white pb-2">
                        <h4 className="font-semibold text-sm">Selecione Estados</h4>
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={selecionarTodosEstados}>
                            Todos
                          </Button>
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={desmarcarTodosEstados}>
                            Nenhum
                          </Button>
                        </div>
                      </div>
                      {estadosUnicos.map(estado => (
                        <div key={estado} className="flex items-center space-x-2">
                          <Checkbox
                            checked={estadosSelecionados.includes(estado)}
                            onCheckedChange={() => toggleFiltro(estadosSelecionados, setEstadosSelecionados, estado)}
                          />
                          <label className="text-sm cursor-pointer uppercase">{estado}</label>
                        </div>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="gap-2 border-slate-300">
                      <Settings className="w-4 h-4" />
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

                <Button variant="outline" onClick={limparFiltros}>Limpar Filtros</Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <div className={`bg-white print:shadow-none ${orientacao === 'paisagem' ? 'print:landscape' : ''}`}>
        <style dangerouslySetInnerHTML={{__html: `
          @media print {
            @page {
              size: ${orientacao === 'paisagem' ? 'A4 landscape' : 'A4 portrait'};
              margin: 1.5cm 1cm 2cm 1cm;
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
            header, nav, .no-print {
              display: none !important;
            }
            body::before, body::after {
              content: none !important;
            }
          }
        `}} />
        
        <div className="print-area p-8 print:p-0">
          {/* Cabeçalho */}
          <div className="border-b-2 border-black pb-1 mb-2">
            <div className="flex items-center justify-between gap-3">
              {empresaAtual?.logotipo_url ? (
                <img 
                  src={empresaAtual.logotipo_url} 
                  alt={empresaAtual.apelido || "Logo da Empresa"}
                  className="h-24 w-24 object-contain"
                />
              ) : (
                <img 
                  src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/690cd380760c45b456c6ef81/7f0d28c9d_Imagem1.jpg" 
                  alt="Logo Padrão"
                  className="h-24 w-24 object-contain"
                />
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
                <p className="text-xs leading-tight">
                  {empresaAtual?.telefone && `Telefone: ${empresaAtual.telefone}`}
                  {empresaAtual?.email && ` E-mail: ${empresaAtual.email}`}
                </p>
              </div>
            </div>
            
            {/* Título do Relatório */}
            <div>
              <h2 className="text-base font-bold">Lista de Fornecedores</h2>
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow className="border-black">
                {colunasVisiveis.includes('numero') && <TableHead className="border border-black text-xs font-bold py-1">Nº Cadastro</TableHead>}
                {colunasVisiveis.includes('nome') && <TableHead className="border border-black text-xs font-bold py-1">Nome</TableHead>}
                {colunasVisiveis.includes('tipo') && <TableHead className="border border-black text-xs font-bold py-1">Tipo</TableHead>}
                {colunasVisiveis.includes('cpf_cnpj') && <TableHead className="border border-black text-xs font-bold py-1">CPF/CNPJ</TableHead>}
                {colunasVisiveis.includes('telefone') && <TableHead className="border border-black text-xs font-bold py-1">Telefone</TableHead>}
                {colunasVisiveis.includes('email') && <TableHead className="border border-black text-xs font-bold py-1">E-mail</TableHead>}
                {colunasVisiveis.includes('cidade') && <TableHead className="border border-black text-xs font-bold py-1">Cidade</TableHead>}
                {colunasVisiveis.includes('estado') && <TableHead className="border border-black text-xs font-bold py-1">Estado</TableHead>}
                {colunasVisiveis.includes('endereco') && <TableHead className="border border-black text-xs font-bold py-1">Endereço</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {fornecedoresFiltrados.map((f) => (
                <TableRow key={f.id}>
                  {colunasVisiveis.includes('numero') && <TableCell className="border border-gray-300 text-xs py-1">{f.numero || '-'}</TableCell>}
                  {colunasVisiveis.includes('nome') && <TableCell className="border border-gray-300 text-xs py-1">{f.nome}</TableCell>}
                  {colunasVisiveis.includes('tipo') && <TableCell className="border border-gray-300 text-xs py-1">{f.tipo_pessoa}</TableCell>}
                  {colunasVisiveis.includes('cpf_cnpj') && <TableCell className="border border-gray-300 text-xs py-1">{f.tipo_pessoa === 'Física' ? f.cpf || '-' : f.cnpj || '-'}</TableCell>}
                  {colunasVisiveis.includes('telefone') && <TableCell className="border border-gray-300 text-xs py-1">{f.telefone || '-'}</TableCell>}
                  {colunasVisiveis.includes('email') && <TableCell className="border border-gray-300 text-xs py-1">{f.email || '-'}</TableCell>}
                  {colunasVisiveis.includes('cidade') && <TableCell className="border border-gray-300 text-xs py-1">{f.cidade || '-'}</TableCell>}
                  {colunasVisiveis.includes('estado') && <TableCell className="border border-gray-300 text-xs uppercase py-1">{f.estado || '-'}</TableCell>}
                  {colunasVisiveis.includes('endereco') && <TableCell className="border border-gray-300 text-xs py-1">{f.endereco || '-'}</TableCell>}
                </TableRow>
              ))}
              <TableRow className="bg-gray-100 font-bold">
                <TableCell colSpan={colunasVisiveis.length} className="border border-black text-xs py-1">
                  TOTAL: {fornecedoresFiltrados.length} cadastros
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>

          {/* Rodapé customizado */}
          <div className="mt-6 pt-2 border-t border-gray-300 text-center text-xs text-gray-500">
            <p>Impresso em: {format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</p>
          </div>
        </div>
      </div>
    </div>
  );
}