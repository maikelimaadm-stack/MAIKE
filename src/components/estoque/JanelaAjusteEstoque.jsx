import React, { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import B1Field from "@/components/cadastro/base1/B1Field";
import B1Janela from "@/components/cadastro/base1/B1Janela";
import { SecaoForm, AvisoGestao } from "@/components/gestao/GestaoFormParts";
import { useCelular } from "@/components/common/MobileSheet";
import { formatarCustoUnitario, formatarDia, formatarInstante, formatarQtd, formatarReais } from "@/lib/estoqueConsultaRegras";
import { MOTIVO_ACAO_MINIMO, chaveDeOperacao } from "@/lib/estoqueEntradasRegras";
import { ROTULO_STATUS_AJUSTE, ROTULO_TIPO_AJUSTE, SEM_DIFERENCA, formatarDiferenca, mensagemErroAjuste } from "@/lib/estoqueAjustesRegras";
import { detalharAjusteEstoque, editarAjusteEstoque, excluirAjusteEstoque } from "@/services/estoqueAjustesService";
import PreviaRecalculoExclusao from "@/components/estoque/PreviaRecalculoExclusao";

/** Chave do detalhe (prefixo `estoque`: o que invalida o estoque invalida o detalhe). */
export const chaveDetalheAjuste = (/** @type {string|null} */ empresaId, /** @type {string|null} */ id) => ["estoque", "ajuste", empresaId, id];

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

/** @param {{ titulo: string, testId: string, children: React.ReactNode }} props */
function Grupo({ titulo, testId, children }) {
  return (
    <div className="min-w-0" data-testid={testId}>
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
const ROTULO_EVENTO = /** @type {Record<string, string>} */ ({ CONFIRMACAO: "Lançado", EDICAO: "Editado", EXCLUSAO: "Excluído" });
const porUnidade = (/** @type {string} */ u) => (u === "L" ? "litro" : "kg");

/**
 * Detalhe de UM ajuste de inventário (D-PROD-272) numa janela só (680px; tela cheia no celular): número, data,
 * centros, observação, as linhas (saldo antes, contado, diferença, sobra/falta, custo, valor), os totais de sobras e
 * de faltas e o histórico. Abre pelo detalhe do movimento, em Movimentos, e logo depois de lançar. Com a ação
 * `ajuste`, duas ações DENTRO da mesma janela: "Editar observação" (só ela muda) e "Excluir ajuste" (pede o motivo;
 * D-PROD-273, fatia 5: com outro movimento do produto no depósito depois, o servidor recalcula o custo deles — a prévia
 * mostra antes de confirmar —; recusa se o saldo ficaria negativo ou se houver outra contagem depois).
 * @param {{ ajuste: { id: string, numero?: string } | null, empresaId: string|null, podeAjuste: boolean, onFechar: () => void }} props
 */
export default function JanelaAjusteEstoque({ ajuste, empresaId, podeAjuste, onFechar }) {
  const celular = useCelular();
  const queryClient = useQueryClient();
  const id = ajuste?.id ? String(ajuste.id) : null;
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
    queryKey: chaveDetalheAjuste(empresaId, id),
    queryFn: () => detalharAjusteEstoque(empresaId, /** @type {string} */ (id)),
    enabled: Boolean(empresaId && id),
    staleTime: 15 * 1000,
    refetchOnWindowFocus: false,
  });
  const d = /** @type {any} */ (consulta.data ?? null);
  const a = d ?? ajuste;
  const itens = Array.isArray(d?.itens) ? d.itens : [];
  const confirmado = d?.status === "CONFIRMADA";

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
      await editarAjusteEstoque(empresaId, { id: d.id, versao: d.versao }, {
        motivoEdicao: motivo.trim(),
        observacao: tamanho(observacao) ? observacao.trim() : null,
      });
      await atualizar();
      setModo("ver");
    } catch (falha) {
      setErro(mensagemErroAjuste(falha, "Não foi possível salvar a edição."));
    } finally {
      setEnviando(false);
    }
  };

  const confirmarExclusao = async () => {
    if (enviando || !d) return;
    if (tamanho(motivo) < MOTIVO_ACAO_MINIMO) return setErro(`Informe o motivo da exclusão (ao menos ${MOTIVO_ACAO_MINIMO} caracteres).`);
    const conteudo = `${d.id}|${d.versao}|${motivo.trim()}`;
    if (!operacao.current || operacao.current.conteudo !== conteudo) operacao.current = { conteudo, id: chaveDeOperacao("aju-exc") };
    setEnviando(true);
    setErro(null);
    try {
      await excluirAjusteEstoque(empresaId, { id: d.id, versao: d.versao }, { motivo: motivo.trim(), operationId: operacao.current.id });
      await atualizar();
      setModo("ver");
    } catch (falha) {
      setErro(mensagemErroAjuste(falha, "Não foi possível excluir o ajuste."));
    } finally {
      setEnviando(false);
    }
  };

  let rodape = null;
  if (modo === "editar") {
    rodape = (
      <>
        <button type="button" className="tb-btn" onClick={() => setModo("ver")} disabled={enviando}>Voltar</button>
        <button type="button" className="tb-btn tb-btn-green" onClick={salvarEdicao} disabled={enviando} data-testid="ajuste-salvar-edicao">
          {enviando ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
          {enviando ? "Salvando…" : "Salvar"}
        </button>
      </>
    );
  } else if (modo === "excluir") {
    rodape = (
      <>
        <button type="button" className="tb-btn" onClick={() => setModo("ver")} disabled={enviando}>Voltar</button>
        <button type="button" className="tb-btn tb-btn-red" onClick={confirmarExclusao} disabled={enviando} data-testid="ajuste-confirmar-exclusao">
          {enviando ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
          {enviando ? "Excluindo…" : "Excluir ajuste"}
        </button>
      </>
    );
  } else if (podeAjuste && confirmado) {
    rodape = (
      <>
        <button type="button" className="tb-btn" onClick={abrirEdicao} data-testid="ajuste-editar">Editar observação</button>
        <button type="button" className="tb-btn tb-btn-red" onClick={() => { setMotivo(""); setErro(null); setModo("excluir"); }} data-testid="ajuste-excluir">Excluir ajuste</button>
      </>
    );
  }

  const numero = a?.numero ? String(a.numero) : "";
  return (
    <B1Janela
      aberto={Boolean(ajuste)}
      onFechar={onFechar}
      podeFechar={!enviando}
      titulo={numero ? `Ajuste de inventário nº ${numero}` : "Ajuste de inventário"}
      testId="janela-ajuste-estoque"
      className={celular ? "b1-janela--tela-cheia" : ""}
      contentProps={{ className: celular ? "b1-janela__camada--tela-cheia" : "" }}
      rodape={rodape}
    >
      {a ? (
        <div className="min-w-0" data-testid="ajuste-detalhe">
          {d ? (
            <>
              <Grupo titulo="Ajuste" testId="ajuste-grupo-cabecalho">
                <Linha rotulo="Data" valor={formatarDia(d.data_ajuste)} testId="ajuste-detalhe-data" />
                <Linha rotulo="Situação" valor={ROTULO_STATUS_AJUSTE[/** @type {'CONFIRMADA'|'EXCLUIDA'} */ (d.status)] ?? d.status} testId="ajuste-detalhe-situacao" />
                <Linha rotulo="Centro de resultado" valor={d.centro_resultado_nome} testId="ajuste-detalhe-centro-resultado" />
                <Linha rotulo="Centro de custo" valor={d.centro_custo_nome} testId="ajuste-detalhe-centro-custo" />
                <Linha rotulo="Total das sobras" valor={formatarReais(d.valor_sobras)} testId="ajuste-detalhe-valor-sobras" />
                <Linha rotulo="Total das faltas" valor={formatarReais(d.valor_faltas)} testId="ajuste-detalhe-valor-faltas" />
                <Linha rotulo="Observação" valor={d.observacao} testId="ajuste-detalhe-observacao" />
              </Grupo>

              <Grupo titulo={itens.length > 1 ? "Produtos" : "Produto"} testId="ajuste-grupo-produtos">
                {itens.map((/** @type {any} */ i, /** @type {number} */ k) => (
                  <div key={i.id ?? `${i.ordem}-${k}`} className="min-w-0" data-testid={`ajuste-detalhe-item-${k}`}>
                    <Linha rotulo={i.produto_nome ?? "Produto"} valor={i.local_estoque_nome ?? "—"} />
                    <Linha rotulo="Saldo antes" valor={formatarQtd(i.saldo_anterior, i.unidade_estoque)} testId={`ajuste-detalhe-item-${k}-saldo`} />
                    <Linha
                      rotulo="Contado"
                      valor={`${formatarQtd(i.contado_estoque, i.unidade_estoque)}${i.unidade === "SACO" ? ` (${formatarQtd(i.quantidade_contada, "KG").replace(/ kg$/, "")} sacos)` : ""}`}
                      testId={`ajuste-detalhe-item-${k}-contado`}
                    />
                    <Linha
                      rotulo="Diferença"
                      valor={`${formatarDiferenca(String(i.diferenca ?? "0"), i.unidade_estoque)} · ${ROTULO_TIPO_AJUSTE[i.tipo] ?? i.tipo}`}
                      testId={`ajuste-detalhe-item-${k}-diferenca`}
                    />
                    {i.tipo !== SEM_DIFERENCA ? (
                      <>
                        <Linha
                          rotulo={i.custo_informado ? "Custo informado" : "Custo médio"}
                          valor={i.custo_unitario ? `${formatarCustoUnitario(i.custo_unitario)} por ${porUnidade(i.unidade_estoque)}` : ""}
                          testId={`ajuste-detalhe-item-${k}-custo`}
                        />
                        <Linha rotulo="Valor" valor={formatarReais(i.valor_total)} testId={`ajuste-detalhe-item-${k}-valor`} />
                      </>
                    ) : null}
                  </div>
                ))}
              </Grupo>

              {d.eventos?.length ? (
                <Grupo titulo="Histórico" testId="ajuste-grupo-historico">
                  {d.eventos.map((/** @type {any} */ v) => (
                    <Linha key={v.id} rotulo={`${ROTULO_EVENTO[v.tipo] ?? v.tipo} · ${formatarInstante(v.criado_em)}`} valor={v.motivo} />
                  ))}
                </Grupo>
              ) : null}
            </>
          ) : consulta.isLoading ? (
            <p role="status" className="mt-2 text-[13px] text-[var(--mg-text-2,#475569)]" data-testid="ajuste-carregando">
              Carregando ajuste…
            </p>
          ) : null}

          {consulta.isError ? (
            <p role="alert" className="mt-2 text-[13px] text-red-800" data-testid="ajuste-detalhe-erro">
              {mensagemErroAjuste(consulta.error, "Não foi possível abrir o detalhe do ajuste.")}{" "}
              <button type="button" className="underline" onClick={() => consulta.refetch()}>Tentar novamente</button>
            </p>
          ) : null}

          {modo === "editar" ? (
            <div className="mg-b1-form-grid grid grid-cols-12 gap-x-3 gap-y-2 mt-3" data-testid="ajuste-form-edicao">
              <SecaoForm titulo="Editar observação" />
              <AreaTexto label="Observação" value={observacao} onChange={setObservacao} testId="ajuste-edicao-observacao" />
              <AreaTexto label="Motivo da edição" value={motivo} onChange={setMotivo} required testId="ajuste-edicao-motivo" />
              <p className="col-span-12 text-[12px] text-[var(--mg-text-2,#475569)]">A contagem e os centros não mudam: para corrigir, exclua o ajuste e faça outra contagem.</p>
            </div>
          ) : null}

          {modo === "excluir" ? (
            <div className="mg-b1-form-grid grid grid-cols-12 gap-x-3 gap-y-2 mt-3" data-testid="ajuste-form-exclusao">
              <SecaoForm titulo="Excluir ajuste" />
              <p className="col-span-12 text-[13px]">
                O ajuste fica no histórico como excluído e as sobras e faltas dele saem do estoque. Se o produto teve outros movimentos no depósito depois dele, o custo médio deles é recalculado. Com outra contagem depois, exclua a mais nova primeiro.
              </p>
              <PreviaRecalculoExclusao empresaId={empresaId} movimentoIds={itens.map((/** @type {any} */ i) => i.movimentacao_estoque_id)} />
              <AreaTexto label="Motivo da exclusão" value={motivo} onChange={setMotivo} required testId="ajuste-exclusao-motivo" />
            </div>
          ) : null}

          {erro ? (
            <div className="mt-2" role="alert" data-testid="ajuste-acao-erro">
              <AvisoGestao>{erro}</AvisoGestao>
            </div>
          ) : null}
        </div>
      ) : null}
    </B1Janela>
  );
}
