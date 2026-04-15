import React, { useState, useMemo, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, X, ArrowRightLeft } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import AutocompleteGenerico from "../financeiro/AutocompleteGenerico.jsx";
import {
  calcularRateioFIFO,
  obterSaldoProdutoLocal,
  getNextSystemNumber,
} from "../suplementacao/estoqueSuplementacaoUtils";

const INPUT_CLS = "h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent";
const AC_INPUT_CLS = "border-0 shadow-none focus-visible:ring-0 bg-transparent h-7 text-xs";

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

export default function TransferenciaEmLoteForm({ onCancel, produtos = [] }) {
  const empresaId = localStorage.getItem('empresa_selecionada_id');
  const queryClient = useQueryClient();

  const [produtoId, setProdutoId] = useState('');
  const [localOrigemId, setLocalOrigemId] = useState('');
  const [dataMovimentacao, setDataMovimentacao] = useState(new Date().toISOString().slice(0, 10));
  const [observacoes, setObservacoes] = useState('');
  const [destinos, setDestinos] = useState([{ localDestinoId: '', quantidade: '' }]);
  const [saving, setSaving] = useState(false);
  const [progresso, setProgresso] = useState({ show: false, etapa: '', current: 0 });
  const [invalidFields, setInvalidFields] = useState([]);

  const { data: locais = [] } = useQuery({
    queryKey: ['locais_estoque_form'],
    queryFn: () => base44.entities.LocalEstoque.list(),
  });

  const { data: lotesNota = [] } = useQuery({
    queryKey: ['estoque_lote_nota_transf_lote', empresaId],
    queryFn: async () => {
      const all = await base44.entities.EstoqueLoteNota.list();
      return all.filter(l => l.empresa_id === empresaId && l.status === 'Disponivel');
    },
    enabled: !!empresaId,
  });

  const { data: user } = useQuery({ queryKey: ['user-transf-lote'], queryFn: () => base44.auth.me() });

  const localOrigem = useMemo(() => locais.find(l => l.id === localOrigemId) || null, [locais, localOrigemId]);

  const produtosFiltrados = useMemo(() => {
    if (!localOrigemId) return [];
    return produtos.filter(p => {
      const saldo = obterSaldoProdutoLocal(lotesNota, p.id, localOrigemId);
      return saldo > 0;
    });
  }, [produtos, localOrigemId, lotesNota]);

  const produtoSelecionado = useMemo(() => produtos.find(p => p.id === produtoId) || null, [produtos, produtoId]);

  const saldoOrigem = useMemo(() => {
    if (!produtoSelecionado || !localOrigemId) return 0;
    return obterSaldoProdutoLocal(lotesNota, produtoSelecionado.id, localOrigemId);
  }, [produtoSelecionado, localOrigemId, lotesNota]);

  const isNutricaoAnimal = produtoSelecionado?.tipo_uso === 'Nutrição Animal';
  const pesoSaco = Number(produtoSelecionado?.peso_por_saco_kg) || 0;
  const permiteConversao = isNutricaoAnimal && pesoSaco > 0;

  const [unidadeTransferencia, setUnidadeTransferencia] = useState('KG');

  useEffect(() => {
    if (produtoSelecionado) {
      const pSaco = Number(produtoSelecionado.peso_por_saco_kg) || 0;
      if (produtoSelecionado.tipo_uso === 'Nutrição Animal' && pSaco > 0) {
        setUnidadeTransferencia(produtoSelecionado.unidade_principal_estoque === 'SACO' ? 'SACO' : 'KG');
      } else {
        setUnidadeTransferencia(produtoSelecionado.unidade_medida || 'UN');
      }
    }
  }, [produtoSelecionado]);

  const getQtdEmKg = (val) => {
    const q = parseFloat(String(val).replace(',', '.')) || 0;
    if (unidadeTransferencia === 'SACO' && permiteConversao) return q * pesoSaco;
    return q;
  };

  const totalDestinoQtdKg = useMemo(() => {
    return destinos.reduce((sum, d) => sum + getQtdEmKg(d.quantidade), 0);
  }, [destinos, unidadeTransferencia, permiteConversao, pesoSaco]);

  const totalDestinoExibicao = useMemo(() => {
    return destinos.reduce((sum, d) => sum + (parseFloat(String(d.quantidade).replace(',', '.')) || 0), 0);
  }, [destinos]);

  const saldoOrigemExibicao = useMemo(() => {
    if (unidadeTransferencia === 'SACO' && permiteConversao) {
      return saldoOrigem / pesoSaco;
    }
    return saldoOrigem;
  }, [saldoOrigem, unidadeTransferencia, permiteConversao, pesoSaco]);

  const locaisDestinos = useMemo(() => locais.filter(l => l.id !== localOrigemId), [locais, localOrigemId]);

  const addDestino = () => setDestinos(prev => [...prev, { localDestinoId: '', quantidade: '' }]);
  const removeDestino = (idx) => setDestinos(prev => prev.filter((_, i) => i !== idx));
  const updateDestino = (idx, field, value) => {
    setDestinos(prev => prev.map((d, i) => i === idx ? { ...d, [field]: value } : d));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const missing = [];
    if (!produtoId) missing.push('produto');
    if (!localOrigemId) missing.push('local_origem');

    const destinosValidos = destinos.filter(d => d.localDestinoId && parseFloat(String(d.quantidade).replace(',', '.')) > 0);
    if (destinosValidos.length === 0) { toast.error('Adicione ao menos um local de destino com quantidade!'); return; }
    if (missing.length > 0) { setInvalidFields(missing); toast.error('Preencha os campos obrigatórios!'); return; }

    if (totalDestinoQtdKg > saldoOrigem) {
      toast.error(`Quantidade total excede o saldo disponível (${saldoOrigem.toFixed(2)} ${produtoSelecionado.unidade_medida || 'UN'}).`);
      return;
    }

    setSaving(true);
    setProgresso({ show: true, etapa: 'Iniciando transferência em lote...', current: 5 });

    try {
      const user_ = user || await base44.auth.me();
      // Buscar lotes atualizados
      const todosLotes = await base44.entities.EstoqueLoteNota.list();
      const lotesDisponiveis = todosLotes.filter(l => l.empresa_id === empresaId && l.status === 'Disponivel');

      // Calcular rateio FIFO global para total necessário
      const resultadoGlobal = calcularRateioFIFO({
        lotesNota: lotesDisponiveis,
        produtoId: produtoSelecionado.id,
        localEstoqueId: localOrigemId,
        quantidade: totalDestinoQtdKg,
      });
      if (!resultadoGlobal.sucesso) throw new Error(resultadoGlobal.erro);

      let numeroBase = await getNextSystemNumber();

      // Para cada destino, criar par Saída+Entrada com rateio proporcional
      for (let idx = 0; idx < destinosValidos.length; idx++) {
        const destino = destinosValidos[idx];
        const qtdDestino = getQtdEmKg(destino.quantidade);
        const localDestino = locais.find(l => l.id === destino.localDestinoId);
        if (!localDestino) continue;

        setProgresso({ show: true, etapa: `Transferindo para ${localDestino.nome} (${idx + 1}/${destinosValidos.length})...`, current: 10 + Math.round((idx / destinosValidos.length) * 80) });

        // Buscar lotes atualizados para este destino (FIFO atualizado após baixas anteriores)
        const lotesAtual = await base44.entities.EstoqueLoteNota.list();
        const lotesAtualDisp = lotesAtual.filter(l => l.empresa_id === empresaId && l.status === 'Disponivel');

        const resultado = calcularRateioFIFO({
          lotesNota: lotesAtualDisp,
          produtoId: produtoSelecionado.id,
          localEstoqueId: localOrigemId,
          quantidade: qtdDestino,
        });
        if (!resultado.sucesso) throw new Error(`Destino ${localDestino.nome}: ${resultado.erro}`);

        const saldoAntesOrigem = obterSaldoProdutoLocal(lotesAtualDisp, produtoSelecionado.id, localOrigemId);
        const saldoAntesDestino = obterSaldoProdutoLocal(lotesAtualDisp, produtoSelecionado.id, destino.localDestinoId);
        const obs = observacoes ? `${observacoes}\n` : '';
        const rateioObs = resultado.rateio.map(r => `${r.numero_documento || 'S/N'}: ${r.quantidade_consumida.toFixed(3)} kg`).join(' | ');

        const movSaida = await base44.entities.MovimentacaoEstoque.create({
          empresa_id: empresaId,
          numero_movimentacao: String(numeroBase),
          tipo_movimentacao: 'Saída',
          tipo_detalhado: 'transferencia_enviada',
          data_movimentacao: dataMovimentacao,
          produto_id: produtoSelecionado.id,
          produto_nome: produtoSelecionado.nome_produto,
          produto_codigo: produtoSelecionado.codigo_interno || '',
          produto_categoria: produtoSelecionado.categoria || '',
          quantidade: qtdDestino,
          unidade_medida: produtoSelecionado.unidade_medida || 'UN',
          valor_unitario: resultado.custoMedioPonderado,
          valor_total: resultado.valorTotal,
          local_estoque_origem: localOrigemId,
          local_origem: localOrigem?.nome || '',
          local_estoque_destino: destino.localDestinoId,
          local_destino: localDestino.nome,
          motivo_movimentacao: 'TRANSFERÊNCIA EM LOTE',
          observacoes: `${obs}[RATEIO_FIFO] ${rateioObs}`,
          origem_sistema: 'manual',
          bloqueado_exclusao_estoque: false,
          is_registro_principal: true,
          numero_movimentacao_seq: 1,
          total_movimentacoes_grupo: 1,
          saldo_antes: saldoAntesOrigem,
          saldo_depois: Math.max(0, saldoAntesOrigem - qtdDestino),
          custo_medio_antes: produtoSelecionado.preco_custo || 0,
          custo_medio_depois: resultado.custoMedioPonderado || 0,
          usuario_responsavel: user_?.email || '',
          status: 'Ativa',
        });

        // Baixar lotes FIFO origem
        for (const item of resultado.rateio) {
          const loteAtual = await base44.entities.EstoqueLoteNota.filter({ id: item.lote_id });
          if (!loteAtual?.length) continue;
          const novoSaldo = Math.max(0, (loteAtual[0].quantidade_disponivel || 0) - item.quantidade_consumida);
          await base44.entities.EstoqueLoteNota.update(item.lote_id, {
            quantidade_disponivel: novoSaldo,
            status: novoSaldo > 0 ? 'Disponivel' : 'Esgotado',
          });
        }

        // Criar lotes no destino
        for (const item of resultado.rateio) {
          await base44.entities.EstoqueLoteNota.create({
            empresa_id: empresaId,
            produto_id: produtoSelecionado.id,
            produto_nome: produtoSelecionado.nome_produto,
            local_estoque_id: destino.localDestinoId,
            local_estoque_nome: localDestino.nome,
            numero_documento: item.numero_documento,
            serie_documento: item.serie_documento || '',
            data_documento: item.data_documento,
            fornecedor_id: item.fornecedor_id,
            fornecedor_nome: item.fornecedor_nome,
            custo_unitario: item.custo_unitario,
            quantidade_entrada: item.quantidade_consumida,
            quantidade_disponivel: item.quantidade_consumida,
            movimentacao_entrada_id: movSaida.id,
            status: 'Disponivel',
          });
        }

        // Movimentação de entrada no destino
        await base44.entities.MovimentacaoEstoque.create({
          empresa_id: empresaId,
          numero_movimentacao: String(numeroBase + 1),
          tipo_movimentacao: 'Entrada',
          tipo_detalhado: 'transferencia_recebida',
          data_movimentacao: dataMovimentacao,
          produto_id: produtoSelecionado.id,
          produto_nome: produtoSelecionado.nome_produto,
          produto_codigo: produtoSelecionado.codigo_interno || '',
          produto_categoria: produtoSelecionado.categoria || '',
          quantidade: qtdDestino,
          unidade_medida: produtoSelecionado.unidade_medida || 'UN',
          valor_unitario: resultado.custoMedioPonderado,
          valor_total: resultado.valorTotal,
          local_estoque_origem: localOrigemId,
          local_origem: localOrigem?.nome || '',
          local_estoque_destino: destino.localDestinoId,
          local_destino: localDestino.nome,
          motivo_movimentacao: 'TRANSFERÊNCIA EM LOTE',
          observacoes: `${obs}[RATEIO_FIFO] ${rateioObs}`,
          origem_sistema: 'manual',
          bloqueado_exclusao_estoque: false,
          is_registro_principal: false,
          numero_movimentacao_seq: 2,
          total_movimentacoes_grupo: 2,
          movimento_pai_id: movSaida.id,
          saldo_antes: saldoAntesDestino,
          saldo_depois: saldoAntesDestino + qtdDestino,
          custo_medio_antes: produtoSelecionado.preco_custo || 0,
          custo_medio_depois: resultado.custoMedioPonderado || 0,
          usuario_responsavel: user_?.email || '',
          status: 'Ativa',
        });

        numeroBase += 2;
      }

      // Atualizar saldo do produto
      const prodAtual = await base44.entities.Produto.filter({ id: produtoSelecionado.id });
      if (prodAtual.length > 0) {
        // Saldo do produto não muda (transferência interna = sem impacto no estoque total)
        // mas precisamos atualizar se quisermos refletir local_estoque
      }

      setProgresso({ show: true, etapa: 'Concluído!', current: 100 });
      await new Promise(r => setTimeout(r, 400));
      queryClient.invalidateQueries({ queryKey: ['movimentacoes'] });
      queryClient.invalidateQueries({ queryKey: ['estoque_lote_nota_movimentacao'] });
      queryClient.invalidateQueries({ queryKey: ['estoque_lote_nota_transf_lote'] });
      toast.success('Transferência em lote realizada com sucesso!');
      onCancel();
    } catch (err) {
      toast.error(err.message || 'Erro ao realizar transferência em lote.');
    } finally {
      setSaving(false);
      setProgresso({ show: false, etapa: '', current: 0 });
    }
  };

  return (
    <>
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <form onSubmit={handleSubmit} className="space-y-1">
          <Card className="shadow-sm border-slate-300">
            <CardHeader className="bg-slate-50 border-b py-1 px-1">
              <CardTitle className="text-sm font-semibold text-slate-900 uppercase flex items-center gap-2">
                <ArrowRightLeft className="w-4 h-4" />
                TRANSFERÊNCIA EM LOTE
              </CardTitle>
            </CardHeader>
            <CardContent className="p-1 space-y-1">

              {/* Linha principal */}
              <div className="grid grid-cols-2 lg:grid-cols-12 gap-1">
                <div className="lg:col-span-2">
                  <FL label="Data" required error={invalidFields.includes('data')}>
                    <Input type="date" value={dataMovimentacao} onChange={e => setDataMovimentacao(e.target.value)} className={INPUT_CLS} />
                  </FL>
                </div>
                <div className="lg:col-span-3">
                  <FL label="Local (Origem)" required error={invalidFields.includes('local_origem')}>
                    <AutocompleteGenerico
                      items={locais}
                      value={localOrigemId}
                      onChange={v => { setLocalOrigemId(v); setProdutoId(''); }}
                      placeholder="BUSCAR LOCAL..."
                      displayField="nome"
                      searchFields={["nome"]}
                      className="w-full"
                      inputClassName={AC_INPUT_CLS}
                    />
                  </FL>
                </div>
                <div className="lg:col-span-3">
                  <FL label="Produto (Origem)" required error={invalidFields.includes('produto')}>
                    <AutocompleteGenerico
                      items={produtosFiltrados}
                      value={produtoId}
                      onChange={v => { setProdutoId(v); }}
                      placeholder={localOrigemId ? "BUSCAR PRODUTO..." : "SELECIONE O LOCAL"}
                      displayField="nome_produto"
                      searchFields={["nome_produto", "codigo_interno"]}
                      className="w-full"
                      inputClassName={AC_INPUT_CLS}
                      disabled={!localOrigemId}
                    />
                  </FL>
                </div>
                {permiteConversao && (
                  <div className="lg:col-span-2">
                    <FL label="Unidade Transf.">
                      <Select value={unidadeTransferencia} onValueChange={setUnidadeTransferencia}>
                        <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="KG" className="text-xs">KG</SelectItem>
                          <SelectItem value="SACO" className="text-xs">SACO</SelectItem>
                        </SelectContent>
                      </Select>
                    </FL>
                  </div>
                )}
                <div className={permiteConversao ? "lg:col-span-2" : "lg:col-span-4"}>
                  <label className="text-[12px] text-slate-500 pl-1 leading-none">Saldo disponível</label>
                  <div className="h-7 flex items-center px-3 bg-slate-100 rounded-md border border-slate-300 text-xs font-semibold text-emerald-700">
                    {saldoOrigemExibicao.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {unidadeTransferencia}
                  </div>
                </div>
              </div>

              {/* Tabela de destinos */}
              <div className="border border-gray-200 rounded-lg">
                <div className="flex justify-between items-center px-2 h-7 bg-slate-100 border-b border-gray-200 rounded-t-lg">
                  <span className="font-semibold text-xs text-slate-700">Locais de Destino</span>
                  <button type="button" onClick={addDestino} className="w-5 h-5 rounded border border-slate-300 bg-white hover:bg-slate-50 text-emerald-600 flex items-center justify-center">
                    <Plus className="w-3 h-3" />
                  </button>
                </div>

                {destinos.length === 0 ? (
                  <div className="text-[11px] text-slate-400 text-center py-4">Nenhum destino adicionado. Clique em + para adicionar.</div>
                ) : (
                  <div className="max-h-[260px]" style={{ overflowX: 'auto', overflowY: 'auto' }}>
                    <table className="w-full border-separate border-spacing-0 table-fixed min-w-[600px]">
                      <colgroup>
                        <col style={{ width: '100%' }} />
                        <col style={{ width: 130 }} />
                        <col style={{ width: 90 }} />
                        <col style={{ width: 28 }} />
                      </colgroup>
                      <thead>
                        <tr>
                          <th className="text-xs py-1 px-2 text-left font-semibold text-slate-600 border-b border-gray-200 bg-white">Local de Destino</th>
                          <th className="text-xs py-1 px-2 text-center font-semibold text-slate-600 border-b border-gray-200 bg-white border-l border-gray-100">Quantidade</th>
                          <th className="text-xs py-1 px-2 text-center font-semibold text-slate-600 border-b border-gray-200 bg-white border-l border-gray-100">UN</th>
                          <th className="text-xs py-1 px-2 border-b border-gray-200 bg-white border-l border-gray-100"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {destinos.map((d, idx) => {
                          const qtd = parseFloat(String(d.quantidade).replace(',', '.')) || 0;
                          const excede = totalDestinoQtdKg > saldoOrigem;
                          return (
                            <tr key={idx} className={`hover:bg-gray-50 ${excede && qtd > 0 ? 'bg-red-50' : ''}`}>
                              <td className="text-xs py-0.5 px-1 border-b border-gray-100 overflow-visible relative">
                                <AutocompleteGenerico
                                  items={locaisDestinos}
                                  value={d.localDestinoId}
                                  onChange={v => updateDestino(idx, 'localDestinoId', v)}
                                  placeholder="BUSCAR DESTINO..."
                                  displayField="nome"
                                  searchFields={["nome"]}
                                  className="w-full"
                                  inputClassName="border-0 shadow-none focus-visible:ring-0 bg-transparent h-[26px] text-xs px-0 uppercase"
                                />
                              </td>
                              <td className="text-xs py-0.5 px-1 border-b border-gray-100 border-l border-gray-100">
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={d.quantidade}
                                  onChange={e => updateDestino(idx, 'quantidade', e.target.value)}
                                  placeholder="0,00"
                                  className="w-full h-[26px] text-xs text-center font-mono bg-transparent border-0 outline-none focus:outline-none"
                                />
                              </td>
                              <td className="text-xs py-0.5 px-2 border-b border-gray-100 border-l border-gray-100 text-center text-slate-500 font-mono">
                                {unidadeTransferencia}
                              </td>
                              <td className="text-xs py-0.5 px-1 border-b border-gray-100 border-l border-gray-100 text-center">
                                <button type="button" onClick={() => removeDestino(idx)} className="text-slate-400 hover:text-red-500">
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className={`flex justify-between text-[11px] px-2 h-[26px] items-center rounded-b-lg border-t ${totalDestinoQtdKg > saldoOrigem ? 'bg-red-50 text-red-700 border-red-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
                  <span className="font-semibold">
                    Total a transferir: {totalDestinoExibicao.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {unidadeTransferencia} 
                    {unidadeTransferencia === 'SACO' && permiteConversao ? ` (${totalDestinoQtdKg.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} KG)` : ''}
                  </span>
                  {totalDestinoQtdKg > saldoOrigem && <span className="font-bold">⚠ EXCEDE O SALDO!</span>}
                </div>
              </div>

              <FL label="Observações">
                <Textarea value={observacoes} onChange={e => setObservacoes(e.target.value.toUpperCase())} placeholder="OBSERVAÇÕES..." className="text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent min-h-[36px]" rows={1} />
              </FL>
            </CardContent>
          </Card>

          <div className="flex flex-col-reverse lg:flex-row justify-end gap-1 pt-1 border-t">
            <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-7 text-xs">Cancelar</Button>
            <Button type="submit" size="sm" className="h-7 text-xs px-3 bg-emerald-600 hover:bg-emerald-700 text-white" disabled={saving}>
              {saving ? 'Salvando...' : 'Realizar Transferência em Lote'}
            </Button>
          </div>
        </form>
      </motion.div>

      <Dialog open={progresso.show} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle className="text-sm">Processando...</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <p className="text-xs text-slate-600">{progresso.etapa}</p>
            <Progress value={progresso.current} className="w-full h-1.5" />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}