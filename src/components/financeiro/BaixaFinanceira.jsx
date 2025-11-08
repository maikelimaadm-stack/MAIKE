import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle, Save, X, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const formatarNumero = (num) => {
  if (!num && num !== 0) return '';
  return String(num).replace('.', ',');
};

const parseNumero = (str) => {
  if (!str) return 0;
  return parseFloat(String(str).replace(',', '.')) || 0;
};

const formatarMoeda = (valor) => {
  if (!valor && valor !== 0) return "R$ 0,00";
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

export default function BaixaFinanceira({ lancamento, onClose, onSuccess }) {
  const [formData, setFormData] = useState({
    data_baixa: new Date().toISOString().split('T')[0],
    valor_baixa: formatarNumero((lancamento.valor_saldo || lancamento.valor_total).toFixed(2)),
    valor_juros: "0,00",
    valor_multa: "0,00",
    valor_desconto: "0,00",
    forma_pagamento_id: "",
    numero_comprovante: "",
    observacoes: ""
  });

  const [user, setUser] = useState(null);
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const queryClient = useQueryClient();

  React.useEffect(() => {
    const loadUser = async () => {
      const currentUser = await base44.auth.me();
      setUser(currentUser);
    };
    loadUser();
  }, []);

  const { data: formasPagamento = [] } = useQuery({
    queryKey: ['formas_baixa', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.FormaPagamento.list();
      return all.filter(f => f.empresa_id === empresaSelecionadaId && f.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: baixasAnteriores = [] } = useQuery({
    queryKey: ['baixas_anteriores', lancamento.id],
    queryFn: async () => {
      const all = await base44.entities.BaixaFinanceira.list('-data_baixa');
      return all.filter(b => b.lancamento_id === lancamento.id);
    },
  });

  const getNextBaixaNumber = async () => {
    const all = await base44.entities.BaixaFinanceira.list();
    const filtered = all.filter(b => b.empresa_id === empresaSelecionadaId);
    const maxNum = filtered.reduce((max, b) => Math.max(max, parseInt(b.numero_baixa) || 0), 0);
    return maxNum + 1;
  };

  const baixaMutation = useMutation({
    mutationFn: async (data) => {
      const numero = await getNextBaixaNumber();
      const forma = formasPagamento.find(f => f.id === data.forma_pagamento_id);
      
      const baixa = {
        empresa_id: empresaSelecionadaId,
        numero_baixa: String(numero),
        lancamento_id: lancamento.id,
        data_baixa: data.data_baixa,
        valor_baixa: parseNumero(data.valor_baixa),
        valor_juros: parseNumero(data.valor_juros),
        valor_multa: parseNumero(data.valor_multa),
        valor_desconto: parseNumero(data.valor_desconto),
        forma_pagamento_id: data.forma_pagamento_id || undefined,
        forma_pagamento_nome: forma?.descricao,
        numero_comprovante: data.numero_comprovante?.toUpperCase() || undefined,
        observacoes: data.observacoes?.toUpperCase() || undefined,
        usuario_responsavel: user?.email
      };

      // Criar a baixa
      const baixaCriada = await base44.entities.BaixaFinanceira.create(baixa);

      // Atualizar o lançamento
      const totalPago = (lancamento.valor_pago || 0) + parseNumero(data.valor_baixa);
      const saldoRestante = (lancamento.valor_total || 0) - totalPago;
      
      let novoStatus = 'Pendente';
      if (saldoRestante <= 0.01) {
        novoStatus = 'Pago';
      } else if (totalPago > 0) {
        novoStatus = 'Pago Parcial';
      }

      await base44.entities.LancamentoFinanceiro.update(lancamento.id, {
        valor_pago: totalPago,
        valor_saldo: Math.max(0, saldoRestante),
        status: novoStatus
      });

      return baixaCriada;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lancamentos_financeiros'] });
      queryClient.invalidateQueries({ queryKey: ['baixas_anteriores'] });
      toast.success('Baixa registrada com sucesso!');
      onSuccess();
    },
    onError: (error) => {
      toast.error(error.message || 'Erro ao registrar baixa.');
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();

    const valorBaixa = parseNumero(formData.valor_baixa);
    const saldoDisponivel = lancamento.valor_saldo || lancamento.valor_total;

    if (valorBaixa <= 0) {
      toast.error('Valor da baixa deve ser maior que zero!');
      return;
    }

    if (valorBaixa > saldoDisponivel) {
      toast.error(`Valor da baixa não pode ser maior que o saldo (${formatarMoeda(saldoDisponivel)})!`);
      return;
    }

    if (window.confirm(`Confirma a baixa de ${formatarMoeda(valorBaixa)} para este lançamento?`)) {
      baixaMutation.mutate(formData);
    }
  };

  const totalBaixa = parseNumero(formData.valor_baixa) + parseNumero(formData.valor_juros) + parseNumero(formData.valor_multa) - parseNumero(formData.valor_desconto);

  return (
    <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
      <Card className="shadow-xl border-slate-200 bg-white">
        <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50 border-b border-slate-200">
          <CardTitle className="flex items-center gap-3 text-slate-900">
            <div className="w-10 h-10 bg-gradient-to-br from-green-600 to-green-700 rounded-xl flex items-center justify-center">
              <CheckCircle className="w-5 h-5 text-white" />
            </div>
            Dar Baixa no Lançamento
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6 space-y-6">
          {/* Informações do Lançamento */}
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div>
                  <strong>Nº:</strong> {lancamento.numero_lancamento}
                </div>
                <div>
                  <strong>Tipo:</strong> {lancamento.tipo}
                </div>
                <div>
                  <strong>Valor Total:</strong> {formatarMoeda(lancamento.valor_total)}
                </div>
                <div>
                  <strong>Saldo:</strong> <span className="text-blue-700 font-bold">{formatarMoeda(lancamento.valor_saldo || lancamento.valor_total)}</span>
                </div>
              </div>
            </AlertDescription>
          </Alert>

          {/* Histórico de Baixas Anteriores */}
          {baixasAnteriores.length > 0 && (
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Histórico de Baixas</Label>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Data</TableHead>
                    <TableHead className="text-xs">Valor</TableHead>
                    <TableHead className="text-xs">Forma</TableHead>
                    <TableHead className="text-xs">Usuário</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {baixasAnteriores.map(b => (
                    <TableRow key={b.id}>
                      <TableCell className="text-xs">{new Date(b.data_baixa).toLocaleDateString('pt-BR')}</TableCell>
                      <TableCell className="text-xs font-semibold">{formatarMoeda(b.valor_baixa)}</TableCell>
                      <TableCell className="text-xs">{b.forma_pagamento_nome || '-'}</TableCell>
                      <TableCell className="text-xs">{b.usuario_responsavel}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Formulário de Baixa */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Data da Baixa *</Label>
                <Input type="date" value={formData.data_baixa} onChange={(e) => setFormData({ ...formData, data_baixa: e.target.value })} required />
              </div>

              <div className="space-y-2">
                <Label>Forma de Pagamento</Label>
                <Select value={formData.forma_pagamento_id} onValueChange={(v) => setFormData({ ...formData, forma_pagamento_id: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {formasPagamento.map(f => (
                      <SelectItem key={f.id} value={f.id}>{f.descricao}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label>Valor da Baixa *</Label>
                <Input value={formData.valor_baixa} onChange={(e) => setFormData({ ...formData, valor_baixa: e.target.value })} placeholder="0,00" required className="font-bold text-lg" />
              </div>

              <div className="space-y-2">
                <Label>Juros</Label>
                <Input value={formData.valor_juros} onChange={(e) => setFormData({ ...formData, valor_juros: e.target.value })} placeholder="0,00" />
              </div>

              <div className="space-y-2">
                <Label>Multa</Label>
                <Input value={formData.valor_multa} onChange={(e) => setFormData({ ...formData, valor_multa: e.target.value })} placeholder="0,00" />
              </div>

              <div className="space-y-2">
                <Label>Desconto</Label>
                <Input value={formData.valor_desconto} onChange={(e) => setFormData({ ...formData, valor_desconto: e.target.value })} placeholder="0,00" />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Número do Comprovante</Label>
              <Input value={formData.numero_comprovante} onChange={(e) => setFormData({ ...formData, numero_comprovante: e.target.value })} placeholder="NÚMERO" className="uppercase" style={{ textTransform: 'uppercase' }} />
            </div>

            <div className="space-y-2">
              <Label>Observações</Label>
              <Textarea value={formData.observacoes} onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })} placeholder="OBSERVAÇÕES..." className="uppercase" style={{ textTransform: 'uppercase' }} />
            </div>

            <Card className="bg-green-50 border-green-200">
              <CardContent className="p-4">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Valor da Baixa:</span>
                    <span className="font-mono">{formatarMoeda(parseNumero(formData.valor_baixa))}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>+ Juros:</span>
                    <span className="font-mono">{formatarMoeda(parseNumero(formData.valor_juros))}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>+ Multa:</span>
                    <span className="font-mono">{formatarMoeda(parseNumero(formData.valor_multa))}</span>
                  </div>
                  <div className="flex justify-between text-sm text-red-600">
                    <span>- Desconto:</span>
                    <span className="font-mono">{formatarMoeda(parseNumero(formData.valor_desconto))}</span>
                  </div>
                  <div className="border-t-2 border-green-400 pt-2 flex justify-between text-lg font-bold text-green-700">
                    <span>TOTAL A PAGAR:</span>
                    <span>{formatarMoeda(totalBaixa)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="flex justify-end gap-3 pt-4">
              <Button type="button" variant="outline" onClick={onClose} className="gap-2">
                <X className="w-4 h-4" />
                Cancelar
              </Button>
              <Button type="submit" className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 gap-2 shadow-lg" disabled={baixaMutation.isPending}>
                <Save className="w-4 h-4" />
                Confirmar Baixa
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}