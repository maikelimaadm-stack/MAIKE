import React, { useEffect, useRef, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
import B1Field from "@/components/cadastro/base1/B1Field";
import CadastroFormShell from "@/components/cadastro/base1/CadastroFormShell";
import CadastroMotivosEstoque from "@/components/estoque/CadastroMotivosEstoque";
import CamposAjusteEstoque from "@/components/estoque/CamposAjusteEstoque";
import CampoLotesSaida from "@/components/estoque/CampoLotesSaida";
import TabelaProdutosMovimento from "@/components/estoque/TabelaProdutosMovimento";
import { AvisoGestao, CampoSelect, CampoTexto, SecaoForm } from "@/components/gestao/GestaoFormParts";
import { CampoDia, CampoNumero, EscolhaSegmentada, ValorCalculado } from "@/components/financeiroGestao/CamposLancamento";
import SeletorPaginadoGestao from "@/components/financeiroGestao/SeletorPaginadoGestao";
import { useCelular } from "@/components/common/MobileSheet";
import { formatarReais } from "@/lib/estoqueConsultaRegras";
import { lerNumeroLocal, somar } from "@/lib/dinheiroDecimal";
import {
  LIMITES_ENTRADA,
  LIMITES_TOTAL,
  LOCALE_ENTRADA,
  MAX_ITENS_ENTRADA,
  MOTIVO_IMPLANTACAO,
  TIPO_ENTRADA,
  TIPO_AJUSTE,
  TIPO_SAIDA,
  chaveDeOperacao,
  comProduto,
  comValor,
  dadosDaTransferencia,
  ehImplantacao,
  erroDoMotivoDaEdicao,
  formularioDaEntrada,
  formularioVazioEntrada,
  formularioVazioTransferencia,
  quantidadeDaTransferencia,
  paraCampo,
  linhaVaziaEntrada,
  mensagemErroEdicaoEntrada,
  mensagemErroEntrada,
  montarCorpoEdicaoEntrada,
  montarCorpoEntrada,
  tiposPermitidos,
  unidadesDoProduto,
  equivalenciaDaLinha,
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
  substituirEntradaEstoque,
  transferirEntreDepositos,
} from "@/services/estoqueEntradasService";
import {
  MAX_ITENS_SAIDA,
  formularioDaSaida,
  formularioVazioSaida,
  linhaVaziaSaida,
  mensagemErroEdicaoSaida,
  mensagemErroSaida,
  montarCorpoEdicaoSaida,
  montarCorpoSaida,
  validarFormularioSaida,
} from "@/lib/estoqueSaidasRegras";
import { criarMotivoSaida, criarSaidaEstoque, editarMotivoSaida, listarMotivosSaida, substituirSaidaEstoque } from "@/services/estoqueSaidasService";
import { formularioVazioAjuste, mensagemErroAjuste, montarCorpoAjuste, validarFormularioAjuste } from "@/lib/estoqueAjustesRegras";
import { criarAjusteEstoque, saldoParaAjuste } from "@/services/estoqueAjustesService";

export const FORMULARIO_NOVO_MOVIMENTO_ID = "formulario-novo-movimento-estoque";

/**
 * O título da tela (o cabeçalho do registro Base1). D-PROD-382: a cópia ("Duplicar") é um movimento NOVO que diz de
 * qual documento veio.
 * @param {{ tipo: string, documento: any } | null | undefined} edicao @param {{ tipo: string, documento: any } | null | undefined} [copia]
 */
export const tituloDoMovimento = (edicao, copia = null) => {
  if (edicao) return `Editar ${edicao.tipo === TIPO_SAIDA ? "saída" : "entrada"} nº ${edicao.documento?.numero ?? ""}`;
  if (copia) return `Novo movimento (cópia da ${copia.tipo === TIPO_SAIDA ? "saída" : "entrada"} nº ${copia.documento?.numero ?? ""})`;
  return "Novo movimento de estoque";
};

/**
 * D-PROD-382 — "Duplicar": o formulário de um movimento NOVO com os dados do documento copiado, com a data de hoje e
 * (na entrada) sem o número do documento, porque a nota da cópia é outra. Nada da versão, do id ou do histórico vai junto.
 * @param {any} documento @param {string} hoje
 */
export const formularioDaCopiaEntrada = (documento, hoje) => ({ ...formularioDaEntrada(documento), data_entrada: hoje, documento_numero: "" });
/** @param {any} documento @param {string} hoje */
export const formularioDaCopiaSaida = (documento, hoje) => ({ ...formularioDaSaida(documento), data_saida: hoje });
const CHAVE_MOTIVOS = ["estoque", "motivos-entrada"];
const CHAVE_MOTIVOS_SAIDA = ["estoque", "motivos-saida"];

/** Área de texto Base1. @param {{ label: string, value: string, onChange: (v: string) => void, testId?: string, required?: boolean, erro?: string }} props */
function Observacao({ label, value, onChange, testId = undefined, required = false, erro = undefined }) {
  return (
    <B1Field label={label} span={12} required={required} error={erro} hasValue={Boolean(String(value ?? "").trim())}>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} maxLength={500} rows={2} data-testid={testId} className="mg-input min-w-0 w-full normal-case" />
    </B1Field>
  );
}

/** @param {any} o */
// D-PROD-282: o produto leva o controle de lote/validade (a entrada exige; a saída oferece a escolha de lote).
const opcaoProduto = (o) => (o ? { id: String(o.id), rotulo: String(o.nome ?? ""), unidade_estoque: o.unidade_estoque, peso_por_saco_kg: o.peso_por_saco_kg ?? null, unidades_conversao: Array.isArray(o.unidades_conversao) ? o.unidades_conversao : [], controla_lote: o.controla_lote === true, controla_validade: o.controla_validade === true } : null);
/** @param {any} o */
const opcaoSimples = (o) => (o ? { id: String(o.id), rotulo: String(o.nome ?? "") } : null);

/**
 * O motivo vigente entra nas opções mesmo se foi desativado depois (na edição, o seletor mostra o que está gravado).
 * @param {any[]} motivos @param {{ id: string, nome: string } | null} atual
 */
const opcoesDeMotivo = (motivos, atual) => {
  const opcoes = motivos.map((/** @type {any} */ m) => ({ value: m.id, label: m.nome }));
  return atual?.id && !opcoes.some((o) => o.value === atual.id) ? [{ value: atual.id, label: atual.nome }, ...opcoes] : opcoes;
};

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

/** "Total · 2 produtos". @param {number} n */
const rotuloTotal = (n) => `Total · ${n} ${n === 1 ? "produto" : "produtos"}`;

const COLUNAS_ENTRADA = [
  { id: "produto", titulo: "Produto", largura: 220 },
  { id: "unidade", titulo: "Unidade", largura: 100 },
  { id: "deposito", titulo: "Local de estoque", largura: 190 },
  { id: "quantidade", titulo: "Quantidade", numero: true, largura: 110 },
  { id: "custo", titulo: "Valor unitário (R$)", numero: true, largura: 130 },
  { id: "total", titulo: "Valor total (R$)", numero: true, largura: 130 },
  { id: "sem_custo", titulo: "Sem custo", largura: 90 },
  { id: "lote", titulo: "Lote", largura: 120 },
  { id: "validade", titulo: "Validade", largura: 150 },
];

/**
 * Uma célula da linha de produto da ENTRADA: produto, unidade, depósito, quantidade, valor unitário, valor total (um
 * calcula o outro), "Sem custo", lote e validade. A linha é uma linha da `TabelaProdutosMovimento` (D-PROD-285).
 * @param {{ linha: any, indice: number, empresaId: string, erros: Record<string, string>, onMudar: (l: any) => void }} p
 * @param {string} coluna
 */
function celulaDeEntrada({ linha, indice, empresaId, erros, onMudar }, coluna) {
  const e = (/** @type {string} */ campo) => erros[`itens.${indice}.${campo}`] || undefined;
  // D-PROD-288: a de estoque e as unidades de conversão com uso em compra/entrada.
  const unidades = unidadesDoProduto(linha.produto, "compra");
  const por = linha.unidade === "SACO" ? "saco" : linha.unidade === "L" ? "litro" : linha.unidade && linha.unidade !== "KG" ? linha.unidade : "kg";
  switch (coluna) {
    case "produto":
      return (
        <SeletorPaginadoGestao
          rotulo="Produto"
          testId={`entrada-linha-${indice}-produto`}
          chave={["estoque", "entrada-produtos", empresaId]}
          buscar={({ q, cursor, limit }) => listarProdutosDaEntrada(empresaId, { q, cursor, limit })}
          value={linha.produto ? { id: linha.produto.id, rotulo: linha.produto.rotulo } : null}
          onChange={(o) => onMudar(comProduto(linha, opcaoProduto(o), "compra"))}
          detalheDaOpcao={(o) => (o?.codigo ? String(o.codigo) : null)}
          obrigatorio
          erro={e("produto")}
          span={12}
        />
      );
    case "unidade":
      return (
        <CampoSelect
          label="Unidade"
          value={linha.unidade}
          onChange={(v) => onMudar({ ...linha, unidade: v })}
          options={unidades}
          readOnly={unidades.length <= 1}
          required
          error={e("unidade")}
          span={4}
          placeholder={linha.produto ? undefined : "Escolha o produto"}
        />
      );
    case "deposito":
      return (
        <SeletorPaginadoGestao
          rotulo="Local de estoque"
          testId={`entrada-linha-${indice}-deposito`}
          chave={["estoque", "entrada-depositos"]}
          buscar={({ q, cursor, limit }) => listarDepositosDaEntrada({ q, cursor, limit })}
          value={linha.deposito}
          onChange={(o) => onMudar({ ...linha, deposito: opcaoSimples(o) })}
          obrigatorio
          erro={e("deposito")}
          span={8}
        />
      );
    case "quantidade":
      return (
        <>
        <CampoNumero
          label="Quantidade"
          value={linha.quantidade}
          onChange={(v) => onMudar(comValor(linha, "quantidade", v))}
          locale={LOCALE_ENTRADA}
          limites={LIMITES_ENTRADA}
          required
          error={e("quantidade")}
          span={4}
          testId={`entrada-linha-${indice}-quantidade`}
        />
        {/* D-PROD-288: "10 SACO = 250 kg". */}
        {equivalenciaDaLinha(linha) ? (
          <p className="mt-1 text-[12px] text-[var(--mg-text-2,#475569)]" role="status" data-testid={`entrada-linha-${indice}-equivalencia`}>{equivalenciaDaLinha(linha)}</p>
        ) : null}
        </>
      );
    case "custo":
      return (
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
          span={4}
          testId={`entrada-linha-${indice}-custo`}
        />
      );
    case "total":
      return (
        <CampoNumero
          label="Valor total (R$)"
          value={linha.custo_zero ? "" : linha.total}
          onChange={(v) => onMudar(comValor(linha, "total", v))}
          locale={LOCALE_ENTRADA}
          limites={LIMITES_TOTAL}
          casasMin={2}
          readOnly={linha.custo_zero}
          span={4}
          testId={`entrada-linha-${indice}-total`}
        />
      );
    case "sem_custo":
      return (
        <label className="col-span-12 flex min-h-9 items-center gap-2 text-[13px]" data-testid={`entrada-linha-${indice}-sem-custo-rotulo`}>
          <input
            type="checkbox"
            checked={linha.custo_zero}
            onChange={(ev) => onMudar({ ...linha, custo_zero: ev.target.checked, custo: "", total: "" })}
            data-testid={`entrada-linha-${indice}-sem-custo`}
          />
          Sem custo
        </label>
      );
    case "lote":
      return <CampoTexto label="Lote" value={linha.lote} onChange={(v) => onMudar({ ...linha, lote: v })} maxLength={64} span={6} error={e("lote")} required={linha.produto?.controla_lote === true} keepCase />;
    case "validade":
      return (
        <CampoDia
          label="Data de validade"
          value={linha.validade}
          onChange={(v) => onMudar({ ...linha, validade: v })}
          error={e("validade")}
          required={linha.produto?.controla_validade === true}
          span={6}
          testId={`entrada-linha-${indice}-validade`}
        />
      );
    default:
      return null;
  }
}

const COLUNAS_SAIDA = [
  { id: "produto", titulo: "Produto", largura: 240 },
  { id: "unidade", titulo: "Unidade", largura: 100 },
  { id: "deposito", titulo: "Local de estoque", largura: 200 },
  { id: "quantidade", titulo: "Quantidade", numero: true, largura: 120 },
];

/**
 * Uma célula da linha de produto da SAÍDA (D-PROD-264): produto, unidade, depósito e quantidade. Sem valor: o servidor
 * valoriza pelo custo médio do depósito. Os lotes (D-PROD-282) vão na linha de detalhe (`detalheDaSaida`).
 * @param {{ linha: any, indice: number, empresaId: string, erros: Record<string, string>, onMudar: (l: any) => void }} p
 * @param {string} coluna
 */
function celulaDeSaida({ linha, indice, empresaId, erros, onMudar }, coluna) {
  const e = (/** @type {string} */ campo) => erros[`itens.${indice}.${campo}`] || undefined;
  // D-PROD-288: a de estoque e as unidades de conversão com uso em saída.
  const unidades = unidadesDoProduto(linha.produto, "venda");
  switch (coluna) {
    case "produto":
      return (
        <SeletorPaginadoGestao
          rotulo="Produto"
          testId={`saida-linha-${indice}-produto`}
          chave={["estoque", "entrada-produtos", empresaId]}
          buscar={({ q, cursor, limit }) => listarProdutosDaEntrada(empresaId, { q, cursor, limit })}
          value={linha.produto ? { id: linha.produto.id, rotulo: linha.produto.rotulo } : null}
          onChange={(o) => onMudar({ ...comProduto(linha, opcaoProduto(o), "venda"), lotes: null, confirmaVencido: false })}
          detalheDaOpcao={(o) => (o?.codigo ? String(o.codigo) : null)}
          obrigatorio
          erro={e("produto")}
          span={12}
        />
      );
    case "unidade":
      return (
        <CampoSelect
          label="Unidade"
          value={linha.unidade}
          onChange={(v) => onMudar({ ...linha, unidade: v })}
          options={unidades}
          readOnly={unidades.length <= 1}
          required
          error={e("unidade")}
          span={4}
          placeholder={linha.produto ? undefined : "Escolha o produto"}
        />
      );
    case "deposito":
      return (
        <SeletorPaginadoGestao
          rotulo="Local de estoque"
          testId={`saida-linha-${indice}-deposito`}
          chave={["estoque", "entrada-depositos"]}
          buscar={({ q, cursor, limit }) => listarDepositosDaEntrada({ q, cursor, limit })}
          value={linha.deposito}
          onChange={(o) => onMudar({ ...linha, deposito: opcaoSimples(o), lotes: null, confirmaVencido: false })}
          obrigatorio
          erro={e("deposito")}
          span={8}
        />
      );
    case "quantidade":
      return (
        <>
        <CampoNumero
          label="Quantidade"
          value={linha.quantidade}
          onChange={(v) => onMudar({ ...linha, quantidade: v })}
          locale={LOCALE_ENTRADA}
          limites={LIMITES_ENTRADA}
          required
          error={e("quantidade")}
          span={12}
          testId={`saida-linha-${indice}-quantidade`}
        />
        {/* D-PROD-288: "10 SACO = 250 kg". */}
        {equivalenciaDaLinha(linha) ? (
          <p className="mt-1 text-[12px] text-[var(--mg-text-2,#475569)]" role="status" data-testid={`saida-linha-${indice}-equivalencia`}>{equivalenciaDaLinha(linha)}</p>
        ) : null}
        </>
      );
    default:
      return null;
  }
}

/**
 * D-PROD-282: produto com lote — sugestão FEFO, troca, divisão e aviso de vencido, na linha de detalhe da saída.
 * Sem lote (e sem erro de lote), não há detalhe.
 * @param {{ linha: any, indice: number, empresaId: string, erros: Record<string, string>, onMudar: (l: any) => void }} p
 */
function detalheDaSaida({ linha, indice, empresaId, erros, onMudar }) {
  const erroLotes = erros[`itens.${indice}.lotes`] || undefined;
  if (!linha?.produto?.controla_lote && !erroLotes) return null;
  return (
    <>
      <CampoLotesSaida empresaId={empresaId} linha={linha} onMudar={(patch) => onMudar({ ...linha, ...patch })} testId={`saida-linha-${indice}-lotes`} />
      {erroLotes ? <p className="col-span-12 text-[12px] text-red-700" role="alert">{erroLotes}</p> : null}
    </>
  );
}

/**
 * "Novo movimento" do Estoque (D-PROD-259): UMA tela em que se escolhe o TIPO de
 * movimento — Entrada ou Transferência — e preenche o formulário daquele tipo. Tudo aparece junto na lista de
 * Movimentos (não há aba separada). A Entrada tem cabeçalho (data, motivo do cadastro, fornecedor, documento, centro
 * de resultado, centro de custo, observação) e vários produtos; o saldo de implantação esconde fornecedor e documento.
 * A Transferência leva o saldo de um depósito para outro (o mesmo comando do Mapa). Enviar grava de uma vez; o
 * servidor confere tudo e é quem bloqueia. Um reenvio sem resposta reaproveita a mesma `operation_id`.
 * D-PROD-264: a Saída (ação própria `saida`) tem cabeçalho (data, motivo do cadastro de SAÍDA, centros, observação)
 * e vários produtos (produto, depósito, unidade, quantidade), SEM valor: o servidor valoriza pelo custo médio do
 * depósito. O seletor de tipo só oferece o que as ações permitem (Entrada e Transferência com `entrada`, Saída com
 * `saida`); só com `saida`, a janela abre direto na Saída.
 * D-PROD-272: o Ajuste de inventário (ação própria `ajuste`): o usuário digita o saldo CONTADO de cada produto no
 * depósito e vê o saldo atual e a diferença (sobra/falta); sem data (é hoje na fazenda) e sem valor, exceto o custo da
 * sobra num depósito sem saldo. Com um tipo só, a janela já abre nele.
 * D-PROD-271 — MODO EDIÇÃO (`edicao`): a mesma janela abre uma entrada ou uma saída CONFIRMADA com o tipo fixo (sem
 * trocar de tipo), o título "Editar entrada nº N"/"Editar saída nº N", todos os campos preenchidos com a versão
 * vigente e o "Motivo da edição" obrigatório. "Salvar edição" manda o corpo da criação + `versao`, `motivo_edicao` e
 * uma `operation_id` própria (`ent-ed-`/`sai-ed-`), reaproveitada no reenvio do mesmo conteúdo. O servidor estorna e
 * refaz os lançamentos só se nada mexeu depois; se só a observação mudou, ele grava como edição de observação.
 * O Ajuste não tem modo edição (não há edição física do ajuste: só o estorno integral).
 * D-PROD-285: deixou de ser janela (popup): é uma TELA CHEIA no padrão do Motor Base1 — o corpo do registro da
 * `CadastroBase1Screen` de Movimentos (cabeçalho do registro, ✕/✓ na barra, corpo no cartão Base1), como os outros
 * cadastros Base1. Os produtos de Entrada, Saída e Ajuste ficam na tabela da `TabelaProdutosMovimento` (o desenho da
 * tabela "Áreas" da atividade; cartões no celular). Regras, validações e chamadas ao servidor não mudaram.
 * `onEnviando` avisa quem monta a tela quando um envio começa e termina (para travar o ✕/✓ da barra).
 * @param {{ empresaId: string, hoje: string, podeEntrada?: boolean, podeSaida?: boolean, podeAjuste?: boolean, onFechar: () => void,
 *   onEnviando?: (enviando: boolean) => void,
 *   edicao?: { tipo: 'entrada'|'saida', documento: any } | null,
 *   copia?: { tipo: 'entrada'|'saida', documento: any } | null,
 *   onLancado: (r: { tipo: string, entrada?: any, saida?: any, ajuste?: any, editada?: boolean }) => void }} props
 */
export default function TelaNovoMovimentoEstoque({ empresaId, hoje, podeEntrada = true, podeSaida = false, podeAjuste = false, edicao = null, copia = null, onFechar, onLancado, onEnviando = undefined }) {
  const celular = useCelular();
  const tipos = tiposPermitidos({ entrada: podeEntrada, saida: podeSaida, ajuste: podeAjuste });
  const [tipo, setTipo] = useState(() => edicao?.tipo ?? copia?.tipo ?? tipos[0]?.value ?? TIPO_ENTRADA);
  const [modoMotivos, setModoMotivos] = useState(/** @type {null | 'entrada' | 'saida'} */ (null));
  const [entrada, setEntrada] = useState(() =>
    edicao?.tipo === TIPO_ENTRADA ? formularioDaEntrada(edicao.documento) : copia?.tipo === TIPO_ENTRADA ? formularioDaCopiaEntrada(copia.documento, hoje) : formularioVazioEntrada(hoje));
  const [saida, setSaida] = useState(() =>
    edicao?.tipo === TIPO_SAIDA ? formularioDaSaida(edicao.documento) : copia?.tipo === TIPO_SAIDA ? formularioDaCopiaSaida(copia.documento, hoje) : formularioVazioSaida(hoje));
  const [ajuste, setAjuste] = useState(() => formularioVazioAjuste());
  const [motivoEdicao, setMotivoEdicao] = useState("");
  const [transf, setTransf] = useState(() => formularioVazioTransferencia(hoje));
  // D-PROD-310: as unidades do produto da transferência e a conta da quantidade para a unidade de estoque.
  const unidadesTransf = unidadesDoProduto(transf.produto);
  const transfConta = quantidadeDaTransferencia(transf);
  const [erros, setErros] = useState(/** @type {Record<string, string>} */ ({}));
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState(/** @type {string|null} */ (null));
  const operacao = useRef(/** @type {{ conteudo: string, id: string } | null} */ (null));

  const editando = Boolean(edicao);
  const motivosQuery = useQuery({ queryKey: [...CHAVE_MOTIVOS, "ativos"], queryFn: () => listarMotivosEntrada({ ativos: true }), staleTime: 30 * 1000, enabled: podeEntrada && (!editando || tipo === TIPO_ENTRADA) });
  const motivos = motivosQuery.data ?? [];
  const motivosSaidaQuery = useQuery({ queryKey: [...CHAVE_MOTIVOS_SAIDA, "ativos"], queryFn: () => listarMotivosSaida({ ativos: true }), staleTime: 30 * 1000, enabled: podeSaida && (!editando || tipo === TIPO_SAIDA) });
  const motivosSaida = motivosSaidaQuery.data ?? [];
  // Saldo atual (e custo médio) de cada linha do ajuste que já tem produto e depósito.
  const saldosQueries = useQueries({
    queries: ajuste.itens.map((/** @type {any} */ l) => ({
      queryKey: ["estoque", "ajuste-saldo", empresaId, l.produto?.id ?? null, l.deposito?.id ?? null],
      queryFn: () => saldoParaAjuste(empresaId, l.produto.id, l.deposito.id),
      enabled: podeAjuste && tipo === TIPO_AJUSTE && Boolean(l.produto?.id && l.deposito?.id),
      staleTime: 15 * 1000,
      refetchOnWindowFocus: false,
    })),
  });
  const saldosAjuste = saldosQueries.map((q) => q.data ?? null);
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
  /** @param {Record<string, any>} mudanca */
  const mudarSaida = (mudanca) => {
    setSaida((f) => ({ ...f, ...mudanca }));
    setErroEnvio(null);
  };
  /** @param {Record<string, any>} mudanca */
  const mudarAjuste = (mudanca) => {
    setAjuste((f) => ({ ...f, ...mudanca }));
    setErroEnvio(null);
  };
  /** @param {number} i @param {any} linha */
  const mudarLinhaSaida = (i, linha) => mudarSaida({ itens: saida.itens.map((l, j) => (j === i ? linha : l)) });

  /** @param {string} prefixo @param {unknown} conteudo */
  const idDaOperacao = (prefixo, conteudo) => {
    const texto = JSON.stringify(conteudo);
    if (!operacao.current || operacao.current.conteudo !== texto) operacao.current = { conteudo: texto, id: chaveDeOperacao(prefixo) };
    return operacao.current.id;
  };

  const enviar = async (/** @type {React.FormEvent} */ evento) => {
    evento.preventDefault();
    if (enviando) return;
    if (tipo === TIPO_ENTRADA || tipo === TIPO_SAIDA) {
      const { erros: achados, ok } = tipo === TIPO_ENTRADA ? validarFormularioEntrada(entrada, hoje) : validarFormularioSaida(saida, hoje);
      const faltaMotivo = editando ? erroDoMotivoDaEdicao(motivoEdicao) : null;
      setErros(faltaMotivo ? { ...achados, motivo_edicao: faltaMotivo } : achados);
      if (!ok || faltaMotivo) return;
    } else if (tipo === TIPO_AJUSTE) {
      const { erros: achados, ok } = validarFormularioAjuste(ajuste, saldosAjuste);
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
      if (edicao && tipo === TIPO_ENTRADA) {
        const dados = { versao: edicao.documento.versao, motivoEdicao };
        const id = idDaOperacao("ent-ed", montarCorpoEdicaoEntrada(empresaId, entrada, dados, ""));
        const editada = await substituirEntradaEstoque(String(edicao.documento.id), montarCorpoEdicaoEntrada(empresaId, entrada, dados, id));
        onLancado({ tipo, entrada: editada, editada: true });
      } else if (edicao && tipo === TIPO_SAIDA) {
        const dados = { versao: edicao.documento.versao, motivoEdicao };
        const id = idDaOperacao("sai-ed", montarCorpoEdicaoSaida(empresaId, saida, dados, ""));
        const editada = await substituirSaidaEstoque(String(edicao.documento.id), montarCorpoEdicaoSaida(empresaId, saida, dados, id));
        onLancado({ tipo, saida: editada, editada: true });
      } else if (tipo === TIPO_ENTRADA) {
        const id = idDaOperacao("ent", montarCorpoEntrada(empresaId, entrada, ""));
        const criada = await criarEntradaEstoque(montarCorpoEntrada(empresaId, entrada, id));
        onLancado({ tipo, entrada: criada });
      } else if (tipo === TIPO_SAIDA) {
        const id = idDaOperacao("sai", montarCorpoSaida(empresaId, saida, ""));
        const criada = await criarSaidaEstoque(montarCorpoSaida(empresaId, saida, id));
        onLancado({ tipo, saida: criada });
      } else if (tipo === TIPO_AJUSTE) {
        const id = idDaOperacao("aju", montarCorpoAjuste(empresaId, ajuste, "", saldosAjuste));
        const criado = await criarAjusteEstoque(montarCorpoAjuste(empresaId, ajuste, id, saldosAjuste));
        onLancado({ tipo, ajuste: criado });
      } else {
        const id = idDaOperacao("trf", dadosDaTransferencia(transf, ""));
        await transferirEntreDepositos(empresaId, dadosDaTransferencia(transf, id));
        onLancado({ tipo });
      }
    } catch (erro) {
      const oQue = { [TIPO_ENTRADA]: "a entrada", [TIPO_SAIDA]: "a saída", [TIPO_AJUSTE]: "o ajuste" }[tipo] ?? "a transferência";
      const padrao = editando
        ? `Não foi possível salvar a edição d${oQue}. Verifique a conexão e tente de novo.`
        : `Não foi possível lançar ${oQue}. Verifique a conexão e tente de novo.`;
      const vigentes = Array.isArray(edicao?.documento?.itens) ? edicao.documento.itens : [];
      if (editando) setErroEnvio(tipo === TIPO_SAIDA ? mensagemErroEdicaoSaida(erro, padrao, saida.itens, vigentes) : mensagemErroEdicaoEntrada(erro, padrao, vigentes));
      else {
        setErroEnvio(
          tipo === TIPO_SAIDA ? mensagemErroSaida(erro, padrao, saida.itens) : tipo === TIPO_AJUSTE ? mensagemErroAjuste(erro, padrao, ajuste.itens) : mensagemErroEntrada(erro, padrao),
        );
      }
    } finally {
      setEnviando(false);
    }
  };

  useEffect(() => {
    onEnviando?.(enviando);
  }, [enviando, onEnviando]);

  const totalEntrada = tipo === TIPO_ENTRADA ? totalDasLinhas(entrada.itens) : "";

  const rodape = modoMotivos ? null : (
    <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-[var(--mg-divider,#E8E7E2)] pt-3" data-testid="movimento-acoes">
      <button type="button" className="tb-btn" onClick={onFechar} disabled={enviando} data-testid="movimento-cancelar">
        Cancelar
      </button>
      <button type="submit" form={FORMULARIO_NOVO_MOVIMENTO_ID} className="tb-btn tb-btn-green" disabled={enviando} data-testid="movimento-lancar">
        {enviando ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
        {editando
          ? enviando ? "Salvando…" : "Salvar edição"
          : enviando ? "Lançando…" : tipo === TIPO_ENTRADA ? "Lançar entrada" : tipo === TIPO_SAIDA ? "Lançar saída" : tipo === TIPO_AJUSTE ? "Lançar ajuste" : "Lançar transferência"}
      </button>
    </div>
  );

  const titulo = tituloDoMovimento(edicao, copia);
  return (
    <div className="min-w-0" data-testid="tela-novo-movimento-estoque" aria-label={titulo}>
      <CadastroFormShell embedded>
      {/* Registro sem abas: no computador a Base1 tira a faixa do cabeçalho, então o título fica no cartão; no celular ele já está na casca. */}
      {celular ? null : (
        <div className="mg-b1-form-header mb-2">
          <h2 className="mg-card-title" data-testid="movimento-titulo">{titulo}</h2>
        </div>
      )}
      {modoMotivos === "entrada" ? (
        <CadastroMotivosEstoque
          titulo="Motivos de entrada"
          explicacao={'O motivo diz por que o produto entrou. "Saldo de implantação" é fixo e só vale para produto que ainda não tem movimento.'}
          chave={CHAVE_MOTIVOS}
          listar={() => listarMotivosEntrada()}
          criar={criarMotivoEntrada}
          editar={editarMotivoEntrada}
          mensagemErro={mensagemErroEntrada}
          rotuloVoltar="Voltar para a entrada"
          testId="motivos-entrada"
          onVoltar={() => setModoMotivos(null)}
        />
      ) : modoMotivos === "saida" ? (
        <CadastroMotivosEstoque
          titulo="Motivos de saída"
          explicacao="O motivo diz por que o produto saiu do estoque (perda, consumo interno, doação, vencimento…). Desative o que não usa; o que já foi lançado continua com o motivo dele."
          chave={CHAVE_MOTIVOS_SAIDA}
          listar={() => listarMotivosSaida()}
          criar={criarMotivoSaida}
          editar={editarMotivoSaida}
          mensagemErro={(erro, padrao) => mensagemErroSaida(erro, padrao)}
          rotuloVoltar="Voltar para a saída"
          testId="motivos-saida"
          onVoltar={() => setModoMotivos(null)}
        />
      ) : (
        <form id={FORMULARIO_NOVO_MOVIMENTO_ID} onSubmit={enviar} noValidate className="mg-b1-form-grid grid grid-cols-12 gap-x-3 gap-y-2" data-testid="formulario-novo-movimento">
          {/* Com um tipo só (só a ação `saida`), não há o que escolher: a janela já abre nele. Na edição o tipo é fixo. */}
          {tipos.length > 1 && !editando ? (
            <EscolhaSegmentada
              rotulo="Tipo de movimento"
              testId="movimento-tipo"
              opcoes={tipos.map((t) => ({ value: t.value, label: t.label }))}
              value={tipo}
              onChange={(v) => {
                setTipo(v);
                setErros({});
                setErroEnvio(null);
              }}
            />
          ) : null}

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
                options={opcoesDeMotivo(motivos, entrada.motivo)}
                required
                error={erros.motivo}
                span={6}
                placeholder={motivosQuery.isLoading ? "Carregando…" : undefined}
              />
              <div className="col-span-12 flex items-end md:col-span-2">
                <button type="button" className="tb-btn w-full" onClick={() => setModoMotivos("entrada")} data-testid="entrada-gerenciar-motivos">
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
              <TabelaProdutosMovimento
                prefixo="entrada"
                linhas={entrada.itens}
                colunas={COLUNAS_ENTRADA}
                celula={(linha, i, coluna) => celulaDeEntrada({ linha, indice: i, empresaId, erros, onMudar: (l) => mudarLinha(i, l) }, coluna)}
                podeRemover={entrada.itens.length > 1}
                onRemover={(i) => mudarEntrada({ itens: entrada.itens.filter((_, j) => j !== i) })}
                total={{ rotulo: rotuloTotal(entrada.itens.length), porColuna: { total: totalEntrada ? formatarReais(totalEntrada) : "—" } }}
                celular={celular}
              />
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
          ) : tipo === TIPO_SAIDA ? (
            <>
              <SecaoForm titulo="Saída" />
              <CampoDia label="Data de saída" value={saida.data_saida} onChange={(v) => mudarSaida({ data_saida: v })} max={hoje} required error={erros.data_saida} span={4} testId="saida-data" />
              <CampoSelect
                label="Motivo"
                value={saida.motivo?.id ?? ""}
                onChange={(v) => {
                  const m = motivosSaida.find((/** @type {any} */ x) => x.id === v) ?? null;
                  mudarSaida({ motivo: m ? { id: m.id, nome: m.nome } : null });
                }}
                options={opcoesDeMotivo(motivosSaida, saida.motivo)}
                required
                error={erros.motivo}
                span={6}
                placeholder={motivosSaidaQuery.isLoading ? "Carregando…" : undefined}
              />
              <div className="col-span-12 flex items-end md:col-span-2">
                <button type="button" className="tb-btn w-full" onClick={() => setModoMotivos("saida")} data-testid="saida-gerenciar-motivos">
                  Motivos…
                </button>
              </div>
              <SeletorPaginadoGestao
                rotulo="Centro de resultado"
                testId="saida-centro-resultado"
                chave={["estoque", "entrada-centros-resultado", empresaId]}
                buscar={({ q, cursor, limit }) => listarCentrosDaEntrada("resultado", empresaId, { q, cursor, limit })}
                value={saida.centro_resultado}
                onChange={(o) => mudarSaida({ centro_resultado: opcaoSimples(o) })}
                permitirLimpar
                span={6}
              />
              <SeletorPaginadoGestao
                rotulo="Centro de custo"
                testId="saida-centro-custo"
                chave={["estoque", "entrada-centros-custo", empresaId]}
                buscar={({ q, cursor, limit }) => listarCentrosDaEntrada("custo", empresaId, { q, cursor, limit })}
                value={saida.centro_custo}
                onChange={(o) => mudarSaida({ centro_custo: opcaoSimples(o) })}
                permitirLimpar
                span={6}
              />
              <Observacao label="Observação" value={saida.observacao} onChange={(v) => mudarSaida({ observacao: v })} testId="saida-observacao" />

              <SecaoForm titulo="Produtos" />
              <TabelaProdutosMovimento
                prefixo="saida"
                linhas={saida.itens}
                colunas={COLUNAS_SAIDA}
                celula={(linha, i, coluna) => celulaDeSaida({ linha, indice: i, empresaId, erros, onMudar: (l) => mudarLinhaSaida(i, l) }, coluna)}
                detalhe={(linha, i) => detalheDaSaida({ linha, indice: i, empresaId, erros, onMudar: (l) => mudarLinhaSaida(i, l) })}
                podeRemover={saida.itens.length > 1}
                onRemover={(i) => mudarSaida({ itens: saida.itens.filter((_, j) => j !== i) })}
                total={{ rotulo: rotuloTotal(saida.itens.length) }}
                celular={celular}
              />
              {erros.itens ? <p className="col-span-12 text-[12px] text-red-800">{erros.itens}</p> : null}
              <div className="col-span-12 flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  className="tb-btn"
                  disabled={saida.itens.length >= MAX_ITENS_SAIDA}
                  onClick={() => mudarSaida({ itens: [...saida.itens, linhaVaziaSaida()] })}
                  data-testid="saida-adicionar-produto"
                >
                  <Plus size={14} aria-hidden /> Adicionar produto
                </button>
              </div>
              <p className="col-span-12 text-[12px] text-[var(--mg-text-2,#475569)]" data-testid="saida-aviso-custo">
                Não se digita valor: a saída é valorizada pelo custo médio do produto no depósito. O servidor confere se há saldo suficiente.
              </p>
            </>
          ) : tipo === TIPO_AJUSTE ? (
            <CamposAjusteEstoque
              ajuste={ajuste}
              empresaId={empresaId}
              hoje={hoje}
              erros={erros}
              saldos={saldosQueries}
              observacao={<Observacao label="Observação" value={ajuste.observacao} onChange={(v) => mudarAjuste({ observacao: v })} testId="ajuste-observacao" />}
              onMudar={mudarAjuste}
            />
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
                onChange={(o) => mudarTransf({ produto: opcaoProduto(o), unidade: "", lotes: null, confirmaVencido: false })}
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
                onChange={(o) => mudarTransf({ origem: opcaoSimples(o), lotes: null, confirmaVencido: false })}
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
              {/* D-PROD-310: a unidade ao lado da quantidade — a de estoque e as conversões ATIVAS do produto. */}
              {unidadesTransf.length > 1 ? (
                <CampoSelect
                  label="Unidade"
                  value={transfConta.unidade ?? unidadesTransf[0].value}
                  onChange={(v) => mudarTransf({ unidade: v, lotes: null, confirmaVencido: false })}
                  options={unidadesTransf}
                  span={6}
                />
              ) : null}
              <CampoNumero
                label={`Quantidade (${transfConta.unidade ?? (transf.produto?.unidade_estoque === "L" ? "litros" : "kg")})`}
                value={transf.quantidade}
                onChange={(v) => mudarTransf({ quantidade: v })}
                locale={LOCALE_ENTRADA}
                limites={LIMITES_ENTRADA}
                required
                error={erros.quantidade}
                span={6}
                testId="transferencia-quantidade"
              />
              {transfConta.unidade && transfConta.quantidade ? (
                <p className="col-span-12 text-[12px] text-[var(--mg-text-2,#475569)]" data-testid="transferencia-conversao">
                  = {Number(transfConta.quantidade).toLocaleString("pt-BR", { maximumFractionDigits: 4 })} {transf.produto?.unidade_estoque === "L" ? "L" : "kg"}
                </p>
              ) : null}
              {/* D-PROD-282: a transferência leva o lote (e a validade) para o destino. D-PROD-310: os lotes são na unidade de estoque. */}
              <CampoLotesSaida
                empresaId={empresaId}
                linha={{ ...transf, deposito: transf.origem, unidade: "KG", quantidade: transfConta.unidade ? (transfConta.quantidade ? paraCampo(transfConta.quantidade) : "") : transf.quantidade }}
                onMudar={(patch) => mudarTransf(patch)}
                testId="transferencia-lotes"
              />
              {transfConta.unidade && transf.produto?.controla_lote ? (
                <p className="col-span-12 text-[12px] text-[var(--mg-text-2,#475569)]" data-testid="transferencia-lotes-em-estoque">
                  As quantidades dos lotes são em {transf.produto?.unidade_estoque === "L" ? "L" : "kg"} (a unidade de estoque).
                </p>
              ) : null}
              {erros.lotes ? <p className="col-span-12 text-[12px] text-red-700" role="alert">{erros.lotes}</p> : null}
              <Observacao label="Observação" value={transf.observacao} onChange={(v) => mudarTransf({ observacao: v })} testId="transferencia-observacao" />
              <p className="col-span-12 text-[12px] text-[var(--mg-text-2,#475569)]">
                O saldo sai do local de origem e entra no de destino com o mesmo custo médio. O servidor confere se há saldo suficiente.
              </p>
            </>
          )}

          {editando ? (
            <>
              <SecaoForm titulo="Edição" />
              <Observacao
                label="Motivo da edição"
                value={motivoEdicao}
                onChange={(v) => {
                  setMotivoEdicao(v);
                  setErroEnvio(null);
                }}
                required
                erro={erros.motivo_edicao || undefined}
                testId="movimento-motivo-edicao"
              />
              <p className="col-span-12 text-[12px] text-[var(--mg-text-2,#475569)]" data-testid="movimento-aviso-edicao">
                {tipo === TIPO_SAIDA
                  ? "Ao salvar, os lançamentos de estoque desta saída são estornados e refeitos com os dados novos. Só é possível se o produto não teve outro movimento naquele depósito depois dela."
                  : "Ao salvar, os lançamentos de estoque desta entrada são estornados e refeitos com os dados novos. Só é possível se nada mexeu no estoque dela depois."}{" "}
                O número continua o mesmo.
              </p>
            </>
          ) : null}

          {erroEnvio ? (
            <div className="col-span-12" role="alert" data-testid="movimento-erro">
              <AvisoGestao>{erroEnvio}</AvisoGestao>
            </div>
          ) : null}
        </form>
      )}
      {rodape}
      </CadastroFormShell>
    </div>
  );
}

