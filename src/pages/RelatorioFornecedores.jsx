
import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Printer, Settings, Users } from "lucide-react";
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

const COLUNAS_DISPONIVEIS = [
  { id: 'nome', label: 'Nome', default: true },
  { id: 'tipo', label: 'Tipo Pessoa', default: true },
  { id: 'documento', label: 'CPF/CNPJ', default: true },
  { id: 'telefone', label: 'Telefone', default: true },
  { id: 'email', label: 'E-mail', default: true },
  { id: 'cidade', label: 'Cidade', default: true },
  { id: 'estado', label: 'Estado', default: false },
  { id: 'endereco', label: 'Endereço', default: false },
  { id: 'cep', label: 'CEP', default: false },
];

export default function RelatorioFornecedores() {
  const [orientacao, setOrientacao] = useState("retrato");
  
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

  const cidadesUnicas = [...new Set(fornecedores.map(f => f.cidade))].filter(Boolean);
  const estadosUnicos = [...new Set(fornecedores.map(f => f.estado))].filter(Boolean);
  const tiposUnicos = ['Física', 'Jurídica'];

  const fornecedoresFiltrados = useMemo(() => {
    return fornecedores.filter(f => {
      if (tiposSelecionados.length > 0 && !tiposSelecionados.includes(f.tipo_pessoa)) return false;
      if (cidadesSelecionadas.length > 0 && !cidadesSelecionadas.includes(f.cidade)) return false;
      if (estadosSelecionados.length > 0 && !estadosSelecionados.includes(f.estado)) return false;
      if (buscaTelefone && !f.telefone?.includes(buscaTelefone)) return false;
      if (buscaEmail && !f.email?.toLowerCase().includes(buscaEmail.toLowerCase())) return false;
      if (buscaNome && !f.nome?.toLowerCase().includes(buscaNome.toLowerCase())) return false;
      return true;
    });
  }, [fornecedores, tiposSelecionados, cidadesSelecionadas, estadosSelecionados, buscaTelefone, buscaEmail, buscaNome]);

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
  };

  const imprimir = () => {
    window.print();
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
    <div className="p-6 space-y-6">
      <div className="print:hidden flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-gradient-to-br from-green-600 to-green-700 rounded-xl flex items-center justify-center shadow-lg">
            <Users className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-green-900">Lista de Fornecedores</h1>
            <p className="text-green-700">Configure e imprima o relatório</p>
          </div>
        </div>
        <Button onClick={imprimir} className="bg-green-600 hover:bg-green-700 gap-2">
          <Printer className="w-4 h-4" />
          Imprimir
        </Button>
      </div>

      <Card className="shadow-lg border-green-200 print:hidden">
        <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50 border-b">
          <CardTitle className="text-green-900">Filtros e Configurações</CardTitle>
        </CardHeader>
        <CardContent className="p-6 space-y-4">
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
          {/* Cabeçalho com dados da empresa */}
          <div className="flex items-start justify-between border-b-2 border-black pb-4 mb-6">
            {empresaAtual?.logotipo_url ? (
              <img 
                src={empresaAtual.logotipo_url} 
                alt={empresaAtual.apelido || "Logo da Empresa"}
                className="h-20 object-contain"
              />
            ) : (
              <img 
                src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/690cd380760c45b456c6ef81/7f0d28c9d_Imagem1.jpg" 
                alt="Logo Padrão"
                className="h-20"
              />
            )}
            <div className="text-right">
              <h1 className="text-2xl font-bold">{empresaAtual?.apelido || empresaAtual?.nome || 'Empresa'}</h1>
              <p className="text-base">{empresaAtual?.nome || ''}</p>
              {empresaAtual?.endereco && <p className="text-sm">{empresaAtual.endereco}</p>}
              {empresaAtual?.cidade && empresaAtual?.estado && (
                <p className="text-sm">{empresaAtual.cidade} - {empresaAtual.estado}</p>
              )}
              {empresaAtual?.telefone && <p className="text-sm">Tel: {empresaAtual.telefone}</p>}
              {empresaAtual?.email && <p className="text-sm">E-mail: {empresaAtual.email}</p>}
            </div>
          </div>

          <div className="mb-6">
            <h2 className="text-xl font-bold">Lista de Fornecedores</h2>
          </div>

          <Table>
            <TableHeader>
              <TableRow className="border-black">
                {colunasVisiveis.includes('nome') && <TableHead className="border border-black text-xs font-bold">Nome</TableHead>}
                {colunasVisiveis.includes('tipo') && <TableHead className="border border-black text-xs font-bold">Tipo</TableHead>}
                {colunasVisiveis.includes('documento') && <TableHead className="border border-black text-xs font-bold">CPF/CNPJ</TableHead>}
                {colunasVisiveis.includes('telefone') && <TableHead className="border border-black text-xs font-bold">Telefone</TableHead>}
                {colunasVisiveis.includes('email') && <TableHead className="border border-black text-xs font-bold">E-mail</TableHead>}
                {colunasVisiveis.includes('cidade') && <TableHead className="border border-black text-xs font-bold">Cidade</TableHead>}
                {colunasVisiveis.includes('estado') && <TableHead className="border border-black text-xs font-bold">Estado</TableHead>}
                {colunasVisiveis.includes('endereco') && <TableHead className="border border-black text-xs font-bold">Endereço</TableHead>}
                {colunasVisiveis.includes('cep') && <TableHead className="border border-black text-xs font-bold">CEP</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {fornecedoresFiltrados.map((f) => (
                <TableRow key={f.id}>
                  {colunasVisiveis.includes('nome') && <TableCell className="border border-gray-300 text-xs">{f.nome}</TableCell>}
                  {colunasVisiveis.includes('tipo') && <TableCell className="border border-gray-300 text-xs">{f.tipo_pessoa}</TableCell>}
                  {colunasVisiveis.includes('documento') && <TableCell className="border border-gray-300 text-xs">{f.tipo_pessoa === 'Física' ? f.cpf || '-' : f.cnpj || '-'}</TableCell>}
                  {colunasVisiveis.includes('telefone') && <TableCell className="border border-gray-300 text-xs">{f.telefone || '-'}</TableCell>}
                  {colunasVisiveis.includes('email') && <TableCell className="border border-gray-300 text-xs">{f.email || '-'}</TableCell>}
                  {colunasVisiveis.includes('cidade') && <TableCell className="border border-gray-300 text-xs">{f.cidade || '-'}</TableCell>}
                  {colunasVisiveis.includes('estado') && <TableCell className="border border-gray-300 text-xs uppercase">{f.estado || '-'}</TableCell>}
                  {colunasVisiveis.includes('endereco') && <TableCell className="border border-gray-300 text-xs">
                    {
                      `${f.logradouro || ''}${f.numero ? `, ${f.numero}` : ''}${f.complemento ? ` - ${f.complemento}` : ''}${f.bairro ? ` - ${f.bairro}` : ''}`
                      .replace(/^,\s*|-+\s*-+/, '') // Remove leading commas and multiple hyphens
                      .trim()
                      || '-'
                    }
                  </TableCell>}
                  {colunasVisiveis.includes('cep') && <TableCell className="border border-gray-300 text-xs">{f.cep || '-'}</TableCell>}
                </TableRow>
              ))}
              <TableRow className="bg-gray-100 font-bold">
                <TableCell colSpan={colunasVisiveis.length} className="border border-black text-xs">
                  TOTAL: {fornecedoresFiltrados.length} cadastros
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>

          {/* Rodapé customizado */}
          <div className="page-footer hidden print:flex">
            <span>Página 1 de 1</span> {/* This needs to be dynamic for multi-page reports if implemented */}
            <span>Impresso em: {format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
