import React, { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import B1Field from "@/components/cadastro/base1/B1Field";
import B1Janela from "@/components/cadastro/base1/B1Janela";
import { SecaoForm, AvisoGestao } from "@/components/gestao/GestaoFormParts";
import { useCelular } from "@/components/common/MobileSheet";
import { getApiErrorMessage } from "@/apis/_core/ApiError";
import { formatarCustoUnitario, formatarDia, formatarInstante, formatarQtd, formatarReais } from "@/lib/estoqueConsultaRegras";
import {
  MOTIVO_ACAO_MINIMO,
  ROTULO_STATUS_ENTRADA,
  chaveDeOperacao,
  formatarValidade,
  mensagemErroEntrada,
  rotuloDoEventoEstoque,
  rotuloDoMotivo,
  valorTotalDaEntrada,
  versoesDaEntrada,
} from "@/lib/estoqueEntradasRegras";
import { detalharEntradaEstoque, editarEntradaEstoque, excluirEntradaEstoque } from "@/services/estoqueEntradasService";

/** Chave do detalhe (prefixo `estoque`: o que invalida o estoque invalida o detalhe). */
export const chaveDetalheEntrada = (/** @type {string|null} */ empresaId, /** @type {string|null} */ id) => ["estoque", "entrada", empresaId, id];

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
    <div className="min-w-0" data-testid={`entrada-grupo-${titulo.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
      <div className="mg-b1-form-grid grid grid-cols-12">
        <SecaoForm titulo={titulo} />
      </div>
      <dl className="min-w-0">{children}</dl>
    </div>
  );
}

/** @param {{ label: string, value: string, onChange: (v: string) => void, required?: boolean, testId?: string, maxLength?: number }} props */
function AreaTexto({ label, value, onChange, required = false, testId = undefined, maxLength = 500 }) {
  return (
    <B1Field label={label} required={required} span={12} hasValue={Boolean(String(value ?? "").trim())}>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} maxLength={maxLength} rows={2} data-testid={testId} className="mg-input min-w-0 w-full normal-case" />
    </B1Field>
  );
}

const tamanho = (/** @type {string} */ t) => [...String(t ?? "").trim()].length;

/**
 * Detalhe de UMA entrada (D-PROD-257, D-PROD-259) numa janela só (680px; tela cheia no celular): cabeçalho (motivo,
 * fornecedor, documento, centros), produtos (com lote e validade), histórico. Abre pelo detalhe do movimento, em
 * Movimentos (a aba Entradas saiu). Com a ação `entrada`, duas ações dentro da MESMA janela (sem popup sobre popup):
 * "Editar observação" (só a observação) e "Excluir entrada" (exclusão lógica com estorno integral; o servidor recusa
 * se o estoque já foi usado).
 * D-PROD-270: e "Editar" (edição completa), que fecha este detalhe e abre a janela "Novo movimento" em modo edição
 * (`onEditar`, com a versão vigente); sem `onEditar` o botão não aparece. As versões substituídas por edições ficam em
 * "Versões anteriores" (recolhida) e o histórico diz "Editado (lançamentos refeitos)".
 * @param {{ entrada: any|null, empresaId: string|null, podeLancar: boolean, onFechar: () => void, onEditar?: (detalhe: any) => void }} props `entrada` é a linha da lista
 */
export default function JanelaEntradaEstoque({ entrada, empresaId, podeLancar, onFechar, onEditar = undefined }) {
  const celular = useCelular();
  const queryClient = useQueryClient();
  const id = entrada?.id ? String(entrada.id) : null;
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
    queryKey: chaveDetalheEntrada(empresaId, id),
    queryFn: () => detalharEntradaEstoque(empresaId, /** @type {string} */ (id)),
    enabled: Boolean(empresaId && id),
    staleTime: 15 * 1000,
    refetchOnWindowFocus: false,
  });
  const d = /** @type {any} */ (consulta.data ?? null);
  const e = d ?? entrada;
  const { itens, anteriores } = versoesDaEntrada(e);
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
      await editarEntradaEstoque(empresaId, { id: d.id, versao: d.versao }, {
        motivoEdicao: motivo.trim(),
        observacao: tamanho(observacao) ? observacao.trim() : null,
      });
      await atualizar();
      setModo("ver");
    } catch (falha) {
      setErro(mensagemErroEntrada(falha, "Não foi possível salvar a edição."));
    } finally {
      setEnviando(false);
    }
  };

  const confirmarExclusao = async () => {
    if (enviando || !d) return;
    if (tamanho(motivo) < MOTIVO_ACAO_MINIMO) return setErro(`Informe o motivo da exclusão (ao menos ${MOTIVO_ACAO_MINIMO} caracteres).`);
    const conteudo = `${d.id}|${d.versao}|${motivo.trim()}`;
    if (!operacao.current || operacao.current.conteudo !== conteudo) operacao.current = { conteudo, id: chaveDeOperacao() };
    setEnviando(true);
    setErro(null);
    try {
      await excluirEntradaEstoque(empresaId, { id: d.id, versao: d.versao }, { motivo: motivo.trim(), operationId: operacao.current.id });
      await atualizar();
      setModo("ver");
    } catch (falha) {
      setErro(mensagemErroEntrada(falha, "Não foi possível excluir a entrada."));
    } finally {
      setEnviando(false);
    }
  };

  let rodape = null;
  if (modo === "editar") {
    rodape = (
      <>
        <button type="button" className="tb-btn" onClick={() => setModo("ver")} disabled={enviando}>Voltar</button>
        <button type="button" className="tb-btn tb-btn-green" onClick={salvarEdicao} disabled={enviando} data-testid="entrada-salvar-edicao">
          {enviando ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
          {enviando ? "Salvando…" : "Salvar"}
        </button>
      </>
    );
  } else if (modo === "excluir") {
    rodape = (
      <>
        <button type="button" className="tb-btn" onClick={() => setModo("ver")} disabled={enviando}>Voltar</button>
        <button type="button" className="tb-btn tb-btn-red" onClick={confirmarExclusao} disabled={enviando} data-testid="entrada-confirmar-exclusao">
          {enviando ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
          {enviando ? "Excluindo…" : "Excluir entrada"}
        </button>
      </>
    );
  } else if (podeLancar && confirmada) {
    rodape = (
      <>
        <button type="button" className="tb-btn" onClick={abrirEdicao} data-testid="entrada-editar">Editar observação</button>
        {onEditar ? (
          <button type="button" className="tb-btn" onClick={() => onEditar(d)} data-testid="entrada-editar-completo">Editar</button>
        ) : null}
        <button type="button" className="tb-btn tb-btn-red" onClick={() => { setMotivo(""); setErro(null); setModo("excluir"); }} data-testid="entrada-excluir">Excluir entrada</button>
      </>
    );
  }

  return (
    <B1Janela
      aberto={Boolean(entrada)}
      onFechar={onFechar}
      podeFechar={!enviando}
      titulo={e ? `Entrada nº ${e.numero}` : "Entrada"}
      testId="janela-entrada-estoque"
      className={celular ? "b1-janela--tela-cheia" : ""}
      contentProps={{ className: celular ? "b1-janela__camada--tela-cheia" : "" }}
      rodape={rodape}
    >
      {e ? (
        <div className="min-w-0" data-testid="entrada-detalhe">
          <Grupo titulo="Entrada">
            <Linha rotulo="Data" valor={formatarDia(e.data_entrada)} testId="entrada-detalhe-data" />
            <Linha rotulo="Motivo" valor={rotuloDoMotivo(e)} testId="entrada-detalhe-motivo" />
            <Linha rotulo="Situação" valor={ROTULO_STATUS_ENTRADA[/** @type {'CONFIRMADA'|'EXCLUIDA'} */ (e.status)] ?? e.status} testId="entrada-detalhe-situacao" />
            <Linha rotulo="Fornecedor" valor={e.fornecedor_nome} testId="entrada-detalhe-fornecedor" />
            <Linha rotulo="Documento" valor={e.documento_numero} />
            <Linha rotulo="Centro de resultado" valor={e.centro_resultado_nome} testId="entrada-detalhe-centro-resultado" />
            <Linha rotulo="Centro de custo" valor={e.centro_custo_nome} testId="entrada-detalhe-centro-custo" />
            <Linha rotulo="Valor total" valor={valorTotalDaEntrada(e)} testId="entrada-detalhe-valor-total" />
            <Linha rotulo="Observação" valor={e.observacao} testId="entrada-detalhe-observacao" />
          </Grupo>

          <Grupo titulo={itens.length > 1 ? "Produtos" : "Produto"}>
            {itens.map((/** @type {any} */ i) => (
              <React.Fragment key={i.id}>
                <Linha rotulo={i.produto_nome ?? "Produto"} valor={`${formatarQtd(i.quantidade_estoque, i.unidade_estoque)} em ${i.local_estoque_nome ?? "—"}`} testId="entrada-detalhe-item" />
                {i.unidade === "SACO" ? <Linha rotulo="Informado em" valor={`${formatarQtd(i.quantidade, "KG").replace(/ kg$/, "")} sacos de ${formatarQtd(i.fator_kg, "KG")}`} /> : null}
                <Linha rotulo="Custo" valor={i.custo_zero ? "Custo zero" : `${formatarCustoUnitario(i.custo_kg)} por ${i.unidade_estoque === "L" ? "litro" : "kg"}`} testId="entrada-detalhe-custo" />
                <Linha rotulo="Valor" valor={i.custo_zero ? "" : formatarReais(i.valor_total)} />
                <Linha rotulo="Lote" valor={i.lote_fabricante} testId="entrada-detalhe-lote" />
                <Linha rotulo="Validade" valor={formatarValidade(i.data_validade)} testId="entrada-detalhe-validade" />
              </React.Fragment>
            ))}
          </Grupo>

          {anteriores.length ? (
            <details className="mt-2 min-w-0" data-testid="entrada-versoes-anteriores">
              <summary className="cursor-pointer text-[13px] font-semibold text-[var(--mg-text-2,#475569)]">Versões anteriores ({anteriores.length})</summary>
              {anteriores.map((v) => (
                <div key={v.revisao} className="min-w-0" data-testid={`entrada-versao-${v.revisao}`}>
                  <p className="mt-2 text-[12px] font-semibold text-[var(--mg-text-2,#475569)]">Versão {v.revisao}</p>
                  <dl className="min-w-0">
                    {v.itens.map((/** @type {any} */ i) => (
                      <Linha
                        key={i.id}
                        rotulo={i.produto_nome ?? "Produto"}
                        valor={`${formatarQtd(i.quantidade_estoque, i.unidade_estoque)} em ${i.local_estoque_nome ?? "—"} · ${i.custo_zero ? "custo zero" : formatarReais(i.valor_total)}`}
                      />
                    ))}
                  </dl>
                </div>
              ))}
            </details>
          ) : null}

          {consulta.isError ? (
            <p role="alert" className="mt-2 text-[13px] text-red-800" data-testid="entrada-detalhe-erro">
              {getApiErrorMessage(consulta.error, "Não foi possível abrir o detalhe da entrada.")}{" "}
              <button type="button" className="underline" onClick={() => consulta.refetch()}>Tentar novamente</button>
            </p>
          ) : null}

          {d && d.eventos?.length ? (
            <Grupo titulo="Histórico">
              {d.eventos.map((/** @type {any} */ v) => (
                <Linha key={v.id} rotulo={`${rotuloDoEventoEstoque(v)} · ${formatarInstante(v.criado_em)}`} valor={v.motivo} />
              ))}
            </Grupo>
          ) : null}

          {modo === "editar" ? (
            <div className="mg-b1-form-grid grid grid-cols-12 gap-x-3 gap-y-2 mt-3" data-testid="entrada-form-edicao">
              <SecaoForm titulo="Editar observação" />
              <AreaTexto label="Observação" value={observacao} onChange={setObservacao} testId="entrada-edicao-observacao" />
              <AreaTexto label="Motivo da edição" value={motivo} onChange={setMotivo} required testId="entrada-edicao-motivo" />
              <p className="col-span-12 text-[12px] text-[var(--mg-text-2,#475569)]">Aqui só muda a observação. Para mudar o motivo, a data, o fornecedor, o documento, os centros ou os produtos, use “Editar”.</p>
            </div>
          ) : null}

          {modo === "excluir" ? (
            <div className="mg-b1-form-grid grid grid-cols-12 gap-x-3 gap-y-2 mt-3" data-testid="entrada-form-exclusao">
              <SecaoForm titulo="Excluir entrada" />
              <p className="col-span-12 text-[13px]">A entrada fica no histórico como excluída e o estoque dela é estornado por inteiro. Só é possível se esse estoque ainda não foi usado.</p>
              <AreaTexto label="Motivo da exclusão" value={motivo} onChange={setMotivo} required testId="entrada-exclusao-motivo" />
            </div>
          ) : null}

          {erro ? (
            <div className="mt-2" role="alert" data-testid="entrada-acao-erro">
              <AvisoGestao>{erro}</AvisoGestao>
            </div>
          ) : null}
        </div>
      ) : null}
    </B1Janela>
  );
}
