import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, ChevronLeft, Pencil, Plus } from "lucide-react";
import { B1MenuAcoesDaLinha } from "@/components/cadastro/base1/B1AcoesDaLinha";
import { useCelular } from "@/components/common/MobileSheet";
import { AvisoGestao } from "@/components/gestao/GestaoFormParts";
import JanelaAbastecimentoDaArea from "@/components/lancamento-atividades/JanelaAbastecimentoDaArea";
import {
  DialogoCancelarLinha,
  JanelaLinhaMaoObra,
  JanelaLinhaMaquina,
  JanelaLinhaProduto,
  JanelaLinhaServico,
} from "@/components/lancamento-atividades/JanelasDaLinha";
import { BOTAO_PRIMARIO } from "@/components/patrimonio/DialogosAbastecimento";
import { useEmpresaRealSelecionadaId, useFusoDaFazenda } from "@/hooks/useLancamentoAtividadesSessao";
import { useAcoesTelaAbastecimento } from "@/hooks/usePatrimonioSessao";
import { QUERY_RAIZ_ABASTECIMENTOS } from "@/hooks/useFluxoAbastecimento";
import { STATUS_AREA, linhaDaAreaParaExibir, rotuloDaAreaDaAtividade, totaisDaArea } from "@/lib/atividadeAreasRegras";
import { chaveApontamentos } from "@/lib/atividadeApontamentoRegras";
import { REGISTRO_ABASTECIMENTO, REGISTRO_IMPLEMENTO, opcoesDeRegistro, registroDoDiaParaAbastecer } from "@/lib/atividadeFluxoCampo";
import { LINHA_ABASTECIMENTO, linhasDaArea, somaDasLinhas, textoCustoComPorHa, textoFeitaDePlanejada } from "@/lib/lancamentosDaAreaRegras";
import { LINHA_MAO_OBRA, LINHA_MAQUINA, LINHA_PRODUTO, LINHA_SERVICO, chaveTotais, formatarMoedaAtividade } from "@/lib/atividadeLinhasRegras";
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
 * A tela de uma área da atividade (D-PROD-252): o cabeçalho (a área, a atividade e "X de Y ha · R$ … (R$ … por ha)"), a fileira
 * de botões "+" e UMA tabela com tudo o que foi lançado ali — Ações · Tipo · Dia · Item · Quantidade · Valor (no celular:
 * Ações · Tipo · Valor · Quantidade · Item · Dia, que rola na horizontal) — com o total no rodapé. O implemento é texto da
 * linha da máquina ("com GR-01"); o abastecimento é uma linha como as outras (dia, máquina, litros, valor). O ⚡ da linha
 * edita e cancela (as janelas de linha de sempre); o abastecimento se cancela na tela Abastecimentos.
 *
 * Os botões abrem a janela do lançamento (`onLancar`, um nível só) ou a do abastecimento (a mesma janela, com a revisão
 * dentro). Os números do cabeçalho e o total vêm do servidor (`por_area` dos totais); sem eles, a soma das linhas.
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
 *   avisoRecado?: React.ReactNode,
 *   onLancar: (tipo: string, aba: 'lista'|'dados', areaId: string|null) => void,
 *   onGravouAbastecimento: (recado: { texto: string, areaId: string|null, nomeArea: string, nomeAtividade: string }) => void,
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
  avisoRecado = null,
  onLancar,
  onGravouAbastecimento,
  onAtividadeAtualizada,
  onVoltar,
}) {
  const celular = useCelular();
  const queryClient = useQueryClient();
  const empresaId = useEmpresaRealSelecionadaId();
  const { hoje } = useFusoDaFazenda(empresaId);
  const acoesAbastecimento = useAcoesTelaAbastecimento();
  const podeVerAbastecimento = acoesAbastecimento.ver === true;
  const podeAbastecer = podeVerAbastecimento && acoesAbastecimento.criar === true;
  const atividadeId = atividade?.id ? String(atividade.id) : null;
  const areaId = area?.id != null ? String(area.id) : null;
  const [avisoCombustivel, setAvisoCombustivel] = useState("");
  const [abastecendo, setAbastecendo] = useState(/** @type {{ apontamento: any } | null} */ (null));
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
  const l = area
    ? linhaDaAreaParaExibir(area, numeros)
    : linhaDaAreaParaExibir({ area_planejada: totais?.area_planejada ?? atividade?.area_planejada }, { area_executada: totais?.area_executada ?? atividade?.area_executada });
  const feita = textoFeitaDePlanejada(l);
  const custoTotal = numeros?.custo_total ?? totais?.custo_total ?? null;
  const custoPorHa = numeros?.custo_por_ha ?? totais?.custo_por_ha ?? null;
  const cabecalho = [feita && feita !== "—" ? feita : "", textoCustoComPorHa(custoTotal, custoPorHa)].filter(Boolean).join(" · ");
  // O total do rodapé: o do servidor (o mesmo do cabeçalho); sem ele, a soma das linhas mostradas.
  const totalTexto = formatarMoedaAtividade(custoTotal) || formatarMoedaAtividade(somaDasLinhas(linhas)) || (lendoTotais ? "…" : "—");

  const podeRegistrar = podeLancar && (!area || area.status === STATUS_AREA.EM_ANDAMENTO);
  const podeEditar = podeRegistrar && acoes?.editarApontamento === true;
  const podeCancelar = podeRegistrar && acoes?.cancelarApontamento === true;

  /** @param {string} id */
  const abrirRegistro = (id) => {
    if (id === REGISTRO_ABASTECIMENTO) {
      const registro = registroDoDiaParaAbastecer(apontamentos, areaId, hoje || "");
      if (!registro) {
        setAvisoCombustivel("Para registrar o abastecimento, registre antes uma máquina neste lugar.");
        return;
      }
      setAvisoCombustivel("");
      setAbastecendo({ apontamento: registro });
      return;
    }
    onLancar(id === REGISTRO_IMPLEMENTO ? LINHA_MAQUINA : id, "dados", areaId);
  };

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
    if (r.tipo === LINHA_ABASTECIMENTO || (!podeEditar && !podeCancelar)) return null;
    const rotulo = `${r.rotuloDoTipo} ${r.item}`;
    return (
      <B1MenuAcoesDaLinha
        rotulo={`Ações de ${rotulo}`}
        titulo={r.item}
        subtitulo={[r.rotuloDoTipo, r.diaTexto].join(" · ")}
        grupos={[
          podeEditar ? [{ key: "editar", label: "Editar", icon: <Pencil size={16} strokeWidth={1.75} />, onSelect: () => setEditando({ linha: r.linha, apontamento: r.apontamento, tipo: r.tipo, chave: Date.now() }) }] : [],
          podeCancelar ? [{ key: "cancelar", label: "Cancelar", icon: <Ban size={16} strokeWidth={1.75} />, danger: true, onSelect: () => setCancelando({ tipo: r.tipo, linha: r.linha, apontamento: r.apontamento }) }] : [],
        ]}
        testId={`linha-acoes-${r.id}`}
      />
    );
  };

  // As colunas, na ordem do computador e do celular (o dado principal — Valor — aparece sem rolar).
  const COLUNAS = [
    { id: "dia", rotulo: "Dia", numero: false, valor: (/** @type {any} */ r) => r.diaTexto },
    { id: "item", rotulo: "Item", numero: false, valor: (/** @type {any} */ r) => r.item },
    { id: "quantidade", rotulo: "Quantidade", numero: true, valor: (/** @type {any} */ r) => r.quantidade },
    { id: "valor", rotulo: "Valor", numero: true, valor: (/** @type {any} */ r) => r.valorTexto },
  ];
  const ORDEM_CELULAR = ["valor", "quantidade", "item", "dia"];
  const colunas = celular ? ORDEM_CELULAR.map((id) => /** @type {any} */ (COLUNAS.find((c) => c.id === id))) : COLUNAS;

  const botoes = podeRegistrar ? opcoesDeRegistro(flags, { abastecimento: podeAbastecer }) : [];

  /** @type {any} */
  const JanelaDeEdicao = editando ? JANELA_DO_TIPO[/** @type {keyof typeof JANELA_DO_TIPO} */ (editando.tipo)] : null;
  const tabela = (
    <div className="b1-tipo-tabela__rolagem">
      <table className="b1-tipo-tabela" data-testid="area-lancamentos-tabela">
        <thead>
          <tr>
            <th scope="col" className="b1-tipo-tabela__acoes">
              Ações
            </th>
            <th scope="col">Tipo</th>
            {colunas.map((c) => (
              <th key={c.id} scope="col" className={c.numero ? "is-numero" : undefined}>
                {c.rotulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((r) => (
            <tr key={r.id} data-testid={`lancamento-${r.id}`} data-tipo={r.tipo}>
              <td className="b1-tipo-tabela__acoes">{menuDaLinha(r)}</td>
              <td data-testid={`lancamento-${r.id}-tipo`}>{r.rotuloDoTipo}</td>
              {colunas.map((c) => (
                <td key={c.id} className={c.numero ? "is-numero" : undefined} data-testid={`lancamento-${r.id}-${c.id}`}>
                  {c.valor(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr data-testid="area-lancamentos-total">
            <td />
            <td colSpan={celular ? 1 : 3}>Total</td>
            {celular ? (
              <>
                <td className="is-numero" data-testid="area-lancamentos-total-valor">
                  {totalTexto}
                </td>
                <td colSpan={3} />
              </>
            ) : (
              <>
                <td />
                <td className="is-numero" data-testid="area-lancamentos-total-valor">
                  {totalTexto}
                </td>
              </>
            )}
          </tr>
        </tfoot>
      </table>
    </div>
  );

  return (
    <section className="min-w-0" data-testid="detalhe-area">
      {onVoltar ? (
        <button type="button" className="mb-2 inline-flex min-h-11 items-center gap-1 text-[13px] font-semibold text-emerald-800" onClick={onVoltar} data-testid="detalhe-area-voltar">
          <ChevronLeft className="h-4 w-4" aria-hidden /> Áreas
        </button>
      ) : null}
      {avisoRecado}
      <h2 className="text-lg font-semibold" data-testid="detalhe-area-nome">
        {nome}
      </h2>
      <p className="text-[13px] text-[var(--mg-text-2,#475569)]" data-testid="detalhe-area-atividade">
        {String(atividade?.nome ?? "")}
      </p>
      <p className="mb-3 text-[13px] font-medium" data-testid="detalhe-area-resumo">
        {cabecalho || (lendoTotais ? "…" : "—")}
      </p>
      {botoes.length ? (
        <div className="mb-3 flex flex-wrap gap-2" data-testid="escolher-registro">
          {botoes.map((o) => (
            <button key={o.id} type="button" className={BOTAO_PRIMARIO} onClick={() => abrirRegistro(o.id)} data-testid={`escolher-${o.id}`}>
              <Plus className="h-4 w-4" aria-hidden /> {o.rotulo}
            </button>
          ))}
        </div>
      ) : null}
      {avisoCombustivel ? <AvisoGestao testId="aviso-abastecimento">{avisoCombustivel}</AvisoGestao> : null}
      {area && area.status === STATUS_AREA.PLANEJADA ? (
        <AvisoGestao tone="blue" testId="detalhe-area-a-iniciar">
          Esta área ainda não começou. Inicie a área pelo ⚡ da tabela de áreas para lançar nela.
        </AvisoGestao>
      ) : null}
      {lendoLinhas && linhas.length === 0 ? <p className="text-[13px] text-[var(--mg-text-2,#475569)]">Lendo…</p> : null}
      {tabela}
      {linhas.length === 0 && !lendoLinhas ? (
        <p className="mt-2 text-[13px] text-[var(--mg-text-2,#475569)]" data-testid="area-lancamentos-vazio">
          Nada registrado aqui ainda.
        </p>
      ) : null}
      {abastecendo ? (
        <JanelaAbastecimentoDaArea
          atividade={atividade}
          apontamento={abastecendo.apontamento}
          nomeArea={nome}
          onFechar={() => setAbastecendo(null)}
          onGravou={(texto) => {
            releer();
            onGravouAbastecimento({ texto, areaId, nomeArea: nome, nomeAtividade: String(atividade?.nome ?? "") });
          }}
        />
      ) : null}
      {editando && JanelaDeEdicao ? (
        <JanelaDeEdicao
          key={editando.chave}
          atividade={atividade}
          apontamento={editando.apontamento}
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
