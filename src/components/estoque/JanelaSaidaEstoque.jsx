import React, { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import B1Field from "@/components/cadastro/base1/B1Field";
import B1Janela from "@/components/cadastro/base1/B1Janela";
import { SecaoForm, AvisoGestao } from "@/components/gestao/GestaoFormParts";
import { useCelular } from "@/components/common/MobileSheet";
import { formatarCustoUnitario, formatarDia, formatarInstante, formatarQtd, formatarReais } from "@/lib/estoqueConsultaRegras";
import { MOTIVO_ACAO_MINIMO, chaveDeOperacao, rotuloDoEventoEstoque } from "@/lib/estoqueEntradasRegras";
import { ROTULO_STATUS_SAIDA, mensagemErroSaida, quantidadeDaLinhaSaida } from "@/lib/estoqueSaidasRegras";
import { detalharSaidaEstoque, editarSaidaEstoque, excluirSaidaEstoque } from "@/services/estoqueSaidasService";
import PreviaRecalculoExclusao from "@/components/estoque/PreviaRecalculoExclusao";

/** Chave do detalhe (prefixo `estoque`: o que invalida o estoque invalida o detalhe). */
export const chaveDetalheSaida = (/** @type {string|null} */ empresaId, /** @type {string|null} */ id) => ["estoque", "saida", empresaId, id];

/** @param {{ rotulo: string, valor: React.ReactNode, testId?: string }} props */
function Linha({ rotulo, valor, testId = undefined }) {
  if (valor === null || valor === undefined || valor === "") return null;
  return (
    <div className="b1-janela__linha">
      <dt>{rotulo}</dt>
      <dd data-testid={testId}>{valor}</dd>
    </div>
  );
}

/** @param {{ titulo: string, children: React.ReactNode }} props */
function Grupo({ titulo, children }) {
  return (
    <div className="min-w-0" data-testid={`saida-grupo-${titulo.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
      <div className="mg-b1-form-grid grid grid-cols-12">
        <SecaoForm titulo={titulo} />
      </div>
      <dl className="min-w-0">{children}</dl>
    </div>
  );
}

/** @param {{ label: string, value: string, onChange: (v: string) => void, required?: boolean, testId?: string }} props */
function AreaTexto({ label, value, onChange, required = false, testId = undefined }) {
  return (
    <B1Field label={label} required={required} span={12} hasValue={Boolean(String(value ?? "").trim())}>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} maxLength={500} rows={2} data-testid={testId} className="mg-input min-w-0 w-full normal-case" />
    </B1Field>
  );
}

const tamanho = (/** @type {string} */ t) => [...String(t ?? "").trim()].length;

/**
 * Detalhe de UMA saída manual (D-PROD-264) numa janela só (680px; tela cheia no celular): número, data, motivo,
 * centros, observação, as linhas (quantidade baixada, custo médio e valor) e o histórico. Abre pelo detalhe do
 * movimento, em Movimentos, e logo depois de lançar. Com a ação `saida`, duas ações DENTRO da mesma janela (sem popup
 * sobre popup): "Editar observação" (só ela muda) e "Excluir saída" (pede o motivo; estorno integral pelo mesmo
 * valor; D-PROD-273: com outro movimento do produto naquele depósito depois, o servidor recalcula o custo deles e a
 * janela mostra a prévia antes de confirmar).
 * D-PROD-271: e "Editar" (edição completa), que fecha este detalhe e abre a janela "Novo movimento" em modo edição
 * (`onEditar`, com a versão vigente); sem `onEditar` o botão não aparece. O histórico diz "Editado (lançamentos
 * refeitos)" na edição com substituição.
 * @param {{ saida: { id: string, numero?: string } | null, empresaId: string|null, podeSaida: boolean, onFechar: () => void, onEditar?: (detalhe: any) => void }} props
 */
export default function JanelaSaidaEstoque({ saida, empresaId, podeSaida, onFechar, onEditar = undefined }) {
  const celular = useCelular();
  const queryClient = useQueryClient();
  const id = saida?.id ? String(saida.id) : null;
  const [modo, setModo] = useState(/** @type {'ver'|'editar'|'excluir'} */ ("ver"));
  const [motivo, setMotivo] = useState("");
  const [observacao, setObservacao] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState(/** @type {string|null} */ (null));
  const operacao = useRef(/** @type {{ conteudo: string, id: string } | null} */ (null));

  useEffect(() => {
    setModo("ver");
    setMotivo("");
    setErro(null);
    operacao.current = null;
  }, [id]);

  const consulta = useQuery({
    queryKey: chaveDetalheSaida(empresaId, id),
    queryFn: () => detalharSaidaEstoque(empresaId, /** @type {string} */ (id)),
    enabled: Boolean(empresaId && id),
    staleTime: 15 * 1000,
    refetchOnWindowFocus: false,
  });
  const d = /** @type {any} */ (consulta.data ?? null);
  const s = d ?? saida;
  const itens = Array.isArray(d?.itens) ? d.itens : [];
  const confirmada = d?.status === "CONFIRMADA";

  const atualizar = async () => {
    await queryClient.invalidateQueries({ queryKey: ["estoque"] });
  };

  const abrirEdicao = () => {
    setObservacao(d?.observacao ?? "");
    setMotivo("");
    setErro(null);
    setModo("editar");
  };

  const salvarEdicao = async () => {
    if (enviando || !d) return;
    if (tamanho(motivo) < MOTIVO_ACAO_MINIMO) return setErro(`Informe o motivo da edição (ao menos ${MOTIVO_ACAO_MINIMO} caracteres).`);
    setEnviando(true);
    setErro(null);
    try {
      await editarSaidaEstoque(empresaId, { id: d.id, versao: d.versao }, {
        motivoEdicao: motivo.trim(),
        observacao: tamanho(observacao) ? observacao.trim() : null,
      });
      await atualizar();
      setModo("ver");
    } catch (falha) {
      setErro(mensagemErroSaida(falha, "Não foi possível salvar a edição."));
    } finally {
      setEnviando(false);
    }
  };

  const confirmarExclusao = async () => {
    if (enviando || !d) return;
    if (tamanho(motivo) < MOTIVO_ACAO_MINIMO) return setErro(`Informe o motivo da exclusão (ao menos ${MOTIVO_ACAO_MINIMO} caracteres).`);
    const conteudo = `${d.id}|${d.versao}|${motivo.trim()}`;
    if (!operacao.current || operacao.current.conteudo !== conteudo) operacao.current = { conteudo, id: chaveDeOperacao("sai-exc") };
    setEnviando(true);
    setErro(null);
    try {
      await excluirSaidaEstoque(empresaId, { id: d.id, versao: d.versao }, { motivo: motivo.trim(), operationId: operacao.current.id });
      await atualizar();
      setModo("ver");
    } catch (falha) {
      setErro(mensagemErroSaida(falha, "Não foi possível excluir a saída."));
    } finally {
      setEnviando(false);
    }
  };

  let rodape = null;
  if (modo === "editar") {
    rodape = (
      <>
        <button type="button" className="tb-btn" onClick={() => setModo("ver")} disabled={enviando}>Voltar</button>
        <button type="button" className="tb-btn tb-btn-green" onClick={salvarEdicao} disabled={enviando} data-testid="saida-salvar-edicao">
          {enviando ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
          {enviando ? "Salvando…" : "Salvar"}
        </button>
      </>
    );
  } else if (modo === "excluir") {
    rodape = (
      <>
        <button type="button" className="tb-btn" onClick={() => setModo("ver")} disabled={enviando}>Voltar</button>
        <button type="button" className="tb-btn tb-btn-red" onClick={confirmarExclusao} disabled={enviando} data-testid="saida-confirmar-exclusao">
          {enviando ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
          {enviando ? "Excluindo…" : "Excluir saída"}
        </button>
      </>
    );
  } else if (podeSaida && confirmada) {
    rodape = (
      <>
        <button type="button" className="tb-btn" onClick={abrirEdicao} data-testid="saida-editar">Editar observação</button>
        {onEditar ? (
          <button type="button" className="tb-btn" onClick={() => onEditar(d)} data-testid="saida-editar-completo">Editar</button>
        ) : null}
        <button type="button" className="tb-btn tb-btn-red" onClick={() => { setMotivo(""); setErro(null); setModo("excluir"); }} data-testid="saida-excluir">Excluir saída</button>
      </>
    );
  }

  const numero = s?.numero ? String(s.numero) : "";
  return (
    <B1Janela
      aberto={Boolean(saida)}
      onFechar={onFechar}
      podeFechar={!enviando}
      titulo={numero ? `Saída nº ${numero}` : "Saída"}
      testId="janela-saida-estoque"
      className={celular ? "b1-janela--tela-cheia" : ""}
      contentProps={{ className: celular ? "b1-janela__camada--tela-cheia" : "" }}
      rodape={rodape}
    >
      {s ? (
        <div className="min-w-0" data-testid="saida-detalhe">
          {d ? (
            <>
              <Grupo titulo="Saída">
                <Linha rotulo="Data" valor={formatarDia(d.data_saida)} testId="saida-detalhe-data" />
                <Linha rotulo="Motivo" valor={d.motivo_nome} testId="saida-detalhe-motivo" />
                <Linha rotulo="Situação" valor={ROTULO_STATUS_SAIDA[/** @type {'CONFIRMADA'|'EXCLUIDA'} */ (d.status)] ?? d.status} testId="saida-detalhe-situacao" />
                <Linha rotulo="Centro de resultado" valor={d.centro_resultado_nome} testId="saida-detalhe-centro-resultado" />
                <Linha rotulo="Centro de custo" valor={d.centro_custo_nome} testId="saida-detalhe-centro-custo" />
                <Linha rotulo="Valor total (custo médio)" valor={formatarReais(d.valor_total)} testId="saida-detalhe-valor-total" />
                <Linha rotulo="Observação" valor={d.observacao} testId="saida-detalhe-observacao" />
              </Grupo>

              <Grupo titulo={itens.length > 1 ? "Produtos" : "Produto"}>
                {itens.map((/** @type {any} */ i, /** @type {number} */ k) => (
                  <React.Fragment key={i.id ?? `${i.ordem}-${k}`}>
                    <Linha rotulo={i.produto_nome ?? "Produto"} valor={`${quantidadeDaLinhaSaida(i)} de ${i.local_estoque_nome ?? "—"}`} testId="saida-detalhe-item" />
                    {i.unidade === "SACO" ? <Linha rotulo="Informado em" valor={`${formatarQtd(i.quantidade, "KG").replace(/ kg$/, "")} sacos de ${formatarQtd(i.fator_kg, "KG")}`} /> : null}
                    <Linha rotulo="Custo médio" valor={i.custo_unitario ? `${formatarCustoUnitario(i.custo_unitario)} por ${i.unidade_estoque === "L" ? "litro" : "kg"}` : ""} testId="saida-detalhe-custo" />
                    <Linha rotulo="Valor" valor={formatarReais(i.valor_total)} testId="saida-detalhe-valor" />
                  </React.Fragment>
                ))}
              </Grupo>

              {d.eventos?.length ? (
                <Grupo titulo="Histórico">
                  {d.eventos.map((/** @type {any} */ v) => (
                    <Linha key={v.id} rotulo={`${rotuloDoEventoEstoque(v)} · ${formatarInstante(v.criado_em)}`} valor={v.motivo} />
                  ))}
                </Grupo>
              ) : null}
            </>
          ) : consulta.isLoading ? (
            <p role="status" className="mt-2 text-[13px] text-[var(--mg-text-2,#475569)]" data-testid="saida-carregando">
              Carregando saída…
            </p>
          ) : null}

          {consulta.isError ? (
            <p role="alert" className="mt-2 text-[13px] text-red-800" data-testid="saida-detalhe-erro">
              {mensagemErroSaida(consulta.error, "Não foi possível abrir o detalhe da saída.")}{" "}
              <button type="button" className="underline" onClick={() => consulta.refetch()}>Tentar novamente</button>
            </p>
          ) : null}

          {modo === "editar" ? (
            <div className="mg-b1-form-grid grid grid-cols-12 gap-x-3 gap-y-2 mt-3" data-testid="saida-form-edicao">
              <SecaoForm titulo="Editar observação" />
              <AreaTexto label="Observação" value={observacao} onChange={setObservacao} testId="saida-edicao-observacao" />
              <AreaTexto label="Motivo da edição" value={motivo} onChange={setMotivo} required testId="saida-edicao-motivo" />
              <p className="col-span-12 text-[12px] text-[var(--mg-text-2,#475569)]">Aqui só muda a observação. Para mudar o motivo, a data, os centros ou os produtos, use “Editar”.</p>
            </div>
          ) : null}

          {modo === "excluir" ? (
            <div className="mg-b1-form-grid grid grid-cols-12 gap-x-3 gap-y-2 mt-3" data-testid="saida-form-exclusao">
              <SecaoForm titulo="Excluir saída" />
              <p className="col-span-12 text-[13px]">
                A saída some das listas (fica guardada como excluída) e o produto volta ao depósito. Se houve outros movimentos do produto depois dela, o custo médio deles é recalculado.
              </p>
              <PreviaRecalculoExclusao empresaId={empresaId} movimentoIds={itens.map((/** @type {any} */ i) => i.movimentacao_estoque_id)} />
              <AreaTexto label="Motivo da exclusão" value={motivo} onChange={setMotivo} required testId="saida-exclusao-motivo" />
            </div>
          ) : null}

          {erro ? (
            <div className="mt-2" role="alert" data-testid="saida-acao-erro">
              <AvisoGestao>{erro}</AvisoGestao>
            </div>
          ) : null}
        </div>
      ) : null}
    </B1Janela>
  );
}
