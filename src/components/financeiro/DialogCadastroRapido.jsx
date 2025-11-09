
import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function DialogCadastroRapido({ tipo, open, onClose, onSuccess, tipoFinanceiro }) {
  const [formData, setFormData] = useState({
    nome: "",
    codigo: "",
    descricao: "",
    tipo: tipoFinanceiro || "Despesa", // Initialized for PlanoContas/GrupoFinanceiro
    unidade: "UN", // Initialized for Produto
    categoria: "" // Initialized for Produto
  });

  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  const { data: categorias = [] } = useQuery({
    queryKey: ['categorias_dialog'],
    queryFn: () => base44.entities.Categoria.list(),
    initialData: [],
    enabled: tipo === 'produto'
  });

  const createMutation = useMutation({
    mutationFn: async (data) => {
      let newItem;
      let numero; // Used for auto-incrementing number fields

      switch (tipo) {
        case 'centro_custo':
          const allCentros = await base44.entities.CentroCusto.list();
          const maxCentro = allCentros.reduce((max, c) => Math.max(max, parseInt(c.numero_centro) || 0), 0);
          numero = String(maxCentro + 1);
          newItem = await base44.entities.CentroCusto.create({
            empresa_id: empresaSelecionadaId,
            numero_centro: numero,
            nome: data.nome.toUpperCase(),
            descricao: data.descricao?.toUpperCase(),
            ativo: true
          });
          break;

        case 'plano_contas':
          // The outline's mutationFn implies auto-generating 'codigo' for plano_contas
          // and using 'data.tipo' from the form's select.
          const allPlanos = await base44.entities.PlanoContas.list();
          const maxPlano = allPlanos.reduce((max, p) => Math.max(max, parseInt(p.codigo?.split('.')[0]) || 0), 0);
          numero = String(maxPlano + 1); // This generates a 'numero', which is then used as 'codigo'
          newItem = await base44.entities.PlanoContas.create({
            empresa_id: empresaSelecionadaId,
            codigo: numero, // Using auto-generated 'numero' as 'codigo' as per outline
            descricao: data.descricao.toUpperCase(),
            tipo: data.tipo, // From formData.tipo (select in new form)
            ativo: true
          });
          break;

        case 'grupo_financeiro':
          const allGrupos = await base44.entities.GrupoFinanceiro.list();
          const maxGrupo = allGrupos.reduce((max, g) => Math.max(max, parseInt(g.numero_grupo) || 0), 0);
          numero = String(maxGrupo + 1);
          newItem = await base44.entities.GrupoFinanceiro.create({
            empresa_id: empresaSelecionadaId,
            numero_grupo: numero,
            descricao: data.descricao.toUpperCase(),
            tipo: data.tipo, // From formData.tipo (select in new form)
            ativo: true
          });
          break;

        case 'forma_pagamento':
          const allFormas = await base44.entities.FormaPagamento.list();
          const maxForma = allFormas.reduce((max, f) => Math.max(max, parseInt(f.numero_forma) || 0), 0);
          numero = String(maxForma + 1);
          newItem = await base44.entities.FormaPagamento.create({
            empresa_id: empresaSelecionadaId,
            numero_forma: numero,
            descricao: data.descricao.toUpperCase(),
            tipo: data.tipo || 'Outro', // Using data.tipo from new form select
            ativo: true
          });
          break;

        case 'local_estoque':
          const allLocais = await base44.entities.LocalEstoque.list();
          const maxLocal = allLocais.reduce((max, l) => Math.Max(max, parseInt(l.numero_local) || 0), 0);
          numero = String(maxLocal + 1);
          newItem = await base44.entities.LocalEstoque.create({
            numero_local: numero,
            nome: data.nome.toUpperCase(),
            descricao: data.descricao?.toUpperCase(),
            ativo: true
          });
          break;

        case 'produto':
          const allProdutos = await base44.entities.Produto.list();
          const maxProduto = allProdutos.reduce((max, p) => Math.max(max, parseInt(p.numero_produto) || 0), 0);
          numero = String(maxProduto + 1);
          newItem = await base44.entities.Produto.create({
            empresa_id: empresaSelecionadaId,
            numero_produto: numero,
            nome_produto: data.nome.toUpperCase(),
            codigo_interno: data.codigo?.toUpperCase(),
            unidade_medida: data.unidade.toUpperCase(),
            categoria: data.categoria?.toUpperCase(),
            estoque_atual: 0,
            ativo: true
          });
          break;

        default:
          throw new Error('Tipo não suportado');
      }

      return newItem;
    },
    onSuccess: (newEntity) => {
      toast.success('✅ Cadastrado com sucesso!');
      onSuccess(newEntity.id);
      // Reset form data after successful creation
      setFormData({
        nome: "",
        codigo: "",
        descricao: "",
        tipo: tipoFinanceiro || "Despesa",
        unidade: "UN",
        categoria: ""
      });
    },
    onError: (error) => {
      toast.error('Erro ao cadastrar: ' + (error.message || ''));
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();

    // Client-side validation
    if ((tipo === 'centro_custo' || tipo === 'local_estoque' || tipo === 'produto') && !formData.nome) {
      toast.error('Nome é obrigatório!');
      return;
    }

    if ((tipo === 'plano_contas' || tipo === 'grupo_financeiro' || tipo === 'forma_pagamento') && !formData.descricao) {
      toast.error('Descrição é obrigatória!');
      return;
    }

    if (tipo === 'produto' && !formData.unidade) {
      toast.error('Unidade de medida é obrigatória!');
      return;
    }

    createMutation.mutate(formData);
  };

  const getTitulo = () => {
    switch (tipo) {
      case 'centro_custo': return 'Novo Centro de Custo';
      case 'plano_contas': return 'Nova Conta';
      case 'grupo_financeiro': return 'Novo Grupo Financeiro';
      case 'forma_pagamento': return 'Nova Forma de Pagamento';
      case 'local_estoque': return 'Novo Local de Estoque';
      case 'produto': return 'Novo Produto';
      default: return 'Novo Cadastro';
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{getTitulo()}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {(tipo === 'centro_custo' || tipo === 'local_estoque' || tipo === 'produto') && (
            <div className="space-y-2">
              <Label htmlFor="nome">Nome *</Label>
              <Input
                id="nome"
                value={formData.nome}
                onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
                placeholder="NOME"
                className="uppercase"
                style={{ textTransform: 'uppercase' }}
                required
              />
            </div>
          )}

          {(tipo === 'plano_contas' || tipo === 'grupo_financeiro' || tipo === 'forma_pagamento') && (
            <div className="space-y-2">
              <Label htmlFor="descricao">Descrição *</Label>
              <Input
                id="descricao"
                value={formData.descricao}
                onChange={(e) => setFormData({ ...formData, descricao: e.target.value })}
                placeholder="DESCRIÇÃO"
                className="uppercase"
                style={{ textTransform: 'uppercase' }}
                required
              />
            </div>
          )}

          {(tipo === 'centro_custo' || tipo === 'local_estoque') && (
            <div className="space-y-2">
              <Label htmlFor="descricao_opcional">Descrição</Label>
              <Input
                id="descricao_opcional"
                value={formData.descricao}
                onChange={(e) => setFormData({ ...formData, descricao: e.target.value })}
                placeholder="DESCRIÇÃO DETALHADA"
                className="uppercase"
                style={{ textTransform: 'uppercase' }}
              />
            </div>
          )}

          {(tipo === 'plano_contas' || tipo === 'grupo_financeiro') && (
            <div className="space-y-2">
              <Label htmlFor="tipo_financeiro">Tipo *</Label>
              <Select value={formData.tipo} onValueChange={(v) => setFormData({ ...formData, tipo: v })} required>
                <SelectTrigger id="tipo_financeiro">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Receita">Receita</SelectItem>
                  <SelectItem value="Despesa">Despesa</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {tipo === 'forma_pagamento' && (
            <div className="space-y-2">
              <Label htmlFor="tipo_pagamento">Tipo</Label>
              <Select value={formData.tipo} onValueChange={(v) => setFormData({ ...formData, tipo: v })}>
                <SelectTrigger id="tipo_pagamento">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Dinheiro">Dinheiro</SelectItem>
                  <SelectItem value="PIX">PIX</SelectItem>
                  <SelectItem value="Cartão">Cartão</SelectItem>
                  <SelectItem value="Transferência">Transferência</SelectItem>
                  <SelectItem value="Boleto">Boleto</SelectItem>
                  <SelectItem value="Cheque">Cheque</SelectItem>
                  <SelectItem value="Outro">Outro</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {tipo === 'produto' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="codigo_produto">Código Interno</Label>
                <Input
                  id="codigo_produto"
                  value={formData.codigo}
                  onChange={(e) => setFormData({ ...formData, codigo: e.target.value })}
                  placeholder="CÓDIGO"
                  className="uppercase"
                  style={{ textTransform: 'uppercase' }}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="unidade_medida">Unidade de Medida *</Label>
                  <Select value={formData.unidade} onValueChange={(v) => setFormData({ ...formData, unidade: v })} required>
                    <SelectTrigger id="unidade_medida">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="UN">UN - Unidade</SelectItem>
                      <SelectItem value="KG">KG - Quilograma</SelectItem>
                      <SelectItem value="L">L - Litro</SelectItem>
                      <SelectItem value="M">M - Metro</SelectItem>
                      <SelectItem value="CX">CX - Caixa</SelectItem>
                      <SelectItem value="SC">SC - Saco</SelectItem>
                      <SelectItem value="G">G - Grama</SelectItem>
                      <SelectItem value="MG">MG - Miligrama</SelectItem>
                      <SelectItem value="ML">ML - Mililitro</SelectItem>
                      <SelectItem value="M2">M2 - Metro Quadrado</SelectItem>
                      <SelectItem value="M3">M3 - Metro Cúbico</SelectItem>
                      <SelectItem value="CM">CM - Centímetro</SelectItem>
                      <SelectItem value="MM">MM - Milímetro</SelectItem>
                      <SelectItem value="PC">PC - Peça</SelectItem>
                      <SelectItem value="FD">FD - Fardo</SelectItem>
                      <SelectItem value="TON">TON - Tonelada</SelectItem>
                      <SelectItem value="KIT">KIT - Kit</SelectItem>
                      <SelectItem value="JG">JG - Jogo</SelectItem>
                      <SelectItem value="PAR">PAR - Par</SelectItem>
                      <SelectItem value="DZ">DZ - Dúzia</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="categoria_produto">Categoria</Label>
                  <Select value={formData.categoria} onValueChange={(v) => setFormData({ ...formData, categoria: v })}>
                    <SelectTrigger id="categoria_produto">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {categorias.map(c => (
                        <SelectItem key={c.id} value={c.nome}>{c.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </>
          )}

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={onClose} disabled={createMutation.isPending}>Cancelar</Button>
            <Button type="submit" className="bg-green-600" disabled={createMutation.isPending}>
              {createMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Salvando...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  Salvar
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
