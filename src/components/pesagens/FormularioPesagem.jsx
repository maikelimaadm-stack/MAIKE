import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Scale, Save, X, Calculator, Calendar, TrendingDown, TrendingUp, Truck, User, Package, Building2, FileText } from "lucide-react";
import { motion } from "framer-motion";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export default function FormularioPesagem({ onSubmit, onCancel, initialData = null, isEditing = false }) {
  const getDataAtual = () => {
    return new Date().toISOString().split('T')[0];
  };

  const getDataInicial = () => {
    if (!initialData?.data_pesagem) return getDataAtual();
    try {
      const date = new Date(initialData.data_pesagem);
      if (isNaN(date.getTime())) return getDataAtual();
      return date.toISOString().split('T')[0];
    } catch {
      return getDataAtual();
    }
  };

  const [formData, setFormData] = useState({
    data_pesagem: getDataInicial(),
    tipo_pesagem: initialData?.tipo_pesagem || "",
    placa_caminhao: initialData?.placa_caminhao?.toUpperCase() || "",
    nome_motorista: initialData?.nome_motorista?.toUpperCase() || "",
    produto: initialData?.produto?.toUpperCase() || "",
    fornecedor_destino: initialData?.fornecedor_destino?.toUpperCase() || "",
    peso_tara: initialData?.peso_tara || "",
    peso_bruto: initialData?.peso_bruto || "",
    peso_liquido: initialData?.peso_liquido || 0,
    observacoes: initialData?.observacoes?.toUpperCase() || ""
  });

  const [openPlaca, setOpenPlaca] = useState(false);
  const [openMotorista, setOpenMotorista] = useState(false);
  const [openProduto, setOpenProduto] = useState(false);
  const [openFornecedor, setOpenFornecedor] = useState(false);

  // Buscar pesagens existentes para popular os combos
  const { data: pesagens } = useQuery({
    queryKey: ['pesagens'],
    queryFn: () => base44.entities.Pesagem.list(),
    initialData: [],
  });

  // Extrair valores únicos dos lançamentos
  const placasUnicas = [...new Set(pesagens.map(p => p.placa_caminhao).filter(Boolean))].sort();
  const motoristasUnicos = [...new Set(pesagens.map(p => p.nome_motorista).filter(Boolean))].sort();
  const produtosUnicos = [...new Set(pesagens.map(p => p.produto).filter(Boolean))].sort();
  const fornecedoresUnicos = [...new Set(pesagens.map(p => p.fornecedor_destino).filter(Boolean))].sort();

  useEffect(() => {
    const tara = parseFloat(formData.peso_tara) || 0;
    const bruto = parseFloat(formData.peso_bruto) || 0;
    const liquido = bruto - tara;
    setFormData(prev => ({ ...prev, peso_liquido: liquido }));
  }, [formData.peso_tara, formData.peso_bruto]);

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
  };

  const handleChange = (field, value) => {
    let processedValue = value;
    if (['placa_caminhao', 'nome_motorista', 'produto', 'fornecedor_destino', 'observacoes'].includes(field) && typeof value === 'string') {
      processedValue = value.toUpperCase();
    }
    setFormData(prev => ({ ...prev, [field]: processedValue }));
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
    >
      <Card className="shadow-xl border-slate-200 bg-white">
        <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50 border-b border-slate-200">
          <CardTitle className="flex items-center gap-3 text-slate-900">
            <div className="w-10 h-10 bg-gradient-to-br from-green-600 to-green-700 rounded-xl flex items-center justify-center">
              <Scale className="w-5 h-5 text-white" />
            </div>
            {isEditing ? 'Editar Pesagem' : 'Nova Pesagem'}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <Label htmlFor="data_pesagem" className="text-slate-700 font-medium flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-blue-600" />
                  Data da Pesagem *
                </Label>
                <Input
                  id="data_pesagem"
                  type="date"
                  value={formData.data_pesagem}
                  onChange={(e) => handleChange('data_pesagem', e.target.value)}
                  required
                  className="border-slate-300 focus:border-green-500 focus:ring-green-500"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="tipo_pesagem" className="text-slate-700 font-medium flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-purple-600" />
                  Tipo de Pesagem *
                </Label>
                <Select value={formData.tipo_pesagem} onValueChange={(value) => handleChange('tipo_pesagem', value)} required>
                  <SelectTrigger className="border-slate-300 focus:border-green-500 focus:ring-green-500">
                    <SelectValue placeholder="Selecione o tipo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Entrada">Entrada</SelectItem>
                    <SelectItem value="Saída">Saída</SelectItem>
                    <SelectItem value="Ambos">Ambos</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Placa - Combobox */}
              <div className="space-y-2">
                <Label className="text-slate-700 font-medium flex items-center gap-2">
                  <Truck className="w-4 h-4 text-orange-600" />
                  Placa do Caminhão
                </Label>
                <Popover open={openPlaca} onOpenChange={setOpenPlaca}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      className="w-full justify-between uppercase"
                    >
                      {formData.placa_caminhao || "SELECIONE OU DIGITE..."}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-full p-0">
                    <Command>
                      <CommandInput 
                        placeholder="Digite a placa..." 
                        value={formData.placa_caminhao}
                        onValueChange={(value) => handleChange('placa_caminhao', value.toUpperCase())}
                        className="uppercase"
                      />
                      <CommandEmpty>Pressione Enter para adicionar</CommandEmpty>
                      <CommandGroup className="max-h-48 overflow-auto">
                        {placasUnicas.map((placa) => (
                          <CommandItem
                            key={placa}
                            value={placa}
                            onSelect={() => {
                              handleChange('placa_caminhao', placa);
                              setOpenPlaca(false);
                            }}
                            className="uppercase"
                          >
                            {placa}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Motorista - Combobox */}
              <div className="space-y-2">
                <Label className="text-slate-700 font-medium flex items-center gap-2">
                  <User className="w-4 h-4 text-indigo-600" />
                  Nome do Motorista
                </Label>
                <Popover open={openMotorista} onOpenChange={setOpenMotorista}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      className="w-full justify-between uppercase"
                    >
                      {formData.nome_motorista || "SELECIONE OU DIGITE..."}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-full p-0">
                    <Command>
                      <CommandInput 
                        placeholder="Digite o nome..." 
                        value={formData.nome_motorista}
                        onValueChange={(value) => handleChange('nome_motorista', value.toUpperCase())}
                        className="uppercase"
                      />
                      <CommandEmpty>Pressione Enter para adicionar</CommandEmpty>
                      <CommandGroup className="max-h-48 overflow-auto">
                        {motoristasUnicos.map((motorista) => (
                          <CommandItem
                            key={motorista}
                            value={motorista}
                            onSelect={() => {
                              handleChange('nome_motorista', motorista);
                              setOpenMotorista(false);
                            }}
                            className="uppercase"
                          >
                            {motorista}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              {/* Produto - Combobox */}
              <div className="space-y-2">
                <Label className="text-slate-700 font-medium flex items-center gap-2">
                  <Package className="w-4 h-4 text-amber-600" />
                  Produto/Insumo
                </Label>
                <Popover open={openProduto} onOpenChange={setOpenProduto}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      className="w-full justify-between uppercase"
                    >
                      {formData.produto || "SELECIONE OU DIGITE..."}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-full p-0">
                    <Command>
                      <CommandInput 
                        placeholder="Digite o produto..." 
                        value={formData.produto}
                        onValueChange={(value) => handleChange('produto', value.toUpperCase())}
                        className="uppercase"
                      />
                      <CommandEmpty>Pressione Enter para adicionar</CommandEmpty>
                      <CommandGroup className="max-h-48 overflow-auto">
                        {produtosUnicos.map((produto) => (
                          <CommandItem
                            key={produto}
                            value={produto}
                            onSelect={() => {
                              handleChange('produto', produto);
                              setOpenProduto(false);
                            }}
                            className="uppercase"
                          >
                            {produto}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {/* Fornecedor/Destino - Combobox */}
            <div className="space-y-2">
              <Label className="text-slate-700 font-medium flex items-center gap-2">
                <Building2 className="w-4 h-4 text-cyan-600" />
                Fornecedor/Destino
              </Label>
              <Popover open={openFornecedor} onOpenChange={setOpenFornecedor}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    className="w-full justify-between uppercase"
                  >
                    {formData.fornecedor_destino || "SELECIONE OU DIGITE..."}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-full p-0">
                  <Command>
                    <CommandInput 
                      placeholder="Digite o fornecedor/destino..." 
                      value={formData.fornecedor_destino}
                      onValueChange={(value) => handleChange('fornecedor_destino', value.toUpperCase())}
                      className="uppercase"
                    />
                    <CommandEmpty>Pressione Enter para adicionar</CommandEmpty>
                    <CommandGroup className="max-h-48 overflow-auto">
                      {fornecedoresUnicos.map((fornecedor) => (
                        <CommandItem
                          key={fornecedor}
                          value={fornecedor}
                          onSelect={() => {
                            handleChange('fornecedor_destino', fornecedor);
                            setOpenFornecedor(false);
                          }}
                          className="uppercase"
                        >
                          {fornecedor}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <Label htmlFor="peso_tara" className="text-slate-700 font-medium flex items-center gap-2">
                  <TrendingDown className="w-4 h-4 text-slate-600" />
                  Peso Tara (kg) *
                </Label>
                <Input
                  id="peso_tara"
                  type="number"
                  step="0.01"
                  value={formData.peso_tara}
                  onChange={(e) => handleChange('peso_tara', e.target.value)}
                  placeholder="0.00"
                  required
                  className="border-slate-300 focus:border-green-500 focus:ring-green-500 text-lg font-semibold"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="peso_bruto" className="text-slate-700 font-medium flex items-center gap-2">
                  <Scale className="w-4 h-4 text-slate-600" />
                  Peso Bruto (kg) *
                </Label>
                <Input
                  id="peso_bruto"
                  type="number"
                  step="0.01"
                  value={formData.peso_bruto}
                  onChange={(e) => handleChange('peso_bruto', e.target.value)}
                  placeholder="0.00"
                  required
                  className="border-slate-300 focus:border-green-500 focus:ring-green-500 text-lg font-semibold"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-slate-700 font-medium flex items-center gap-2">
                  <Calculator className="w-4 h-4 text-green-600" />
                  Peso Líquido (kg)
                </Label>
                <div className="h-10 px-3 rounded-lg border-2 border-green-500 bg-green-50 flex items-center">
                  <span className="text-2xl font-bold text-green-700">
                    {formData.peso_liquido.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="observacoes" className="text-slate-700 font-medium flex items-center gap-2">
                <FileText className="w-4 h-4 text-slate-600" />
                Observações
              </Label>
              <Textarea
                id="observacoes"
                value={formData.observacoes}
                onChange={(e) => handleChange('observacoes', e.target.value)}
                placeholder="INFORMAÇÕES ADICIONAIS SOBRE A PESAGEM..."
                className="border-slate-300 focus:border-green-500 focus:ring-green-500 min-h-20 uppercase"
                style={{ textTransform: 'uppercase' }}
              />
            </div>

            <div className="flex justify-end gap-3 pt-4">
              {onCancel && (
                <Button type="button" variant="outline" onClick={onCancel} className="gap-2">
                  <X className="w-4 h-4" />
                  Cancelar
                </Button>
              )}
              <Button type="submit" className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 gap-2 shadow-lg">
                <Save className="w-4 h-4" />
                {isEditing ? 'Atualizar' : 'Salvar'} Pesagem
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}