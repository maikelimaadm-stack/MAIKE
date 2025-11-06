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
];

export default function RelatorioFornecedores() {
  const [orientacao, setOrientacao] = useState("retrato");
  const [colunasVisiveis, setColunasVisiveis] = useState(
    COLUNAS_DISPONIVEIS.filter(c => c.default).map(c => c.id)
  );

  const [tiposSelecionados, setTiposSelecionados] = useState([]);
  const [cidadesSelecionadas, setCidadesSelecionadas] = useState([]);

  const { data: fornecedores, isLoading } = useQuery({
    queryKey: ['fornecedores'],
    queryFn: () => base44.entities.Fornecedor.list('nome'),
    initialData: [],
  });

  const cidadesUnicas = [...new Set(fornecedores.map(f => f.cidade))].filter(Boolean);
  const tiposUnicos = ['Física', 'Jurídica'];

  const fornecedoresFiltrados = useMemo(() => {
    return fornecedores.filter(f => {
      if (tiposSelecionados.length > 0 && !tiposSelecionados.includes(f.tipo_pessoa)) return false;
      if (cidadesSelecionadas.length > 0 && !cidadesSelecionadas.includes(f.cidade)) return false;
      return true;
    });
  }, [fornecedores, tiposSelecionados, cidadesSelecionadas]);

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
    setTiposSelecionados([]);
    setCidadesSelecionadas([]);
  };

  const imprimir = () => {
    window.print();
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

          <div className="flex gap-3 flex-wrap">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="gap-2">
                  Tipo Pessoa {tiposSelecionados.length > 0 && `(${tiposSelecionados.length})`}
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
                  Cidades {cidadesSelecionadas.length > 0 && `(${cidadesSelecionadas.length})`}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 max-h-96 overflow-auto">
                <div className="space-y-2">
                  <h4 className="font-semibold text-sm mb-3">Selecione Cidades</h4>
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
              margin: 1cm;
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
          }
        `}} />
        
        <div className="print-area p-8">
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
                </TableRow>
              ))}
              <TableRow className="bg-gray-100 font-bold">
                <TableCell colSpan={colunasVisiveis.length} className="border border-black text-xs">
                  TOTAL: {fornecedoresFiltrados.length} cadastros
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>

          <div className="mt-6 text-xs text-gray-500 text-right">
            Impresso em: {format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
          </div>
        </div>
      </div>
    </div>
  );
}