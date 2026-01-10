import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Save, X, Package, FileText, Calendar, Building } from "lucide-react";
import AutocompleteGenerico from "@/components/financeiro/AutocompleteGenerico";

export default function FormularioLancamentoProdutos({ produtos = [], fornecedores = [], initialData = {}, onSubmit, onCancel }) {
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");

  const { data: locaisEstoque = [] } = useQuery({
    queryKey: ["locais_estoque_lanc", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.LocalEstoque.list();
      return all.filter((l) => !l.empresa_id || l.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
    staleTime: 5 * 60 * 1000,
  });

  const [dados, setDados] = useState({
    data_movimentacao: initialData.data_movimentacao || new Date().toISOString().split("T")[0],
    local_estoque_destino: initialData.local_estoque_destino || "",
    fornecedor_id: initialData.fornecedor_id || "",
    fornecedor_nome: initialData.fornecedor_nome || "",
    tipo_documento: initialData.tipo_documento || "NF-e",
    numero_documento: initialData.numero_documento || "",
    serie_documento: initialData.serie_documento || "",
    chave_documento: initialData.chave_documento || "",
    observacoes: initialData.observacoes || "",
  });

  // Estado da linha em edição (para adicionar itens)
  const [produtoSelecionado, setProdutoSelecionado] = useState("");
  const [quantidade, setQuantidade] = useState(1);
  const [valorUnitario, setValorUnitario] = useState(0);

  const produtoAtual = useMemo(() => produtos.find((p) => p.id === produtoSelecionado) || null, [produtos, produtoSelecionado]);

  const [itens, setItens] = useState(() => {
    const list = initialData.produtos || [];
    return Array.isArray(list) ? list : [];
  });

  const adicionarItem = () => {
    if (!produtoAtual || !quantidade || quantidade <= 0) return;
    const novo = {
      produto_id: produtoAtual.id,
      produto_nome: produtoAtual.nome_produto || produtoAtual.nome || "Produto",
      produto_codigo: produtoAtual.codigo_interno || produtoAtual.codigo_barras || "",
      unidade_medida: produtoAtual.unidade_medida || "UN",
      quantidade: Number(quantidade),
      valor_unitario: Number(valorUnitario) || 0,
      valor_total: (Number(quantidade) || 0) * (Number(valorUnitario) || 0),
    };

    setItens((prev) => {
      const idx = prev.findIndex((i) => i.produto_id === novo.produto_id);
      if (idx >= 0) {
        const merged = [...prev];
        const base = merged[idx];
        const qtd = (Number(base.quantidade) || 0) + (Number(novo.quantidade) || 0);
        const vu = novo.valor_unitario || base.valor_unitario || 0;
        merged[idx] = { ...base, quantidade: qtd, valor_unitario: vu, valor_total: qtd * vu };
        return merged;
      }
      return [...prev, novo];
    });

    // reset linha
    setProdutoSelecionado("");
    setQuantidade(1);
    setValorUnitario(0);
  };

  const atualizarItem = (index, campo, valor) => {
    setItens((prev) => {
      const novo = [...prev];
      const item = { ...novo[index], [campo]: campo === "quantidade" || campo === "valor_unitario" ? Number(valor) : valor };
      item.valor_total = (Number(item.quantidade) || 0) * (Number(item.valor_unitario) || 0);
      novo[index] = item;
      return novo;
    });
  };

  const removerItem = (index) => {
    setItens((prev) => prev.filter((_, i) => i !== index));
  };

  const totalGeral = useMemo(() => itens.reduce((s, i) => s + (i.valor_total || 0), 0), [itens]);

  const handleSalvar = () => {
    if (!dados.local_estoque_destino) return;
    if (itens.length === 0) return;
    onSubmit({ ...dados, tipo_movimentacao: "Entrada", produtos: itens });
  };

  const fornecedoresOrdenados = useMemo(() => [...fornecedores].sort((a,b) => (a.nome||"").localeCompare(b.nome||"", 'pt-BR')), [fornecedores]);
  const locaisOrdenados = useMemo(() => [...locaisEstoque].sort((a,b) => (a.nome||"").localeCompare(b.nome||"", 'pt-BR')), [locaisEstoque]);

  return (
    <div className="space-y-4">
      {/* Cabeçalho / filtros principais */}
      <Card className="border-slate-300">
        <CardContent className="p-3">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            <div className="space-y-1">
              <Label className="text-xs flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> Data</Label>
              <Input type="date" value={dados.data_movimentacao} onChange={(e)=>setDados({...dados, data_movimentacao: e.target.value})} className="h-8 text-xs" />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label className="text-xs flex items-center gap-1"><Building className="w-3.5 h-3.5" /> Local de Estoque</Label>
              <Select value={dados.local_estoque_destino} onValueChange={(v)=>setDados({...dados, local_estoque_destino: v})}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Selecione o local" />
                </SelectTrigger>
                <SelectContent>
                  {locaisOrdenados.map((l)=> (
                    <SelectItem key={l.id} value={l.nome} className="text-xs">{l.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label className="text-xs flex items-center gap-1"><FileText className="w-3.5 h-3.5" /> Documento</Label>
              <div className="grid grid-cols-3 gap-2">
                <Select value={dados.tipo_documento} onValueChange={(v)=>setDados({...dados, tipo_documento: v})}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NF-e">NF-e</SelectItem>
                    <SelectItem value="Recibo">Recibo</SelectItem>
                    <SelectItem value="Outro">Outro</SelectItem>
                  </SelectContent>
                </Select>
                <Input placeholder="Número" value={dados.numero_documento} onChange={(e)=>setDados({...dados, numero_documento: e.target.value})} className="h-8 text-xs" />
                <Input placeholder="Série" value={dados.serie_documento} onChange={(e)=>setDados({...dados, serie_documento: e.target.value})} className="h-8 text-xs" />
              </div>
            </div>
            <div className="space-y-1 md:col-span-3">
              <Label className="text-xs">Chave (opcional)</Label>
              <Input placeholder="Chave NF-e" value={dados.chave_documento} onChange={(e)=>setDados({...dados, chave_documento: e.target.value})} className="h-8 text-xs" />
            </div>
            <div className="space-y-1 md:col-span-3">
              <Label className="text-xs">Fornecedor</Label>
              <Select value={dados.fornecedor_id} onValueChange={(v)=>{
                const f = fornecedoresOrdenados.find((x)=>x.id===v);
                setDados({...dados, fornecedor_id: v, fornecedor_nome: f?.nome || ""});
              }}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione"/></SelectTrigger>
                <SelectContent>
                  {fornecedoresOrdenados.map((f)=> (
                    <SelectItem key={f.id} value={f.id} className="text-xs">{f.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Linha de adição de produto */}
      <Card className="border-slate-300">
        <CardContent className="p-3 space-y-2">
          <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
            <div className="md:col-span-3">
              <Label className="text-xs flex items-center gap-1"><Package className="w-3.5 h-3.5" /> Produto</Label>
              <AutocompleteGenerico
                items={produtos}
                value={produtoSelecionado}
                onChange={setProdutoSelecionado}
                placeholder="Buscar produto por nome ou código"
                displayField="nome_produto"
                searchFields={["nome_produto","codigo_interno","codigo_barras","categoria"]}
                className="w-full"
                renderSubtext={(item)=> `Cód: ${item.codigo_interno || item.codigo_barras || '-'}`}
              />
            </div>
            <div className="md:col-span-1">
              <Label className="text-xs">Qtd</Label>
              <Input type="number" value={quantidade} onChange={(e)=>setQuantidade(e.target.value)} className="h-8 text-xs" />
            </div>
            <div className="md:col-span-1">
              <Label className="text-xs">Vlr Unit (R$)</Label>
              <Input type="number" step="0.01" value={valorUnitario} onChange={(e)=>setValorUnitario(e.target.value)} className="h-8 text-xs" />
            </div>
            <div className="md:col-span-1 flex items-end">
              <Button onClick={adicionarItem} size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 gap-1 w-full md:w-auto" disabled={!produtoAtual}>
                <Plus className="w-3.5 h-3.5" /> Adicionar
              </Button>
            </div>
          </div>

          {/* Tabela de itens */}
          <div className="mt-2 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-100">
                  <TableHead className="text-xs font-bold py-1 border border-black">Produto</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black">Unid.</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black text-right">Qtd</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black text-right">Vlr Unit</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black text-right">Total</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black text-center">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {itens.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-xs py-2 border border-gray-300 text-center text-slate-500">Nenhum item adicionado</TableCell>
                  </TableRow>
                ) : (
                  itens.map((item, idx) => (
                    <TableRow key={idx} className="hover:bg-gray-50">
                      <TableCell className="text-xs py-1 border border-gray-300">{item.produto_nome}</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300">{item.unidade_medida || 'UN'}</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300">
                        <Input type="number" value={item.quantidade} onChange={(e)=>atualizarItem(idx,'quantidade', e.target.value)} className="h-8 text-xs text-right" />
                      </TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300">
                        <Input type="number" step="0.01" value={item.valor_unitario} onChange={(e)=>atualizarItem(idx,'valor_unitario', e.target.value)} className="h-8 text-xs text-right" />
                      </TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono">{(item.valor_total || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300 text-center">
                        <Button variant="destructive" size="sm" onClick={()=>removerItem(idx)} className="h-8 text-xs gap-1">
                          <Trash2 className="w-3.5 h-3.5" /> Excluir
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
                {/* Rodapé */}
                <TableRow>
                  <TableCell colSpan={4} className="text-xs py-1 border border-gray-300 text-right font-semibold">Total</TableCell>
                  <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono font-bold">{totalGeral.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                  <TableCell className="text-xs py-1 border border-gray-300" />
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Observações */}
      <Card className="border-slate-300">
        <CardContent className="p-3 space-y-1">
          <Label className="text-xs">Observações</Label>
          <Textarea value={dados.observacoes} onChange={(e)=>setDados({...dados, observacoes: e.target.value})} className="text-xs" rows={3} />
        </CardContent>
      </Card>

      {/* Ações */}
      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onCancel}>
          <X className="w-3.5 h-3.5" /> Cancelar
        </Button>
        <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 gap-1" onClick={handleSalvar}>
          <Save className="w-3.5 h-3.5" /> Salvar
        </Button>
      </div>
    </div>
  );
}