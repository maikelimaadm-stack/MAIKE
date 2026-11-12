import { LancLoteDialogo } from "@/components/lotes/LancamentoLoteUi";
import React, { useId, useMemo, useState } from "react";
import { listarTodosLotesNota, listarTodosProdutos, listarTodasMovimentacoes } from "@/services/estoqueMapaService";
import { listarPontosSuplementacaoAtivos, listarAreasAtivas } from "@/services/mapaService";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MobileSheetPortalCtx } from "@/components/common/MobileSheet";
import FormularioTransferenciaDeposito from "./FormularioTransferenciaDeposito";
import HistoricoDepositoSuplementacao from "../suplementacao/HistoricoDepositoSuplementacao";
import DepositoNivel from "./DepositoNivel";
import { formatDecimal, formatKg } from "../suplementacao/formatters";
import { kgParaSacos } from "../suplementacao/unidadeConversaoUtils";
import { getDepositoIndicator } from "./pontoStatusUtils";
import { normalizeText } from "../suplementacao/estoqueSuplementacaoUtils";
import { useEmpresaSelecionadaId } from "@/hooks/useEmpresaSelecionadaId";

export default function DetalhesDepositoSuplementacao({ deposito, onClose, permissions = {} }) {
  const empresaSelecionadaId = useEmpresaSelecionadaId();
  const queryClient = useQueryClient();
  const [showTransferencia, setShowTransferencia] = useState(false);
  const [showHistorico, setShowHistorico] = useState(false);
  const [transferDirection, setTransferDirection] = useState("entrada");
  // Alvo das folhas do celular DENTRO do diálogo da transferência (D-PROD-161).
  const [alvoFolhaTransferencia, setAlvoFolhaTransferencia] = useState(/** @type {HTMLElement | null} */ (null));
  const idTituloNivel = useId();
  const idGrupoLitros = useId();

  const { data: lotesNota = [], isLoading: loadingSaldo } = useQuery({
    queryKey: ["saldo-deposito", deposito.id],
    queryFn: async () => {
      const all = await listarTodosLotesNota();
      return all.filter((lote) => lote.empresa_id === empresaSelecionadaId && lote.local_estoque_id === deposito.local_estoque_id && lote.status === "Disponivel");
    },
    enabled: !!empresaSelecionadaId && !!deposito.local_estoque_id,
    staleTime: 60 * 1000
  });

  const { data: produtos = [], isLoading: loadingProdutos } = useQuery({
    queryKey: ["produtos-deposito-detalhe", empresaSelecionadaId],
    queryFn: async () => {
      const all = await listarTodosProdutos();
      return all.filter((produto) => produto.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
    staleTime: 5 * 60 * 1000
  });

  const { data: pontosSuplementacao = [], isLoading: loadingCochos } = useQuery({
    queryKey: ["cochos-vinculados-deposito", deposito.id],
    queryFn: async () => {
      return listarPontosSuplementacaoAtivos(empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
    staleTime: 60 * 1000
  });

  const { data: areas = [], isLoading: loadingAreas } = useQuery({
    queryKey: ["areas-deposito-detalhe", empresaSelecionadaId],
    queryFn: async () => {
      return listarAreasAtivas(empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
    staleTime: 5 * 60 * 1000
  });

  const { data: movimentacoes = [] } = useQuery({
    queryKey: ["movimentacoes-deposito-detalhe", deposito.id],
    queryFn: async () => {
      const all = await listarTodasMovimentacoes();
      return all.filter((item) => item.empresa_id === empresaSelecionadaId && (item.local_estoque_origem === deposito.local_estoque_id || item.local_estoque_destino === deposito.local_estoque_id));
    },
    enabled: !!empresaSelecionadaId && !!deposito.local_estoque_id
  });

  const cochosVinculados = useMemo(() => {
    return pontosSuplementacao.filter((ponto) => normalizeText(ponto.categoria_ponto || "COCHO") === "COCHO" && ponto.deposito_origem_id === deposito.id);
  }, [pontosSuplementacao, deposito.id]);

  // D-PROD-162 (P-11): Produto com estoque em LITROS aparece no saldo por produto com "L", sem sacos,
  // numa lista à parte, e fica fora dos indicadores em kg (saldo, necessidade, % e último registro).
  // Mesmos lotes do nível (D-PROD-178): só quantidade disponível > 0; a soma das linhas em kg é o
  // "Saldo atual kg". Lote de produto fora do cadastro continua em kg, marcado "unidade não confirmada".
  const saldosAgrupados = useMemo(() => {
    const mapa = new Map();
    lotesNota.forEach((lote) => {
      const quantidade = Number(lote.quantidade_disponivel) || 0;
      if (quantidade <= 0) return;
      const produto = produtos.find((item) => item.id === lote.produto_id);
      const emLitros = produto?.unidade_principal_estoque === "L";
      const pesoPorSaco = emLitros ? 0 : Number(produto?.peso_por_saco_kg || 0);
      const current = mapa.get(lote.produto_id) || {
        produto_id: lote.produto_id,
        produto_nome: produto?.nome_produto || lote.produto_nome || "Produto sem nome",
        saldo: 0,
        saldoSacos: 0,
        unidadeConfirmada: Boolean(produto),
        ...(emLitros ? { emLitros: true } : {})
      };
      current.saldo += quantidade;
      current.saldoSacos += pesoPorSaco > 0 ? kgParaSacos(quantidade, pesoPorSaco) : 0;
      mapa.set(lote.produto_id, current);
    });
    const ordenados = Array.from(mapa.values()).sort((a, b) => a.produto_nome.localeCompare(b.produto_nome, "pt-BR"));
    return { emKg: ordenados.filter((item) => !item.emLitros), emLitros: ordenados.filter((item) => item.emLitros) };
  }, [lotesNota, produtos]);

  // Só o SSOT (D-PROD-178): o nível não depende de cochos nem de lotes de gado.
  const indicador = useMemo(() => {
    return getDepositoIndicator(deposito, [], [], lotesNota, movimentacoes, produtos);
  }, [deposito, lotesNota, movimentacoes, produtos]);

  // Nível do SSOT (D-PROD-178): o mesmo número do marcador do mapa.
  const nivel = indicador.nivel;
  const ultimoRegistro = indicador.latestRecord;
  const totalSaldoSacos = useMemo(() => saldosAgrupados.emKg.reduce((total, item) => total + (item.saldoSacos || 0), 0), [saldosAgrupados]);
  const ultimoProduto = useMemo(() => {
    if (!ultimoRegistro?.produto_id) return null;
    return produtos.find((produto) => produto.id === ultimoRegistro.produto_id) || null;
  }, [produtos, ultimoRegistro]);
  const ultimoRegistroSacos = useMemo(() => {
    const pesoPorSaco = Number(ultimoProduto?.peso_por_saco_kg || 0);
    if (!ultimoRegistro || pesoPorSaco <= 0) return null;
    return (ultimoRegistro.quantidade || 0) / pesoPorSaco;
  }, [ultimoProduto, ultimoRegistro]);

  const handleSaved = () => {
    queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && ["saldo-deposito", "cochos-vinculados-deposito", "movimentacoes-deposito-detalhe", "mapa-pontos-supl", "mapa-pontos", "pontos", "pontos-suplementacao"].includes(query.queryKey[0]) });
    window.dispatchEvent(new CustomEvent("atualizar-mapa"));
  };

  // Os produtos entram: sem eles a unidade dos lotes não é conhecida e o litro cairia no kg no primeiro quadro.
  const loadingInicial = loadingSaldo || loadingProdutos || loadingCochos || loadingAreas;

  if (loadingInicial) {
    return (
      <div className="mk-map-details space-y-1" translate="no">
        <div className="rounded-lg border border-slate-200 bg-white p-4 flex items-center gap-3">
          <div className="animate-spin w-5 h-5 border-2 border-emerald-600 border-t-transparent rounded-full" />
          <span className="text-xs font-medium text-slate-700">Carregando detalhes do depósito...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="mk-map-details space-y-1" translate="no">
      <div className="pb-1 border-b space-y-1">
        <div className="flex items-center gap-1 flex-wrap">
          <Badge variant="outline" className="bg-yellow-400 text-slate-950 px-2.5 py-0.5 text-xs font-semibold rounded-md inline-flex items-center border border-yellow-300">Local: {deposito.nome_ponto}</Badge>
        </div>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-3 gap-1">
        {permissions.movimentar_depositos !== false && <Button data-mk-map-action="" variant="outline" size="sm" className="h-8 text-xs" onClick={() => { setTransferDirection("entrada"); setShowTransferencia(true); }}>Entrada</Button>}
        {permissions.movimentar_depositos !== false && <Button data-mk-map-action="" variant="outline" size="sm" className="h-8 text-xs" onClick={() => { setTransferDirection("saida"); setShowTransferencia(true); }}>Saída</Button>}
        {permissions.visualizar_historico_cocho !== false && <Button data-mk-map-action="" variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowHistorico(true)}>Histórico</Button>}
      </div>

      {/* Mesmo visual dos cartões (Card + CardContent), como região nomeada para o leitor de tela. */}
      <section aria-labelledby={idTituloNivel} className="rounded-xl border bg-card text-card-foreground border-slate-200 shadow-sm">
        <div className="p-1 space-y-1">
          <div id={idTituloNivel} className="text-[11px] font-bold text-slate-900">Nível do depósito</div>
          <DepositoNivel nivel={nivel} />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-1 text-[10px]">
            <div className="rounded-lg border border-slate-200 bg-[#FAFCFE] p-2.5">
              <div className="text-slate-500">Saldo atual kg</div>
              <div className="text-sm font-bold text-slate-900">{formatKg(indicador.saldoAtual)}</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-[#FAFCFE] p-2.5">
              <div className="text-slate-500">Saldo em sacos</div>
              <div className="text-sm font-bold text-slate-900">{totalSaldoSacos.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} sacos</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-[#FAFCFE] p-2.5">
              <div className="text-slate-500">Necessidade reposição kg</div>
              <div className="text-sm font-bold text-slate-900">{formatKg(indicador.necessidadeReposicao || 0)}</div>
            </div>
          </div>
        </div>
      </section>

      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-1 space-y-1">
          <div className="text-[11px] font-bold text-slate-900">Saldo por Produto</div>
          {saldosAgrupados.emKg.length === 0 && saldosAgrupados.emLitros.length === 0 ?
          <div className="text-xs text-slate-500">Sem saldo disponível neste depósito.</div> :

          <div className="space-y-1">
              {saldosAgrupados.emKg.map((item) => <LinhaSaldoProduto key={item.produto_id} item={item} />)}
              {saldosAgrupados.emLitros.length > 0 &&
            <div role="group" aria-labelledby={idGrupoLitros} className="space-y-1">
                  <div id={idGrupoLitros} className="px-1 pt-0.5 text-[10px] font-semibold text-slate-600">Em litros (fora do saldo em kg)</div>
                  {saldosAgrupados.emLitros.map((item) => <LinhaSaldoProduto key={item.produto_id} item={item} />)}
                </div>
            }
            </div>
          }
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-1 space-y-1">
          <div className="text-[11px] font-bold text-slate-900">Último Registro</div>
          {ultimoRegistro ?
          <div className="space-y-1.5">
              <div className="text-xs font-semibold text-slate-900">{ultimoRegistro.produto_nome}</div>
              <div>
                <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Movimentação</div>
                <div className="grid grid-cols-2 gap-1 text-[10px]">
                  <div className="rounded border border-slate-200 bg-white px-1.5 py-1"><div className="text-slate-500">Tipo</div><div className="font-semibold text-slate-900">{ultimoRegistro.tipo_movimentacao}</div></div>
                  <div className="rounded border border-slate-200 bg-white px-1.5 py-1"><div className="text-slate-500">Data</div><div className="font-semibold text-slate-900">{new Date(ultimoRegistro.data_movimentacao).toLocaleDateString("pt-BR")}</div></div>
                </div>
              </div>
              <div>
                <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Quantidade</div>
                <div className="grid grid-cols-2 gap-1 text-[10px]">
                  <div className="rounded border border-slate-200 bg-white px-1.5 py-1"><div className="text-slate-500">Quantidade kg</div><div className="font-semibold text-slate-900">{formatKg(ultimoRegistro.quantidade || 0)}</div></div>
                  <div className="rounded border border-slate-200 bg-white px-1.5 py-1"><div className="text-slate-500">Quantidade sacos</div><div className="font-semibold text-slate-900">{ultimoRegistroSacos != null ? ultimoRegistroSacos.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}</div></div>
                </div>
              </div>
              <div>
                <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Local</div>
                <div className="grid grid-cols-2 gap-1 text-[10px]">
                  <div className="rounded border border-slate-200 bg-white px-1.5 py-1"><div className="text-slate-500">Origem</div><div className="font-semibold text-slate-900">{ultimoRegistro.local_origem || "-"}</div></div>
                  <div className="rounded border border-slate-200 bg-white px-1.5 py-1"><div className="text-slate-500">Destino</div><div className="font-semibold text-slate-900">{ultimoRegistro.tipo_detalhado === "suplementacao" ? "Suplementação" : ultimoRegistro.local_destino || "-"}</div></div>
                </div>
              </div>
              {ultimoRegistro.observacoes && <div className="text-[10px] text-slate-500 break-words">Obs: {ultimoRegistro.observacoes}</div>}
            </div> :

          <div className="text-xs text-slate-500">Nenhum registro ainda.</div>
          }
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-1 space-y-1">
          <div className="text-[11px] font-bold text-slate-900">Pastos atendidos pela saída do estoque</div>
          {cochosVinculados.length === 0 ?
          <div className="text-xs text-slate-500">Nenhum cocho vinculado a este depósito.</div> :

          <div className="space-y-2">
              {cochosVinculados.map((cocho) => {
              const areaIds = Array.isArray(cocho.area_vinculada_ids) && cocho.area_vinculada_ids.length > 0 ?
              cocho.area_vinculada_ids :
              cocho.area_vinculada_id ? [cocho.area_vinculada_id] : [];
              const nomesPorId = new Map(areas.map((area) => [area.id, area.nome]));
              const nomesResolvidos = areaIds.map((id) => nomesPorId.get(id)).filter(Boolean);
              const pastosAtendidos = nomesResolvidos.length > 0 ?
              nomesResolvidos.join(', ') :
              Array.isArray(cocho.area_vinculada_nomes) && cocho.area_vinculada_nomes.length > 0 ?
              cocho.area_vinculada_nomes.join(', ') :
              cocho.area_vinculada_nome || 'Sem pasto vinculado';
              return <div key={cocho.id} className="rounded-lg border border-slate-200 bg-[#FAFCFE] px-1 py-1">
                  <div className="text-[10px] text-slate-500">Cocho: {cocho.nome_ponto}</div>
                  <div className="text-[10px] text-slate-500">Saída do estoque para: {pastosAtendidos}</div>
                </div>;
            })}
            </div>
          }
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-1 space-y-1">
          <div className="text-[11px] font-bold text-slate-900">Informações do Depósito</div>
          <div className="space-y-1 text-[10px]">
            







            
            <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Número:</span><span className="font-semibold text-slate-900">{deposito.numero_ponto || '-'}</span></div>
            <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Sigla:</span><span className="font-semibold text-slate-900">{deposito.sigla || '-'}</span></div>
            <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Tipo:</span><span className="font-semibold text-slate-900">{deposito.tipo || '-'}</span></div>
            <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Local de estoque:</span><span className="font-semibold text-slate-900">{deposito.local_estoque_nome || '-'}</span></div>
            <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Produto padrão:</span><span className="font-semibold text-slate-900">{deposito.produto_padrao || '-'}</span></div>
            <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Limite operacional:</span><span className="font-semibold text-slate-900">{nivel.limiteOperacionalKg != null ? formatKg(nivel.limiteOperacionalKg) : '-'}</span></div>
            <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Estoque mínimo:</span><span className="font-semibold text-slate-900">{nivel.estoqueMinimoKg != null ? formatKg(nivel.estoqueMinimoKg) : '-'}</span></div>
            <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Frequência padrão:</span><span className="font-semibold text-slate-900">{deposito.frequencia_esperada_dias ? `${deposito.frequencia_esperada_dias} dia(s)` : '-'}</span></div>
            <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Cochos vinculados:</span><span className="font-semibold text-slate-900">{cochosVinculados.length}</span></div>
            <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Observações:</span><span className="font-semibold text-slate-900 break-words">{deposito.observacoes || '-'}</span></div>
          </div>
        </CardContent>
      </Card>

      {/*
        D-PROD-161: este diálogo abre POR CIMA do "Depósito de Suplementação"
        (LancLoteDialogo), que entrega aos filhos o alvo das folhas do celular.
        Herdado, a folha "Local" nascia no diálogo de BAIXO — aria-hidden, sem
        toque e atrás deste. Aqui ela nasce DENTRO deste diálogo (camada de
        cima: foco, toque e leitor de tela); no celular ele centraliza sem
        transform para a folha (position: fixed) ocupar a tela, não o cartão;
        Escape com a folha aberta fecha só a folha (o pedido de fechar o
        diálogo é ignorado enquanto houver folha aberta dentro dele).
      */}
      <Dialog
        open={showTransferencia}
        onOpenChange={(aberto) => {
          if (!aberto && alvoFolhaTransferencia?.querySelector(".mk-sheet-root")) return;
          setShowTransferencia(aberto);
        }}>
        <DialogContent
          className="mk-map-dialog max-w-[880px] max-h-[90vh] overflow-y-auto max-sm:inset-0 max-sm:m-auto max-sm:h-fit max-sm:transform-none max-sm:data-[state=open]:slide-in-from-left-0 max-sm:data-[state=open]:slide-in-from-top-0 max-sm:data-[state=closed]:slide-out-to-left-0 max-sm:data-[state=closed]:slide-out-to-top-0">
          <DialogHeader><DialogTitle className="text-sm">{transferDirection === "entrada" ? "Entrada no Depósito" : "Saída do Depósito"}</DialogTitle></DialogHeader>
          <MobileSheetPortalCtx.Provider value={alvoFolhaTransferencia}>
            <FormularioTransferenciaDeposito deposito={deposito} initialDirection={transferDirection} onSuccess={() => {setShowTransferencia(false);handleSaved();}} onCancel={() => setShowTransferencia(false)} />
          </MobileSheetPortalCtx.Provider>
          <div ref={setAlvoFolhaTransferencia} className="contents" />
        </DialogContent>
      </Dialog>

      <LancLoteDialogo open={showHistorico} onOpenChange={setShowHistorico} titulo="Histórico do Depósito" largo somenteLeitura>
          <HistoricoDepositoSuplementacao deposito={deposito} />
        </LancLoteDialogo>
    </div>);

}

/**
 * Linha do "Saldo por Produto": sacos e kg; em LITROS, "—" nos sacos e o
 * volume em L (D-PROD-162, P-11). Produto fora do cadastro: unidade não
 * confirmada (o saldo continua em kg, como no nível).
 * @param {{ item: { produto_id: string, produto_nome: string, saldo: number, saldoSacos: number, unidadeConfirmada: boolean, emLitros?: boolean } }} props
 */
function LinhaSaldoProduto({ item }) {
  return (
    <div data-unidade-confirmada={String(item.unidadeConfirmada)} className="rounded-lg border border-slate-200 bg-[#FAFCFE] px-2 py-1.5">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 text-xs">
        <div className="min-w-0">
          <div className="truncate font-medium text-slate-900">{item.produto_nome}</div>
          {!item.unidadeConfirmada && <div className="text-[10px] font-medium text-amber-800">unidade não confirmada</div>}
        </div>
        <div className="whitespace-nowrap font-semibold text-slate-900">{item.emLitros ? "—" : <>{(item.saldoSacos || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} sacos</>}</div>
        <div className="whitespace-nowrap font-semibold text-slate-900" data-testid={item.emLitros ? `saldo-litros-${item.produto_id}` : undefined}>{item.emLitros ? `${formatDecimal(item.saldo)} L` : formatKg(item.saldo)}</div>
      </div>
    </div>);

}
