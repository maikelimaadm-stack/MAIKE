import React, { useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Package, Check, X, AlertTriangle } from "lucide-react";

const parseNumero = (str) => {
  if (!str && str !== 0) return 0;
  if (typeof str === 'number') return str;
  return parseFloat(String(str).replace(/\./g, '').replace(',', '.')) || 0;
};
const formatarNumero = (num) => {
  if (!num && num !== 0) return '';
  const numStr = String(num).replace('.', ',');
  const [inteiro, decimal] = numStr.split(',');
  const inteiroFormatado = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return decimal !== undefined ? `${inteiroFormatado},${decimal}` : inteiroFormatado;
};
const formatarMoeda = (valor) => {
  if (!valor && valor !== 0) return 'R$ 0,00';
  return Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

export default function ItemProdutoForm({
  open,
  onClose,
  onConfirm,
  produtos = [],
  tipoMovimentacao,
  tipoDetalhado,
  localOrigemId,
  localDestinoId,
  estoquePorLocal = {},
  lotes = [],
  areas = [],
  maquinas = [],
  initialItem = null,
}) {
  const [item, setItem] = useState(() => initialItem || {
    produto_id: '',
    produto_nome: '',
    unidade: '',
    quantidade: '',
    preco_unitario: '',
    valor_total: '',
    desconto_item: '0,00',
    observacao_item: '',
    vinculo_tipo: '',
    vinculo_id: '',
    vinculo_nome: '',
  });

  useEffect(() => {
    setItem(initialItem || {
      produto_id: '', produto_nome: '', unidade: '', quantidade: '', preco_unitario: '', valor_total: '', desconto_item: '0,00', observacao_item: '', vinculo_tipo: '', vinculo_id: '', vinculo_nome: ''
    });
  }, [initialItem, open]);

  const produtoSelecionado = useMemo(() => produtos.find(p => p.id === item.produto_id), [produtos, item.produto_id]);
  const saldoDisponivel = useMemo(() => {
    if (!item.produto_id) return 0;
    if (tipoMovimentacao === 'Saída' || tipoMovimentacao === 'Transferência') {
      return estoquePorLocal[item.produto_id]?.[localOrigemId] || 0;
    }
    return 0;
  }, [item.produto_id, estoquePorLocal, localOrigemId, tipoMovimentacao]);

  const precoTravado = useMemo(() => {
    if (tipoMovimentacao === 'Transferência') return true;
    if (tipoMovimentacao === 'Saída') {
      const det = (tipoDetalhado || '').toLowerCase();
      if (det.includes('consumo') || det.includes('suplementa') || det.includes('aplica') || det.includes('manuten')) return true;
    }
    return false;
  }, [tipoMovimentacao, tipoDetalhado]);

  useEffect(() => {
    if (!produtoSelecionado) return;
    const upd = { ...item };
    upd.produto_nome = produtoSelecionado.nome_produto;
    upd.unidade = produtoSelecionado.unidade_medida;
    const qtd = parseNumero(upd.quantidade || '0');
    if (tipoMovimentacao === 'Transferência') {
      upd.preco_unitario = formatarNumero(produtoSelecionado.preco_custo || 0);
      upd.valor_total = formatarNumero(qtd * (produtoSelecionado.preco_custo || 0));
      upd.desconto_item = '0,00';
    } else if (tipoMovimentacao === 'Saída') {
      const det = (tipoDetalhado || '').toLowerCase();
      if (det.includes('venda') && (produtoSelecionado.preco_venda || 0) > 0) {
        upd.preco_unitario = formatarNumero(produtoSelecionado.preco_venda);
        upd.valor_total = formatarNumero(qtd * produtoSelecionado.preco_venda);
      } else if (det.includes('consumo') || det.includes('suplementa') || det.includes('aplica') || det.includes('manuten')) {
        upd.preco_unitario = formatarNumero(produtoSelecionado.preco_custo || 0);
        upd.valor_total = formatarNumero(qtd * (produtoSelecionado.preco_custo || 0));
        upd.desconto_item = '0,00';
      }
    }
    setItem(upd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [produtoSelecionado, tipoMovimentacao, tipoDetalhado]);

  const handleChange = (field, value) => setItem(prev => ({ ...prev, [field]: value }));

  const quantidadeNumero = parseNumero(item.quantidade);
  const unitarioNumero = parseNumero(item.preco_unitario);
  const descontoNumero = parseNumero(item.desconto_item);
  const totalCalculado = quantidadeNumero * unitarioNumero;
  const liquido = Math.max(0, totalCalculado - descontoNumero);

  const excedeuSaldo = (tipoMovimentacao === 'Saída' || tipoMovimentacao === 'Transferência') && quantidadeNumero > saldoDisponivel;

  const canConfirm = useMemo(() => {
    if (!item.produto_id) return false;
    if ((tipoMovimentacao === 'Saída' || tipoMovimentacao === 'Transferência') && (!localOrigemId)) return false;
    if (tipoMovimentacao === 'Transferência' && (!localDestinoId)) return false;
    if (excedeuSaldo) return false;
    if (quantidadeNumero <= 0) return false;
    return true;
  }, [item, tipoMovimentacao, localOrigemId, localDestinoId, excedeuSaldo, quantidadeNumero]);

  const handleConfirm = () => {
    const out = {
      produto_id: item.produto_id,
      produto_nome: item.produto_nome,
      unidade: item.unidade,
      quantidade: item.quantidade,
      valor_total: formatarNumero(liquido),
      desconto_item: item.desconto_item || '0,00',
      observacao_item: item.observacao_item || undefined,
      preco_unitario: item.preco_unitario,
      vinculo_tipo: item.vinculo_tipo || undefined,
      vinculo_id: item.vinculo_id || undefined,
      vinculo_nome: item.vinculo_nome || undefined,
    };
    onConfirm(out);
  };

  const produtosDisponiveis = useMemo(() => {
    if (tipoMovimentacao === 'Saída' || tipoMovimentacao === 'Transferência') {
      if (!localOrigemId) return [];
      return produtos
        .map(p => ({
          ...p,
          _saldo: estoquePorLocal[p.id]?.[localOrigemId] || 0,
        }))
        .filter(p => p._saldo > 0);
    }
    return produtos;
  }, [produtos, estoquePorLocal, localOrigemId, tipoMovimentacao]);

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-sm font-semibold flex items-center gap-2">
            <Package className="w-3.5 h-3.5" /> Lançamento de Produto
          </SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          {/* Identificação */}
          <div>
            <div className="font-semibold text-sm text-slate-700 mb-2">Identificação</div>
            <div className="space-y-2">
              <Label className="text-xs">Produto</Label>
              <Select value={item.produto_id} onValueChange={(v) => handleChange('produto_id', v)}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Selecione o produto" />
                </SelectTrigger>
                <SelectContent>
                  {produtosDisponiveis.map((p) => (
                    <SelectItem key={p.id} value={p.id} className="text-xs">
                      {p.nome_produto}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Código</Label>
                  <Input value={produtoSelecionado?.codigo_interno || ''} readOnly className="h-8 text-xs" />
                </div>
                <div>
                  <Label className="text-xs">Unidade</Label>
                  <Input value={produtoSelecionado?.unidade_medida || item.unidade || ''} readOnly className="h-8 text-xs" />
                </div>
              </div>

              {(tipoMovimentacao === 'Saída' || tipoMovimentacao === 'Transferência') && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-600">Saldo disponível:</span>
                  <Badge variant="outline" className={`${saldoDisponivel > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'} text-[10px]`}>
                    {saldoDisponivel.toFixed(2)}
                  </Badge>
                </div>
              )}
            </div>
          </div>

          {/* Quantidade */}
          <div>
            <div className="font-semibold text-sm text-slate-700 mb-2">Quantidade</div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Quantidade</Label>
                <Input
                  value={item.quantidade}
                  onChange={(e) => {
                    const valor = e.target.value.replace(/[^\d,]/g, '');
                    handleChange('quantidade', valor);
                  }}
                  className={`h-9 text-sm ${excedeuSaldo ? 'border-red-300' : ''}`}
                  placeholder="0,00"
                />
              </div>
              <div>
                <Label className="text-xs">Unidade</Label>
                <Input readOnly value={produtoSelecionado?.unidade_medida || item.unidade || ''} className="h-9 text-sm" />
              </div>
            </div>
            {excedeuSaldo && (
              <div className="mt-1 text-xs text-red-600 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" /> Quantidade maior que o saldo disponível
              </div>
            )}
          </div>

          {/* Preço e Valores */}
          <div>
            <div className="font-semibold text-sm text-slate-700 mb-2">Preço e Valores</div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Preço Unitário</Label>
                <Input
                  value={item.preco_unitario}
                  onChange={(e) => handleChange('preco_unitario', e.target.value.replace(/[^\d,]/g, ''))}
                  className="h-9 text-sm"
                  disabled={precoTravado}
                  placeholder="0,00"
                />
              </div>
              <div>
                <Label className="text-xs">Desconto</Label>
                <Input
                  value={item.desconto_item}
                  onChange={(e) => handleChange('desconto_item', e.target.value.replace(/[^\d,]/g, ''))}
                  className="h-9 text-sm"
                  placeholder="0,00"
                />
              </div>
              <div>
                <Label className="text-xs">Valor Total</Label>
                <Input value={formatarNumero(liquido)} readOnly className="h-9 text-sm font-semibold" />
              </div>
            </div>
          </div>

          {/* Vínculo da Saída */}
          {tipoMovimentacao === 'Saída' && (
            <div>
              <div className="font-semibold text-sm text-slate-700 mb-2">Destino / Vínculo</div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Tipo de Vínculo</Label>
                  <Select value={item.vinculo_tipo || ''} onValueChange={(v) => { handleChange('vinculo_tipo', v); handleChange('vinculo_id', ''); handleChange('vinculo_nome', ''); }}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="lote" className="text-xs">Lote (Pecuária)</SelectItem>
                      <SelectItem value="area" className="text-xs">Área / Pasto</SelectItem>
                      <SelectItem value="maquina" className="text-xs">Máquina / Veículo</SelectItem>
                      <SelectItem value="ordem" className="text-xs">Ordem de Serviço</SelectItem>
                      <SelectItem value="producao" className="text-xs">Produção</SelectItem>
                      <SelectItem value="venda" className="text-xs">Venda / Cliente</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Destino</Label>
                  {item.vinculo_tipo === 'lote' && (
                    <Select value={item.vinculo_id || ''} onValueChange={(v) => { const l = lotes.find(x => x.id === v); handleChange('vinculo_id', v); handleChange('vinculo_nome', l?.identificacao || l?.nome || ''); }}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                      <SelectContent>
                        {lotes.map((l) => <SelectItem key={l.id} value={l.id} className="text-xs">{l.identificacao || l.nome}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                  {item.vinculo_tipo === 'area' && (
                    <Select value={item.vinculo_id || ''} onValueChange={(v) => { const a = areas.find(x => x.id === v); handleChange('vinculo_id', v); handleChange('vinculo_nome', a?.nome || ''); }}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                      <SelectContent>
                        {areas.map((a) => <SelectItem key={a.id} value={a.id} className="text-xs">{a.nome}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                  {item.vinculo_tipo === 'maquina' && (
                    <Select value={item.vinculo_id || ''} onValueChange={(v) => { const m = maquinas.find(x => x.id === v); handleChange('vinculo_id', v); handleChange('vinculo_nome', m?.nome || m?.identificacao || ''); }}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                      <SelectContent>
                        {maquinas.map((m) => <SelectItem key={m.id} value={m.id} className="text-xs">{m.nome || m.identificacao}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Observação */}
          <div>
            <div className="font-semibold text-sm text-slate-700 mb-2">Observação do Item</div>
            <Input value={item.observacao_item || ''} onChange={(e) => handleChange('observacao_item', e.target.value)} placeholder="Ex: Aplicado no Lote X" className="h-9 text-sm" />
          </div>

          {/* Resumo */}
          <div className="border rounded p-3 bg-slate-50">
            <div className="text-xs font-semibold mb-1">Resumo</div>
            <div className="text-xs space-y-1">
              <div>Produto: <span className="font-medium">{item.produto_nome || produtoSelecionado?.nome_produto || '-'}</span></div>
              {(tipoMovimentacao === 'Saída' || tipoMovimentacao === 'Transferência') && (
                <div>Saldo: <span className={saldoDisponivel > 0 ? 'text-emerald-700' : 'text-red-700'}>{saldoDisponivel.toFixed(2)}</span></div>
              )}
              <div>Quantidade: <span className="font-medium">{item.quantidade || '0,00'}</span></div>
              <div>Valor Líquido: <span className="font-bold">{formatarMoeda(liquido)}</span></div>
            </div>
          </div>

          {/* Ações */}
          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onClose}><X className="w-3.5 h-3.5 mr-1" />Cancelar</Button>
            <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white" onClick={handleConfirm} disabled={!canConfirm}><Check className="w-3.5 h-3.5 mr-1" />Confirmar Produto</Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}