import React, { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2 } from "lucide-react";
import B1Field from "@/components/cadastro/base1/B1Field";
import B1Janela from "@/components/cadastro/base1/B1Janela";
import { AvisoGestao, CampoSelect, CampoTexto, SecaoForm } from "@/components/gestao/GestaoFormParts";
import { CampoDia, CampoNumero, EscolhaSegmentada, ValorCalculado } from "@/components/financeiroGestao/CamposLancamento";
import SeletorPaginadoGestao from "@/components/financeiroGestao/SeletorPaginadoGestao";
import { MobileSheetPortalCtx, useCelular } from "@/components/common/MobileSheet";
import { formatarReais } from "@/lib/estoqueConsultaRegras";
import { lerNumeroLocal, somar } from "@/lib/dinheiroDecimal";
import {
  LIMITES_ENTRADA,
  LIMITES_TOTAL,
  LOCALE_ENTRADA,
  MAX_ITENS_ENTRADA,
  MOTIVO_IMPLANTACAO,
  TIPO_ENTRADA,
  TIPOS_DE_MOVIMENTO,
  chaveDeOperacao,
  comProduto,
  comValor,
  dadosDaTransferencia,
  ehImplantacao,
  formularioVazioEntrada,
  formularioVazioTransferencia,
  linhaVaziaEntrada,
  mensagemErroEntrada,
  montarCorpoEntrada,
  unidadesDoProduto,
  validarFormularioEntrada,
  validarTransferencia,
} from "@/lib/estoqueEntradasRegras";
import {
  criarEntradaEstoque,
  criarMotivoEntrada,
  editarMotivoEntrada,
  listarCentrosDaEntrada,
  listarDepositosDaEntrada,
  listarFornecedoresDaEntrada,
  listarMotivosEntrada,
  listarProdutosDaEntrada,
  transferirEntreDepositos,
} from "@/services/estoqueEntradasService";

export const FORMULARIO_NOVO_MOVIMENTO_ID = "formulario-novo-movimento-estoque";
const CHAVE_MOTIVOS = ["estoque", "motivos-entrada"];

/** Área de texto Base1. @param {{ label: string, value: string, onChange: (v: string) => void, testId?: string }} props */
function Observacao({ label, value, onChange, testId = undefined }) {
  return (
    <B1Field label={label} span={12} hasValue={Boolean(String(value ?? "").trim())}>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} maxLength={500} rows={2} data-testid={testId} className="mg-input min-w-0 w-full normal-case" />
    </B1Field>
  );
}

/** @param {any} o */
const opcaoProduto = (o) => (o ? { id: String(o.id), rotulo: String(o.nome ?? ""), unidade_estoque: o.unidade_estoque, peso_por_saco_kg: o.peso_por_saco_kg ?? null } : null);
/** @param {any} o */
const opcaoSimples = (o) => (o ? { id: String(o.id), rotulo: String(o.nome ?? "") } : null);

/** Soma dos totais das linhas (texto canônico), ou "" se faltar algum. @param {any[]} itens */
const totalDasLinhas = (itens) => {
  const valores = [];
  for (const l of itens) {
    if (l.custo_zero) continue;
    const t = lerNumeroLocal(l.total, LOCALE_ENTRADA, LIMITES_TOTAL);
    if (!t.ok) return "";
    valores.push(t.valor);
  }
  try {
    return somar(valores, 4);
  } catch {
    return "";
  }
};

/**
 * Uma linha de produto da entrada: produto, unidade, depósito, quantidade, valor unitário, valor total (um calcula o
 * outro), "Sem custo", lote e validade.
 * @param {{ linha: any, indice: number, empresaId: string, erros: Record<string, string>, podeRemover: boolean,
 *   onMudar: (l: any) => void, onRemover: () => void }} props
 */
function LinhaDeProduto({ linha, indice, empresaId, erros, podeRemover, onMudar, onRemover }) {
  const e = (/** @type {string} */ campo) => erros[`itens.${indice}.${campo}`] || undefined;
  const unidades = unidadesDoProduto(linha.produto);
  const por = linha.unidade === "SACO" ? "saco" : linha.unidade === "L" ? "litro" : "kg";
  return (
    // A linha é um cartão de linha inteira (`b1-form-embutido`) com a grade PRÓPRIA dentro: a grade compacta de 4 colunas
    // da Base1 (D-PROD-164/#339) vale para `.mg-b1-form-grid` e, aplicada aqui dentro, achatava o cartão e empilhava os
    // campos de uma linha sobre os da outra (não dava para escolher o produto da 2ª linha).
    <div className="col-span-12 b1-form-embutido rounded border border-[var(--mg-border,#e2e8f0)] p-2" data-testid={`entrada-linha-${indice}`}>
      <div className="grid grid-cols-12 gap-x-3 gap-y-2">
      <div className="col-span-12 flex items-center justify-between text-[12px] font-semibold text-[var(--mg-text-2,#475569)]">
        <span>Produto {indice + 1}</span>
        {podeRemover ? (
          <button type="button" className="tb-btn" onClick={onRemover} aria-label={`Remover o produto ${indice + 1}`} data-testid={`entrada-linha-${indice}-remover`}>
            <Trash2 size={14} aria-hidden /> Remover
          </button>
        ) : null}
      </div>
      <SeletorPaginadoGestao
        rotulo="Produto"
        testId={`entrada-linha-${indice}-produto`}
        chave={["estoque", "entrada-produtos", empresaId]}
        buscar={({ q, cursor, limit }) => listarProdutosDaEntrada(empresaId, { q, cursor, limit })}
        value={linha.produto ? { id: linha.produto.id, rotulo: linha.produto.rotulo } : null}
        onChange={(o) => onMudar(comProduto(linha, opcaoProduto(o)))}
        detalheDaOpcao={(o) => (o?.codigo ? String(o.codigo) : null)}
        obrigatorio
        erro={e("produto")}
        span={6}
      />
      <CampoSelect
        label="Unidade"
        value={linha.unidade}
        onChange={(v) => onMudar({ ...linha, unidade: v })}
        options={unidades}
        readOnly={unidades.length <= 1}
        required
        error={e("unidade")}
        span={2}
        placeholder={linha.produto ? undefined : "Escolha o produto"}
      />
      <SeletorPaginadoGestao
        rotulo="Local de estoque"
        testId={`entrada-linha-${indice}-deposito`}
        chave={["estoque", "entrada-depositos"]}
        buscar={({ q, cursor, limit }) => listarDepositosDaEntrada({ q, cursor, limit })}
        value={linha.deposito}
        onChange={(o) => onMudar({ ...linha, deposito: opcaoSimples(o) })}
        obrigatorio
        erro={e("deposito")}
        span={4}
      />
      <CampoNumero
        label="Quantidade"
        value={linha.quantidade}
        onChange={(v) => onMudar(comValor(linha, "quantidade", v))}
        locale={LOCALE_ENTRADA}
        limites={LIMITES_ENTRADA}
        required
        error={e("quantidade")}
        span={3}
        testId={`entrada-linha-${indice}-quantidade`}
      />
      <CampoNumero
        label={`Valor unitário (R$ por ${por})`}
        value={linha.custo_zero ? "" : linha.custo}
        onChange={(v) => onMudar(comValor(linha, "custo", v))}
        locale={LOCALE_ENTRADA}
        limites={LIMITES_ENTRADA}
        casasMin={2}
        readOnly={linha.custo_zero}
        required={!linha.custo_zero}
        error={e("custo")}
        span={3}
        testId={`entrada-linha-${indice}-custo`}
      />
      <CampoNumero
        label="Valor total (R$)"
        value={linha.custo_zero ? "" : linha.total}
        onChange={(v) => onMudar(comValor(linha, "total", v))}
        locale={LOCALE_ENTRADA}
        limites={LIMITES_TOTAL}
        casasMin={2}
        readOnly={linha.custo_zero}
        span={3}
        testId={`entrada-linha-${indice}-total`}
      />
      <label className="col-span-12 flex items-center gap-2 text-[13px] md:col-span-3" data-testid={`entrada-linha-${indice}-sem-custo-rotulo`}>
        <input
          type="checkbox"
          checked={linha.custo_zero}
          onChange={(ev) => onMudar({ ...linha, custo_zero: ev.target.checked, custo: "", total: "" })}
          data-testid={`entrada-linha-${indice}-sem-custo`}
        />
        Sem custo
      </label>
      <CampoTexto label="Lote" value={linha.lote} onChange={(v) => onMudar({ ...linha, lote: v })} maxLength={64} span={6} error={e("lote")} keepCase />
      <CampoDia label="Data de validade" value={linha.validade} onChange={(v) => onMudar({ ...linha, validade: v })} error={e("validade")} span={6} testId={`entrada-linha-${indice}-validade`} />
      </div>
    </div>
  );
}

/**
 * Cadastro de motivos de entrada, DENTRO da janela (sem popup sobre popup): lista, criar, renomear e ativar/desativar.
 * "Saldo de implantação" é fixo.
 * @param {{ onVoltar: () => void }} props
 */
function MotivosDeEntrada({ onVoltar }) {
  const queryClient = useQueryClient();
  const consulta = useQuery({ queryKey: CHAVE_MOTIVOS, queryFn: () => listarMotivosEntrada(), staleTime: 30 * 1000 });
  const [novo, setNovo] = useState("");
  const [editando, setEditando] = useState(/** @type {{ id: string, nome: string } | null} */ (null));
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState(/** @type {string|null} */ (null));

  /** @param {() => Promise<any>} acao */
  const executar = async (acao) => {
    if (ocupado) return;
    setOcupado(true);
    setErro(null);
    try {
      await acao();
      await queryClient.invalidateQueries({ queryKey: CHAVE_MOTIVOS });
    } catch (falha) {
      setErro(mensagemErroEntrada(falha, "Não foi possível salvar o motivo."));
    } finally {
      setOcupado(false);
    }
  };

  const motivos = consulta.data ?? [];
  return (
    <div className="mg-b1-form-grid grid grid-cols-12 gap-x-3 gap-y-2" data-testid="motivos-entrada">
      <SecaoForm titulo="Motivos de entrada" />
      <p className="col-span-12 text-[12px] text-[var(--mg-text-2,#475569)]">
        O motivo diz por que o produto entrou. "Saldo de implantação" é fixo e só vale para produto que ainda não tem movimento.
      </p>
      <ul className="col-span-12 divide-y divide-[var(--mg-border,#e2e8f0)]" data-testid="motivos-entrada-lista">
        {motivos.map((/** @type {any} */ m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-2 py-1.5 text-[13px]" data-testid={`motivo-${m.id}`}>
            {editando?.id === m.id ? (
              <>
                <input
                  value={editando.nome}
                  onChange={(ev) => setEditando({ id: m.id, nome: ev.target.value })}
                  maxLength={80}
                  className="mg-input min-w-0 flex-1 normal-case"
                  aria-label="Novo nome do motivo"
                  data-testid="motivo-editar-nome"
                />
                <button type="button" className="tb-btn tb-btn-green" disabled={ocupado} onClick={() => executar(async () => { await editarMotivoEntrada(m.id, { nome: editando.nome }); setEditando(null); })} data-testid="motivo-salvar-nome">
                  Salvar
                </button>
                <button type="button" className="tb-btn" disabled={ocupado} onClick={() => setEditando(null)}>Cancelar</button>
              </>
            ) : (
              <>
                <span className={`min-w-0 flex-1 ${m.ativo ? "" : "line-through opacity-60"}`}>{m.nome}</span>
                {m.padrao ? <span className="text-[11px] text-[var(--mg-text-2,#475569)]">padrão</span> : null}
                {!m.padrao ? (
                  <>
                    <button type="button" className="tb-btn" disabled={ocupado} onClick={() => setEditando({ id: m.id, nome: m.nome })} data-testid={`motivo-${m.id}-renomear`}>Renomear</button>
                    <button type="button" className="tb-btn" disabled={ocupado} onClick={() => executar(() => editarMotivoEntrada(m.id, { ativo: !m.ativo }))} data-testid={`motivo-${m.id}-ativo`}>
                      {m.ativo ? "Desativar" : "Reativar"}
                    </button>
                  </>
                ) : null}
              </>
            )}
          </li>
        ))}
      </ul>
      <CampoTexto label="Novo motivo" value={novo} onChange={setNovo} maxLength={80} span={9} keepCase />
      <div className="col-span-12 flex items-end md:col-span-3">
        <button
          type="button"
          className="tb-btn tb-btn-green w-full"
          disabled={ocupado || [...novo.trim()].length < 2}
          onClick={() => executar(async () => { await criarMotivoEntrada(novo.trim()); setNovo(""); })}
          data-testid="motivo-incluir"
        >
          <Plus size={14} aria-hidden /> Incluir
        </button>
      </div>
      {erro ? (
        <div className="col-span-12" role="alert" data-testid="motivos-erro">
          <AvisoGestao>{erro}</AvisoGestao>
        </div>
      ) : null}
      <div className="col-span-12">
        <button type="button" className="tb-btn" onClick={onVoltar} data-testid="motivos-voltar">Voltar para a entrada</button>
      </div>
    </div>
  );
}

/**
 * "Novo movimento" do Estoque (D-PROD-259): UMA janela (680px; tela cheia no celular) em que se escolhe o TIPO de
 * movimento — Entrada ou Transferência — e preenche o formulário daquele tipo. Tudo aparece junto na lista de
 * Movimentos (não há aba separada). A Entrada tem cabeçalho (data, motivo do cadastro, fornecedor, documento, centro
 * de resultado, centro de custo, observação) e vários produtos; o saldo de implantação esconde fornecedor e documento.
 * A Transferência leva o saldo de um depósito para outro (o mesmo comando do Mapa). Enviar grava de uma vez; o
 * servidor confere tudo e é quem bloqueia. Um reenvio sem resposta reaproveita a mesma `operation_id`.
 * @param {{ aberto: boolean, empresaId: string, hoje: string, onFechar: () => void, onLancado: (r: { tipo: string, entrada?: any }) => void }} props
 */
export default function JanelaNovoMovimentoEstoque({ aberto, empresaId, hoje, onFechar, onLancado }) {
  const celular = useCelular();
  const [alvoFolha, setAlvoFolha] = useState(/** @type {HTMLElement | null} */ (null));
  const [tipo, setTipo] = useState(TIPO_ENTRADA);
  const [modoMotivos, setModoMotivos] = useState(false);
  const [entrada, setEntrada] = useState(() => formularioVazioEntrada(hoje));
  const [transf, setTransf] = useState(() => formularioVazioTransferencia(hoje));
  const [erros, setErros] = useState(/** @type {Record<string, string>} */ ({}));
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState(/** @type {string|null} */ (null));
  const operacao = useRef(/** @type {{ conteudo: string, id: string } | null} */ (null));

  const motivosQuery = useQuery({ queryKey: [...CHAVE_MOTIVOS, "ativos"], queryFn: () => listarMotivosEntrada({ ativos: true }), staleTime: 30 * 1000, enabled: aberto });
  const motivos = motivosQuery.data ?? [];
  const implantacao = ehImplantacao(entrada);

  /** @param {Record<string, any>} mudanca */
  const mudarEntrada = (mudanca) => {
    setEntrada((f) => ({ ...f, ...mudanca }));
    setErroEnvio(null);
  };
  /** @param {Record<string, any>} mudanca */
  const mudarTransf = (mudanca) => {
    setTransf((f) => ({ ...f, ...mudanca }));
    setErroEnvio(null);
  };
  /** @param {number} i @param {any} linha */
  const mudarLinha = (i, linha) => mudarEntrada({ itens: entrada.itens.map((l, j) => (j === i ? linha : l)) });

  /** @param {string} prefixo @param {unknown} conteudo */
  const idDaOperacao = (prefixo, conteudo) => {
    const texto = JSON.stringify(conteudo);
    if (!operacao.current || operacao.current.conteudo !== texto) operacao.current = { conteudo: texto, id: chaveDeOperacao(prefixo) };
    return operacao.current.id;
  };

  const enviar = async (/** @type {React.FormEvent} */ evento) => {
    evento.preventDefault();
    if (enviando) return;
    if (tipo === TIPO_ENTRADA) {
      const { erros: achados, ok } = validarFormularioEntrada(entrada, hoje);
      setErros(achados);
      if (!ok) return;
    } else {
      const { erros: achados, ok } = validarTransferencia(transf, hoje);
      setErros(achados);
      if (!ok) return;
    }
    setEnviando(true);
    setErroEnvio(null);
    try {
      if (tipo === TIPO_ENTRADA) {
        const id = idDaOperacao("ent", montarCorpoEntrada(empresaId, entrada, ""));
        const criada = await criarEntradaEstoque(montarCorpoEntrada(empresaId, entrada, id));
        onLancado({ tipo, entrada: criada });
      } else {
        const id = idDaOperacao("trf", dadosDaTransferencia(transf, ""));
        await transferirEntreDepositos(empresaId, dadosDaTransferencia(transf, id));
        onLancado({ tipo });
      }
    } catch (erro) {
      setErroEnvio(mensagemErroEntrada(erro, `Não foi possível lançar a ${tipo === TIPO_ENTRADA ? "entrada" : "transferência"}. Verifique a conexão e tente de novo.`));
    } finally {
      setEnviando(false);
    }
  };

  const totalEntrada = tipo === TIPO_ENTRADA ? totalDasLinhas(entrada.itens) : "";

  const rodape = modoMotivos ? null : (
    <>
      <button type="button" className="tb-btn" onClick={onFechar} disabled={enviando} data-testid="movimento-cancelar">
        Cancelar
      </button>
      <button type="submit" form={FORMULARIO_NOVO_MOVIMENTO_ID} className="tb-btn tb-btn-green" disabled={enviando} data-testid="movimento-lancar">
        {enviando ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
        {enviando ? "Lançando…" : tipo === TIPO_ENTRADA ? "Lançar entrada" : "Lançar transferência"}
      </button>
    </>
  );

  return (
    <B1Janela
      aberto={aberto}
      onFechar={onFechar}
      podeFechar={!enviando}
      titulo="Novo movimento de estoque"
      testId="janela-novo-movimento-estoque"
      className={celular ? "b1-janela--tela-cheia" : ""}
      contentProps={{ className: celular ? "b1-janela__camada--tela-cheia" : "" }}
      // No celular as listas (produto, local, motivo…) abrem numa folha: ela nasce DENTRO da janela, senão a janela
      // modal fica por cima dela e não deixa tocar nas opções. Com a folha aberta, "fechar" fecha só a folha.
      aoPedirFechar={() => !alvoFolha?.querySelector(".mk-sheet-root")}
      fora={<div ref={setAlvoFolha} className="contents" />}
      rodape={rodape}
    >
      <MobileSheetPortalCtx.Provider value={alvoFolha}>
      {modoMotivos ? (
        <MotivosDeEntrada onVoltar={() => setModoMotivos(false)} />
      ) : (
        <form id={FORMULARIO_NOVO_MOVIMENTO_ID} onSubmit={enviar} noValidate className="mg-b1-form-grid grid grid-cols-12 gap-x-3 gap-y-2" data-testid="formulario-novo-movimento">
          <EscolhaSegmentada
            rotulo="Tipo de movimento"
            testId="movimento-tipo"
            opcoes={TIPOS_DE_MOVIMENTO.map((t) => ({ value: t.value, label: t.label }))}
            value={tipo}
            onChange={(v) => {
              setTipo(v);
              setErros({});
              setErroEnvio(null);
            }}
          />

          {tipo === TIPO_ENTRADA ? (
            <>
              <SecaoForm titulo="Entrada" />
              <CampoDia label="Data de entrada" value={entrada.data_entrada} onChange={(v) => mudarEntrada({ data_entrada: v })} max={hoje} required error={erros.data_entrada} span={4} testId="entrada-data" />
              <CampoSelect
                label="Motivo"
                value={entrada.motivo?.id ?? ""}
                onChange={(v) => {
                  const m = motivos.find((/** @type {any} */ x) => x.id === v) ?? null;
                  const proximo = m ? { id: m.id, nome: m.nome, natureza: m.natureza } : null;
                  mudarEntrada(proximo?.natureza === MOTIVO_IMPLANTACAO ? { motivo: proximo, fornecedor: null, documento_numero: "" } : { motivo: proximo });
                }}
                options={motivos.map((/** @type {any} */ m) => ({ value: m.id, label: m.nome }))}
                required
                error={erros.motivo}
                span={6}
                placeholder={motivosQuery.isLoading ? "Carregando…" : undefined}
              />
              <div className="col-span-12 flex items-end md:col-span-2">
                <button type="button" className="tb-btn w-full" onClick={() => setModoMotivos(true)} data-testid="entrada-gerenciar-motivos">
                  Motivos…
                </button>
              </div>
              {implantacao ? (
                <p className="col-span-12 text-[12px] text-[var(--mg-text-2,#475569)]" data-testid="entrada-aviso-implantacao">
                  Saldo de implantação: o estoque que já existia quando o produto passou a ser controlado aqui. Sem fornecedor e sem documento; só para produto que ainda não tem movimento.
                </p>
              ) : (
                <>
                  <SeletorPaginadoGestao
                    rotulo="Fornecedor"
                    testId="entrada-fornecedor"
                    chave={["estoque", "entrada-fornecedores", empresaId]}
                    buscar={({ q, cursor, limit }) => listarFornecedoresDaEntrada(empresaId, { q, cursor, limit })}
                    value={entrada.fornecedor}
                    onChange={(o) => mudarEntrada({ fornecedor: opcaoSimples(o) })}
                    permitirLimpar
                    erro={erros.fornecedor || undefined}
                    span={8}
                  />
                  <CampoTexto label="Documento" value={entrada.documento_numero} onChange={(v) => mudarEntrada({ documento_numero: v })} maxLength={64} span={4} error={erros.documento_numero} keepCase />
                </>
              )}
              <SeletorPaginadoGestao
                rotulo="Centro de resultado"
                testId="entrada-centro-resultado"
                chave={["estoque", "entrada-centros-resultado", empresaId]}
                buscar={({ q, cursor, limit }) => listarCentrosDaEntrada("resultado", empresaId, { q, cursor, limit })}
                value={entrada.centro_resultado}
                onChange={(o) => mudarEntrada({ centro_resultado: opcaoSimples(o) })}
                permitirLimpar
                span={6}
              />
              <SeletorPaginadoGestao
                rotulo="Centro de custo"
                testId="entrada-centro-custo"
                chave={["estoque", "entrada-centros-custo", empresaId]}
                buscar={({ q, cursor, limit }) => listarCentrosDaEntrada("custo", empresaId, { q, cursor, limit })}
                value={entrada.centro_custo}
                onChange={(o) => mudarEntrada({ centro_custo: opcaoSimples(o) })}
                permitirLimpar
                span={6}
              />
              <Observacao label="Observação" value={entrada.observacao} onChange={(v) => mudarEntrada({ observacao: v })} testId="entrada-observacao" />

              <SecaoForm titulo="Produtos" />
              {entrada.itens.map((linha, i) => (
                <LinhaDeProduto
                  key={linha.chave}
                  linha={linha}
                  indice={i}
                  empresaId={empresaId}
                  erros={erros}
                  podeRemover={entrada.itens.length > 1}
                  onMudar={(l) => mudarLinha(i, l)}
                  onRemover={() => mudarEntrada({ itens: entrada.itens.filter((_, j) => j !== i) })}
                />
              ))}
              {erros.itens ? <p className="col-span-12 text-[12px] text-red-800">{erros.itens}</p> : null}
              <div className="col-span-12 flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  className="tb-btn"
                  disabled={entrada.itens.length >= MAX_ITENS_ENTRADA}
                  onClick={() => mudarEntrada({ itens: [...entrada.itens, linhaVaziaEntrada()] })}
                  data-testid="entrada-adicionar-produto"
                >
                  <Plus size={14} aria-hidden /> Adicionar produto
                </button>
              </div>
              <ValorCalculado label="Valor total da entrada" valor={totalEntrada ? formatarReais(totalEntrada) : "—"} span={12} testId="entrada-valor-total" destaque />
            </>
          ) : (
            <>
              <SecaoForm titulo="Transferência" />
              <CampoDia label="Data" value={transf.data} onChange={(v) => mudarTransf({ data: v })} max={hoje} required error={erros.data} span={4} testId="transferencia-data" />
              <SeletorPaginadoGestao
                rotulo="Produto"
                testId="transferencia-produto"
                chave={["estoque", "entrada-produtos", empresaId]}
                buscar={({ q, cursor, limit }) => listarProdutosDaEntrada(empresaId, { q, cursor, limit })}
                value={transf.produto ? { id: transf.produto.id, rotulo: transf.produto.rotulo } : null}
                onChange={(o) => mudarTransf({ produto: opcaoProduto(o) })}
                obrigatorio
                erro={erros.produto || undefined}
                span={8}
              />
              <SeletorPaginadoGestao
                rotulo="Local de origem"
                testId="transferencia-origem"
                chave={["estoque", "entrada-depositos"]}
                buscar={({ q, cursor, limit }) => listarDepositosDaEntrada({ q, cursor, limit })}
                value={transf.origem}
                onChange={(o) => mudarTransf({ origem: opcaoSimples(o) })}
                obrigatorio
                erro={erros.origem || undefined}
                span={6}
              />
              <SeletorPaginadoGestao
                rotulo="Local de destino"
                testId="transferencia-destino"
                chave={["estoque", "entrada-depositos"]}
                buscar={({ q, cursor, limit }) => listarDepositosDaEntrada({ q, cursor, limit })}
                value={transf.destino}
                onChange={(o) => mudarTransf({ destino: opcaoSimples(o) })}
                obrigatorio
                erro={erros.destino || undefined}
                span={6}
              />
              <CampoNumero
                label={`Quantidade (${transf.produto?.unidade_estoque === "L" ? "litros" : "kg"})`}
                value={transf.quantidade}
                onChange={(v) => mudarTransf({ quantidade: v })}
                locale={LOCALE_ENTRADA}
                limites={LIMITES_ENTRADA}
                required
                error={erros.quantidade}
                span={6}
                testId="transferencia-quantidade"
              />
              <Observacao label="Observação" value={transf.observacao} onChange={(v) => mudarTransf({ observacao: v })} testId="transferencia-observacao" />
              <p className="col-span-12 text-[12px] text-[var(--mg-text-2,#475569)]">
                O saldo sai do local de origem e entra no de destino com o mesmo custo médio. O servidor confere se há saldo suficiente.
              </p>
            </>
          )}

          {erroEnvio ? (
            <div className="col-span-12" role="alert" data-testid="movimento-erro">
              <AvisoGestao>{erroEnvio}</AvisoGestao>
            </div>
          ) : null}
        </form>
      )}
      </MobileSheetPortalCtx.Provider>
    </B1Janela>
  );
}

