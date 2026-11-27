import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, ChevronLeft, Fuel, Pencil } from "lucide-react";
import { B1MenuAcoesDaLinha } from "@/components/cadastro/base1/B1AcoesDaLinha";
import { useCelular } from "@/components/common/MobileSheet";
import TabelaBase1 from "@/components/lancamento-atividades/TabelaBase1";
import { AvisoGestao } from "@/components/gestao/GestaoFormParts";
import JanelaAbastecimentoDaArea from "@/components/lancamento-atividades/JanelaAbastecimentoDaArea";
import {
  DialogoCancelarLinha,
  JanelaLinhaMaoObra,
  JanelaLinhaMaquina,
  JanelaLinhaProduto,
  JanelaLinhaServico,
} from "@/components/lancamento-atividades/JanelasDaLinha";
import { useEmpresaRealSelecionadaId } from "@/hooks/useLancamentoAtividadesSessao";
import { useAcoesTelaAbastecimento } from "@/hooks/usePatrimonioSessao";
import { QUERY_RAIZ_ABASTECIMENTOS } from "@/hooks/useFluxoAbastecimento";
import { STATUS_AREA, rotuloDaAreaDaAtividade, totaisDaArea } from "@/lib/atividadeAreasRegras";
import { chaveApontamentos } from "@/lib/atividadeApontamentoRegras";
import { bemParaAbastecer } from "@/lib/atividadeFluxoCampo";
import { LINHA_ABASTECIMENTO, linhasDaArea, somaDasLinhas } from "@/lib/lancamentosDaAreaRegras";
import { LINHA_MAO_OBRA, LINHA_MAQUINA, LINHA_PRODUTO, LINHA_SERVICO, chaveTotais, formatarMoedaAtividade, rotuloDaMaquinaDaLinha } from "@/lib/atividadeLinhasRegras";
import { rotuloDaArea } from "@/lib/lancamentoAtividadesRegras";
import { notifySuccess } from "@/lib/maikeNotify";
import { listarAbastecimentosPagina } from "@/services/abastecimentoService";
import { itensDaLista } from "@/lib/atividadeApontamentoRegras";

// Os botões são os de sempre do app (os mesmos dos formulários de lançamento): nada de botão gigante só para celular.
const LIMITE_ABASTECIMENTOS = 100;

/** O ⚡ de uma linha: Editar e Cancelar. O nome de cada tipo: a primeira coluna da linha. */
const JANELA_DO_TIPO = Object.freeze({
  [LINHA_MAQUINA]: JanelaLinhaMaquina,
  [LINHA_PRODUTO]: JanelaLinhaProduto,
  [LINHA_MAO_OBRA]: JanelaLinhaMaoObra,
  [LINHA_SERVICO]: JanelaLinhaServico,
});

/**
 * A tela de uma área da atividade (D-PROD-252, emendas 1 e 2): o "‹ Áreas" com o nome da área e o da atividade e UMA
 * tabela Base1 (`TabelaBase1`, a grade da lista, sem cartão) com tudo o que foi lançado ali — Tipo · Dia ·
 * Item · Quantidade · Valor e o ⚡ (no celular: Tipo · Valor · Quantidade · Item · Dia) — com o total no `<tfoot>`. O
 * implemento é texto da linha da máquina ("com GR-01"); o abastecimento é uma linha como as outras (dia, máquina, litros,
 * valor). O ⚡ da linha edita e cancela (as janelas de linha de sempre); o abastecimento se cancela na tela Abastecimentos.
 * Gravou o abastecimento: o aviso é o toast do app.
 *
 * Sem botões "+" por tipo: lançar é pelo Diário das atividades (a opção Máquina da frente, D-PROD-365). O abastecimento NÃO tem botão aqui (D-PROD-254,
 * emenda 1): é da máquina — o ⚡ da linha da máquina tem "Abastecer" (a janela do abastecimento, com a máquina escolhida
 * e a revisão dentro) e a janela da máquina tem "Salvar e abastecer". O total (um só, no rodapé) vem do servidor (`por_area` dos totais); sem ele, a soma das linhas. Os hectares e o
 * R$/ha ficam na tabela de áreas e no Resumo das áreas, não aqui.
 *
 * @param {{
 *   atividade: any,
 *   area: any|null,
 *   totais: any,
 *   lendoTotais: boolean,
 *   lendoLinhas: boolean,
 *   apontamentos: any[],
 *   acoes: Record<string, any>,
 *   podeLancar: boolean,
 *   flags: { permiteProduto?: boolean, permiteImplemento?: boolean, permiteMaoObra?: boolean, permiteServico?: boolean },
 *   escopo: string,
 *   onAtividadeAtualizada: (atividade: any) => void,
 *   onVoltar: (() => void) | null,
 * }} props `area`: a área da atividade (null na atividade antiga, sem áreas). `podeLancar`: a atividade aberta com a permissão
 *   de lançar. `onVoltar`: o "‹ Áreas" (null sem ele).
 */
export default function LancamentosDaArea({
  atividade,
  area,
  totais,
  lendoTotais,
  lendoLinhas,
  apontamentos,
  acoes,
  podeLancar,
  flags,
  escopo,
  onAtividadeAtualizada,
  onVoltar,
}) {
  const celular = useCelular();
  const queryClient = useQueryClient();
  const empresaId = useEmpresaRealSelecionadaId();
  const acoesAbastecimento = useAcoesTelaAbastecimento();
  const podeVerAbastecimento = acoesAbastecimento.ver === true;
  const podeAbastecer = podeVerAbastecimento && acoesAbastecimento.criar === true;
  const atividadeId = atividade?.id ? String(atividade.id) : null;
  const areaId = area?.id != null ? String(area.id) : null;
  const [abastecendo, setAbastecendo] = useState(/** @type {{ apontamento: any, bem: ReturnType<typeof bemParaAbastecer> } | null} */ (null));
  const [editando, setEditando] = useState(/** @type {{ linha: any, apontamento: any, tipo: string, chave: number } | null} */ (null));
  const [cancelando, setCancelando] = useState(/** @type {{ tipo: any, linha: any, apontamento: any } | null} */ (null));

  const abastecimentosQuery = useQuery({
    queryKey: [QUERY_RAIZ_ABASTECIMENTOS, "atividade", empresaId ?? null, atividadeId],
    queryFn: () => listarAbastecimentosPagina(empresaId, { atividadeId, limit: LIMITE_ABASTECIMENTOS }),
    enabled: Boolean(empresaId && atividadeId && podeVerAbastecimento),
    staleTime: 15 * 1000,
  });
  const abastecimentos = useMemo(() => itensDaLista(abastecimentosQuery.data), [abastecimentosQuery.data]);
  const linhas = useMemo(() => linhasDaArea({ apontamentos, abastecimentos, areaId }), [apontamentos, abastecimentos, areaId]);

  const nome = area ? rotuloDaAreaDaAtividade(area) : rotuloDaArea(atividade?.area) || "Atividade";
  const numeros = areaId ? totaisDaArea(totais, areaId) : null;
  // Atividade antiga, sem áreas: o feito e o planejado são os da atividade.
  const custoTotal = numeros?.custo_total ?? totais?.custo_total ?? null;
  // O total do rodapé (o único da tela): o do servidor; sem ele, a soma das linhas mostradas.
  const totalTexto = formatarMoedaAtividade(custoTotal) || formatarMoedaAtividade(somaDasLinhas(linhas)) || (lendoTotais ? "…" : "—");

  const podeRegistrar = podeLancar && (!area || area.status === STATUS_AREA.EM_ANDAMENTO);
  const podeEditar = podeRegistrar && acoes?.editarApontamento === true;
  const podeCancelar = podeRegistrar && acoes?.cancelarApontamento === true;

  const releer = () => {
    queryClient.invalidateQueries({ queryKey: chaveApontamentos(empresaId, atividadeId) });
    queryClient.invalidateQueries({ queryKey: chaveTotais(empresaId, atividadeId) });
    queryClient.invalidateQueries({ queryKey: [QUERY_RAIZ_ABASTECIMENTOS] });
    onAtividadeAtualizada(null);
  };
  /** Editou ou cancelou uma linha: lista, totais e a atividade se relêem. @param {{ atividade: any }} r @param {string} [textoDoServidor] */
  const aposEscrita = (r, textoDoServidor) => {
    if (textoDoServidor) notifySuccess("Sucesso", textoDoServidor);
    releer();
    if (r?.atividade?.id) onAtividadeAtualizada(r.atividade);
  };

  /** O ⚡ de uma linha (só as de lançamento; o abastecimento não tem). @param {import("@/lib/lancamentosDaAreaRegras").LinhaDaArea} r */
  const menuDaLinha = (r) => {
    // O abastecimento se cancela na tela Abastecimentos; o "Abastecer" é só da linha da máquina.
    const abastecer = r.tipo === LINHA_MAQUINA && podeRegistrar && podeAbastecer;
    if (r.tipo === LINHA_ABASTECIMENTO || (!podeEditar && !podeCancelar && !abastecer)) return null;
    const rotulo = `${r.rotuloDoTipo} ${r.item}`;
    return (
      <B1MenuAcoesDaLinha
        rotulo={`Ações de ${rotulo}`}
        titulo={r.item}
        subtitulo={[r.rotuloDoTipo, r.diaTexto].join(" · ")}
        grupos={[
          abastecer
            ? [
                {
                  key: "abastecer",
                  label: "Abastecer",
                  icon: <Fuel size={16} strokeWidth={1.75} />,
                  onSelect: () =>
                    setAbastecendo({
                      apontamento: r.apontamento,
                      bem: bemParaAbastecer({ id: r.linha?.bem_id, rotulo: rotuloDaMaquinaDaLinha(r.linha), medidorTipo: r.linha?.medidor_tipo }),
                    }),
                },
              ]
            : [],
          podeEditar ? [{ key: "editar", label: "Editar", icon: <Pencil size={16} strokeWidth={1.75} />, onSelect: () => setEditando({ linha: r.linha, apontamento: r.apontamento, tipo: r.tipo, chave: Date.now() }) }] : [],
          podeCancelar ? [{ key: "cancelar", label: "Cancelar", icon: <Ban size={16} strokeWidth={1.75} />, danger: true, onSelect: () => setCancelando({ tipo: r.tipo, linha: r.linha, apontamento: r.apontamento }) }] : [],
        ]}
        testId={`linha-acoes-${r.id}`}
      />
    );
  };

  // As colunas, na ordem do computador e do celular (o dado principal — Valor — aparece sem rolar).
  const COLUNAS = [
    { id: "tipo", label: "Tipo", sortable: true, width: 130 },
    { id: "dia", label: "Dia", sortable: true, width: 110 },
    { id: "item", label: "Item", sortable: true, width: 280 },
    { id: "quantidade", label: "Quantidade", sortable: true, align: "right", width: 130 },
    { id: "valor", label: "Valor", sortable: true, align: "right", width: 130 },
  ];
  const ORDEM_CELULAR = ["tipo", "valor", "quantidade", "item", "dia"];
  const colunas = celular ? ORDEM_CELULAR.map((id) => /** @type {any} */ (COLUNAS.find((c) => c.id === id))) : COLUNAS;
  /** @type {Record<string, (r: any) => string>} */
  const TEXTO = { tipo: (r) => r.rotuloDoTipo, dia: (r) => r.diaTexto, item: (r) => r.item, quantidade: (r) => r.quantidade, valor: (r) => r.valorTexto };
  // Dia e valor se ordenam pelo valor canônico (a data ISO e o decimal), não pelo texto "13/11/2026" / "R$ 1.200,00".
  const comparar = (/** @type {any} */ a, /** @type {any} */ b, /** @type {string} */ coluna) => {
    if (coluna === "dia") return String(a.dia).localeCompare(String(b.dia));
    if (coluna === "valor") return Number(a.valor ?? Number.NEGATIVE_INFINITY) - Number(b.valor ?? Number.NEGATIVE_INFINITY);
    return undefined;
  };

  /** @type {any} */
  const JanelaDeEdicao = editando ? JANELA_DO_TIPO[/** @type {keyof typeof JANELA_DO_TIPO} */ (editando.tipo)] : null;
  const tabela = (
    <TabelaBase1
      testId="area-lancamentos-tabela"
      chave="lancamento-atividade-area-lancamentos"
      colunas={colunas}
      linhas={linhas}
      valorDoCampo={(r, id) => TEXTO[id](r)}
      renderCelula={(r, id) => <span data-testid={`lancamento-${r.id}-${id}`}>{TEXTO[id](r)}</span>}
      renderAcoes={podeEditar || podeCancelar || (podeRegistrar && podeAbastecer) ? menuDaLinha : undefined}
      comparar={comparar}
      carregando={lendoLinhas && linhas.length === 0}
      vazio="Nada registrado aqui ainda."
      rodape={(ids, comSelecao) => (
        <tr data-testid="area-lancamentos-total">
          {comSelecao ? <td /> : null}
          {ids.map((id) => (
            <td key={id} className={id === "valor" ? "text-right tabular-nums" : undefined}>
              {id === "tipo" ? "Total" : id === "valor" ? <span data-testid="area-lancamentos-total-valor">{totalTexto}</span> : null}
            </td>
          ))}
        </tr>
      )}
    />
  );

  return (
    <section className="b1-tabela-tela" data-testid="detalhe-area">
      <div className="b1-tabela-tela__cab">
        {onVoltar ? (
          <button type="button" className="b1-tabela-tela__voltar" onClick={onVoltar} data-testid="detalhe-area-voltar">
            <ChevronLeft className="h-4 w-4" aria-hidden /> Áreas
          </button>
        ) : null}
        <h2 className="b1-tabela-tela__titulo" data-testid="detalhe-area-nome">
          {nome}
        </h2>
        <span className="b1-tabela-tela__sub" data-testid="detalhe-area-atividade">
          {String(atividade?.nome ?? "")}
        </span>
      </div>
      {area && area.status === STATUS_AREA.PLANEJADA ? (
        <AvisoGestao tone="blue" testId="detalhe-area-a-iniciar">
          Esta área ainda não começou. Inicie a área pelo ⚡ da tabela de áreas para lançar nela.
        </AvisoGestao>
      ) : null}
      {tabela}
      {abastecendo ? (
        <JanelaAbastecimentoDaArea
          atividade={atividade}
          apontamento={abastecendo.apontamento}
          bem={abastecendo.bem}
          nomeArea={nome}
          onFechar={() => setAbastecendo(null)}
          onGravou={(texto) => {
            releer();
            notifySuccess("Sucesso", texto);
          }}
        />
      ) : null}
      {editando && JanelaDeEdicao ? (
        <JanelaDeEdicao
          key={editando.chave}
          atividade={atividade}
          apontamento={editando.apontamento}
          atividadeAreaId={areaId}
          linha={editando.linha}
          escopo={escopo}
          permiteImplemento={flags?.permiteImplemento === true}
          onSalvo={(/** @type {any} */ r, /** @type {string} */ t) => {
            setEditando(null);
            aposEscrita(r, t);
          }}
          onCancelar={() => setEditando(null)}
          onMudou={releer}
        />
      ) : null}
      {cancelando ? (
        <DialogoCancelarLinha
          key={`cancelar-linha-${cancelando.linha.id}`}
          atividade={atividade}
          cancelando={cancelando}
          escopo={escopo}
          onCancelada={(r, t) => {
            setCancelando(null);
            aposEscrita(r, t);
          }}
          onFechar={() => setCancelando(null)}
          onMudou={releer}
        />
      ) : null}
    </section>
  );
}
