import React, { useRef, useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { sugerirPercentualPV } from "../suplementacao/suplementacaoRules";
import AutocompleteGenerico from "@/components/financeiro/AutocompleteGenerico";
import { formatarMoedaInput, parseMoedaInput } from "@/components/financeiro/moedaUtils";

const INPUT_CLS = "h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent";
const SELECT_CLS = "h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent";
const AC_INPUT_CLS = "border-0 shadow-none focus-visible:ring-0 bg-transparent h-7";

const FL = ({ label, required, error, children }) => (
  <div>
    <label className="text-[12px] text-slate-500 pl-1 leading-none">
      {label}{required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
    <div className={`rounded-md border ${error ? 'border-red-500 bg-red-50' : 'border-slate-300'} focus-within:border-emerald-500 transition-colors`}>
      {children}
    </div>
  </div>
);

export default function FormularioProduto({ onSubmit, onCancel, initialData, isEditing }) {
  const [formData, setFormData] = useState(() => {
    const defaults = {
      nome_produto: "", codigo_interno: "", codigo_barras: "",
      categoria: "", descricao: "", unidade_medida: "",
      preco_custo: "", preco_venda: "", estoque_minimo: "",
      local_estoque: "", tipo_consumo: "",
      percentual_consumo_pv: "", consumo_minimo_pv: "", consumo_maximo_pv: "",
      unidade_principal_estoque: "KG", peso_por_saco_kg: "",
      observacoes: "", ativo: true,
    };
    if (initialData) return { ...defaults, ...initialData, ativo: initialData.ativo !== false };
    return defaults;
  });

  const [invalidFields, setInvalidFields] = useState([]);
  const nomeProdutoRef = useRef(null);
  const codigoInternoRef = useRef(null);
  const pesoSacoRef = useRef(null);

  const { data: unidades = [] } = useQuery({
    queryKey: ['unidades'],
    queryFn: () => base44.entities.UnidadeMedida.list(),
    initialData: [],
  });

  const { data: categorias = [] } = useQuery({
    queryKey: ['categorias'],
    queryFn: () => base44.entities.Categoria.list(),
    initialData: [],
  });

  const { data: locais = [] } = useQuery({
    queryKey: ['locais'],
    queryFn: () => base44.entities.LocalEstoque.list(),
    initialData: [],
  });

  // Items para AutocompleteGenerico (precisa de id + campo display)
  const categoriasItems = useMemo(() => {
    const fixas = [{ id: '__SUPLEMENTACAO__', nome: 'SUPLEMENTAÇÃO' }];
    const fromDb = categorias.filter(c => c.ativo !== false).map(c => ({ id: c.id, nome: c.nome }));
    return [...fixas, ...fromDb];
  }, [categorias]);

  const unidadesItems = useMemo(() => {
    return unidades.filter(u => u.ativo !== false).map(u => ({ id: u.sigla, nome: u.sigla, descricao: u.descricao, display: `${u.sigla} - ${u.descricao}` }));
  }, [unidades]);

  const locaisItems = useMemo(() => {
    return locais.filter(l => l.ativo !== false).map(l => ({ id: l.nome, nome: l.nome }));
  }, [locais]);

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setInvalidFields(prev => prev.filter(f => f !== field));
  };

  // Autocomplete handlers que mapeiam id -> valor do campo
  const handleCategoriaChange = (id) => {
    const item = categoriasItems.find(c => c.id === id);
    handleChange('categoria', item?.nome || '');
  };

  const handleUnidadeChange = (id) => {
    handleChange('unidade_medida', id || '');
  };

  const handleLocalChange = (id) => {
    handleChange('local_estoque', id || '');
  };

  // Valor monetário helpers
  const precoCustoNum = useMemo(() => {
    if (typeof formData.preco_custo === 'number') return formData.preco_custo;
    return parseMoedaInput(formData.preco_custo);
  }, [formData.preco_custo]);

  const precoVendaNum = useMemo(() => {
    if (typeof formData.preco_venda === 'number') return formData.preco_venda;
    return parseMoedaInput(formData.preco_venda);
  }, [formData.preco_venda]);

  const estoqueMinNum = useMemo(() => {
    if (typeof formData.estoque_minimo === 'number') return formData.estoque_minimo;
    return parseMoedaInput(formData.estoque_minimo);
  }, [formData.estoque_minimo]);

  // Encontrar ID da categoria selecionada para o autocomplete
  const categoriaSelectedId = useMemo(() => {
    if (!formData.categoria) return '';
    const item = categoriasItems.find(c => c.nome === formData.categoria);
    return item?.id || '';
  }, [formData.categoria, categoriasItems]);

  const scrollToField = (element) => {
    if (!element) return;
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => element.focus?.(), 250);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const missingFields = [];
    if (!formData.nome_produto?.trim()) missingFields.push('nome_produto');
    if (!formData.codigo_interno?.trim()) missingFields.push('codigo_interno');
    if (!formData.unidade_medida?.trim()) missingFields.push('unidade_medida');
    if (formData.unidade_principal_estoque === "SACO" && !formData.peso_por_saco_kg) missingFields.push('peso_por_saco_kg');

    if (missingFields.length > 0) {
      setInvalidFields(missingFields);
      if (missingFields[0] === 'nome_produto') scrollToField(nomeProdutoRef.current);
      if (missingFields[0] === 'codigo_interno') scrollToField(codigoInternoRef.current);
      if (missingFields[0] === 'peso_por_saco_kg') scrollToField(pesoSacoRef.current);
      return;
    }

    const data = {
      nome_produto: formData.nome_produto?.toUpperCase(),
      codigo_interno: formData.codigo_interno?.toUpperCase(),
      codigo_barras: formData.codigo_barras || undefined,
      categoria: formData.categoria?.toUpperCase() || undefined,
      descricao: formData.descricao?.toUpperCase() || undefined,
      unidade_medida: formData.unidade_medida?.toUpperCase(),
      preco_custo: precoCustoNum,
      preco_venda: precoVendaNum,
      estoque_minimo: estoqueMinNum,
      local_estoque: formData.local_estoque?.toUpperCase() || undefined,
      tipo_consumo: formData.tipo_consumo || undefined,
      percentual_consumo_pv: parseFloat(formData.percentual_consumo_pv) || undefined,
      consumo_minimo_pv: parseFloat(formData.consumo_minimo_pv) || undefined,
      consumo_maximo_pv: parseFloat(formData.consumo_maximo_pv) || undefined,
      unidade_principal_estoque: formData.unidade_principal_estoque || "KG",
      peso_por_saco_kg: formData.unidade_principal_estoque === "SACO" ? parseFloat(formData.peso_por_saco_kg) || undefined : undefined,
      observacoes: formData.observacoes?.toUpperCase() || undefined,
      ativo: formData.ativo,
    };
    if (!isEditing) data.estoque_atual = 0;
    onSubmit(data);
  };

  return (
    <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
      <Card className="shadow-sm border-slate-300">
        <CardHeader className="flex flex-col space-y-1.5 p-6 bg-slate-50 border-b py-1 px-1">
          <CardTitle className="text-sm font-semibold text-slate-700">
            {isEditing ? 'Editar Produto' : 'Novo Produto'}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-1">
          <form onSubmit={handleSubmit} className="space-y-0.5">
            {/* LINHA 1: Nome | Código | Cód Barras */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
              <FL label="Nome do Produto" required error={invalidFields.includes('nome_produto')}>
                <Input ref={nomeProdutoRef} value={formData.nome_produto} onChange={(e) => handleChange('nome_produto', e.target.value)} placeholder="NOME DO PRODUTO" className={`${INPUT_CLS} uppercase`} style={{ textTransform: 'uppercase' }} />
              </FL>
              <FL label="Código Interno" required error={invalidFields.includes('codigo_interno')}>
                <Input ref={codigoInternoRef} value={formData.codigo_interno} onChange={(e) => handleChange('codigo_interno', e.target.value)} placeholder="CÓDIGO INTERNO" className={`${INPUT_CLS} uppercase`} style={{ textTransform: 'uppercase' }} />
              </FL>
              <FL label="Código de Barras">
                <Input value={formData.codigo_barras} onChange={(e) => handleChange('codigo_barras', e.target.value)} placeholder="7891234567890" className={INPUT_CLS} />
              </FL>
            </div>

            {/* LINHA 2: Categoria | Unidade | Local */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
              <FL label="Categoria">
                <AutocompleteGenerico
                  items={categoriasItems}
                  value={categoriaSelectedId}
                  onChange={handleCategoriaChange}
                  placeholder="BUSCAR CATEGORIA..."
                  displayField="nome"
                  searchFields={["nome"]}
                  className="w-full"
                  inputClassName={AC_INPUT_CLS}
                />
              </FL>
              <FL label="Unidade de Medida" required error={invalidFields.includes('unidade_medida')}>
                <AutocompleteGenerico
                  items={unidadesItems}
                  value={formData.unidade_medida}
                  onChange={handleUnidadeChange}
                  placeholder="BUSCAR UNIDADE..."
                  displayField="display"
                  searchFields={["nome", "descricao"]}
                  renderItem={(u) => <div className="text-xs text-slate-900">{u.nome} - {u.descricao}</div>}
                  className="w-full"
                  inputClassName={AC_INPUT_CLS}
                />
              </FL>
              <FL label="Local de Estoque">
                <AutocompleteGenerico
                  items={locaisItems}
                  value={formData.local_estoque}
                  onChange={handleLocalChange}
                  placeholder="BUSCAR LOCAL..."
                  displayField="nome"
                  searchFields={["nome"]}
                  className="w-full"
                  inputClassName={AC_INPUT_CLS}
                />
              </FL>
            </div>

            {/* LINHA 3: Preço Custo | Preço Venda | Estoque Mínimo */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
              <FL label="Preço de Custo">
                <Input value={formatarMoedaInput(precoCustoNum)} onChange={(e) => handleChange('preco_custo', e.target.value)} placeholder="0,00" className={`${INPUT_CLS} text-right font-mono`} />
              </FL>
              <FL label="Preço de Venda">
                <Input value={formatarMoedaInput(precoVendaNum)} onChange={(e) => handleChange('preco_venda', e.target.value)} placeholder="0,00" className={`${INPUT_CLS} text-right font-mono`} />
              </FL>
              <FL label="Estoque Mínimo">
                <Input value={formatarMoedaInput(estoqueMinNum)} onChange={(e) => handleChange('estoque_minimo', e.target.value)} placeholder="0,00" className={`${INPUT_CLS} text-right font-mono`} />
              </FL>
            </div>

            {/* Descrição */}
            <FL label="Descrição">
              <Textarea value={formData.descricao} onChange={(e) => handleChange('descricao', e.target.value)} placeholder="DESCRIÇÃO DETALHADA DO PRODUTO..." className="text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" style={{ textTransform: 'uppercase' }} rows={2} />
            </FL>

            {/* Seção de Suplementação */}
            {formData.categoria?.toUpperCase()?.includes("SUPLEMENTA") && (
              <div className="border border-indigo-200 bg-indigo-50/50 rounded-lg p-1 space-y-0.5">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-1">
                  <span className="font-semibold text-xs text-slate-700">Configuração de Suplementação</span>
                  {!formData.percentual_consumo_pv && formData.nome_produto && (
                    <Button type="button" variant="outline" size="sm" className="h-7 text-xs border-indigo-300 text-indigo-700"
                      onClick={() => {
                        const sugestao = sugerirPercentualPV(formData.nome_produto);
                        if (sugestao) {
                          setFormData(prev => ({ ...prev, percentual_consumo_pv: sugestao.percentual_consumo_pv, consumo_minimo_pv: sugestao.consumo_minimo_pv, consumo_maximo_pv: sugestao.consumo_maximo_pv, tipo_consumo: sugestao.tipo_consumo }));
                          toast.success(`Valores sugeridos para "${sugestao.label}" aplicados.`);
                        } else { toast.info("Não há sugestão para este produto. Preencha manualmente."); }
                      }}>
                      Sugerir valores
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-1">
                  <FL label="Tipo de consumo">
                    <Select value={formData.tipo_consumo || ""} onValueChange={(value) => handleChange('tipo_consumo', value)}>
                      <SelectTrigger className={SELECT_CLS}><SelectValue placeholder="SELECIONE" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="CONSUMO_DIARIO" className="text-xs">CONSUMO DIÁRIO</SelectItem>
                        <SelectItem value="CONSUMO_LIVRE" className="text-xs">CONSUMO LIVRE</SelectItem>
                      </SelectContent>
                    </Select>
                  </FL>
                  <FL label="%PV consumo padrão">
                    <Input type="number" step="0.001" value={formData.percentual_consumo_pv} onChange={(e) => handleChange('percentual_consumo_pv', e.target.value)} placeholder="0.30" className={INPUT_CLS} />
                  </FL>
                  <FL label="%PV mínimo">
                    <Input type="number" step="0.001" value={formData.consumo_minimo_pv} onChange={(e) => handleChange('consumo_minimo_pv', e.target.value)} placeholder="0.15" className={INPUT_CLS} />
                  </FL>
                  <FL label="%PV máximo">
                    <Input type="number" step="0.001" value={formData.consumo_maximo_pv} onChange={(e) => handleChange('consumo_maximo_pv', e.target.value)} placeholder="0.60" className={INPUT_CLS} />
                  </FL>
                </div>
                <div className="text-[10px] text-indigo-700 bg-indigo-100 rounded px-2 py-1">
                  Fórmula: consumo esperado (kg/dia) = peso vivo médio × (%PV ÷ 100) × nº cabeças. Ex: 450kg × 0.3% = 1,35 kg/cab/dia
                </div>
              </div>
            )}

            {/* Seção de Unidade de Estoque */}
            <div className="border border-slate-200 bg-slate-50/50 rounded-lg p-1 space-y-0.5">
              <span className="font-semibold text-xs text-slate-700">Unidade de Estoque</span>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-1">
                <FL label="Unidade principal de estoque">
                  <Select value={formData.unidade_principal_estoque || "KG"} onValueChange={(value) => handleChange('unidade_principal_estoque', value)}>
                    <SelectTrigger className={SELECT_CLS}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="KG" className="text-xs">QUILOGRAMAS (KG)</SelectItem>
                      <SelectItem value="SACO" className="text-xs">SACOS</SelectItem>
                    </SelectContent>
                  </Select>
                </FL>
                {formData.unidade_principal_estoque === "SACO" && (
                  <FL label="Peso por saco (kg)" required error={invalidFields.includes('peso_por_saco_kg')}>
                    <Input ref={pesoSacoRef} type="number" step="0.1" value={formData.peso_por_saco_kg} onChange={(e) => handleChange('peso_por_saco_kg', e.target.value)} placeholder="40" className={INPUT_CLS} />
                  </FL>
                )}
              </div>
            </div>

            {/* Observações */}
            <FL label="Observações">
              <Textarea value={formData.observacoes} onChange={(e) => handleChange('observacoes', e.target.value)} placeholder="OBSERVAÇÕES GERAIS..." className="text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" style={{ textTransform: 'uppercase' }} rows={2} />
            </FL>

            {/* Ativo */}
            <div className="flex flex-wrap gap-6 py-1 px-1">
              <div className="flex items-center gap-2">
                <Checkbox id="prod_ativo" checked={formData.ativo} onCheckedChange={(v) => handleChange("ativo", v)} />
                <label htmlFor="prod_ativo" className="text-xs text-slate-700 cursor-pointer">Ativo</label>
              </div>
            </div>

            {/* Botões */}
            <div className="flex flex-col-reverse lg:flex-row justify-end gap-1 pt-1 border-t">
              <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-7 text-xs px-3">Cancelar</Button>
              <Button type="submit" size="sm" className="h-7 text-xs px-3 bg-emerald-600 hover:bg-emerald-700 text-white">
                {isEditing ? 'Atualizar' : 'Salvar'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}