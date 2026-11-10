import React, { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Eye } from "lucide-react";
import CadastroFormShell from "@/components/cadastro/base1/CadastroFormShell";
import { AvisoGestao, CampoSelect, CampoTexto, SecaoForm } from "@/components/gestao/GestaoFormParts";
import { CampoDia, CampoNumero, EscolhaSegmentada } from "@/components/financeiroGestao/CamposLancamento";
import SeletorPaginadoGestao from "@/components/financeiroGestao/SeletorPaginadoGestao";
import { CampoTextoLongo } from "@/components/patrimonio/PatrimonioFormParts";
import { useAcoesTelaPatrimonio } from "@/hooks/usePatrimonioSessao";
import { TELAS_PATRIMONIO } from "@/lib/patrimonioPermissions";
import { listarOpcoesAbastecimento, listarProdutosDoBem } from "@/services/abastecimentoService";
import { mensagemErroAbastecimento } from "@/lib/patrimonioErros";
import {
  LIMITES_ABASTECIMENTO,
  LOCALE_ABASTECIMENTO,
  ROTULO_LEITURA,
  UNIDADE_MEDIDOR,
  formatarDiaAbastecimento,
  formatarLeitura,
  formatarLitrosCurto,
  medidorDoFormulario,
  medidorExigeLeitura,
  opcaoNoFormulario,
  produtoAutomatico,
  rotuloDoBem,
  situacaoDaEscolha,
} from "@/lib/abastecimentoRegras";
import { BOTAO_PRIMARIO, BOTAO_SECUNDARIO } from "@/components/patrimonio/DialogosAbastecimento";

export const FORMULARIO_ABASTECIMENTO_ID = "formulario-abastecimento";

/** Chaves das leituras do formulário (prefixo da tela: confirmar/cancelar/recusas invalidam). */
export const chaveProdutosDoBem = (/** @type {string|null} */ empresaId, /** @type {string|null} */ bemId) => ["patrimonio-abastecimentos", "produtos-do-bem", empresaId, bemId];
export const chaveLocais = (/** @type {string|null} */ empresaId, /** @type {string|null} */ produtoId) => ["patrimonio-abastecimentos", "locais", empresaId, produtoId];

/** Até este número de Produtos (resposta completa) a escolha é por botões; acima, seletor com busca. */
export const MAXIMO_PRODUTOS_EM_BOTOES = 6;

const ROTULO_NATUREZA_CURTO = /** @type {Record<string, string>} */ ({ MAQUINA: "Máquina", VEICULO: "Veículo", EQUIPAMENTO: "Equipamento" });

/** Texto de cada motivo de "nenhum Produto" do servidor (`resumo.motivo_sem_opcao`). */
export const TEXTO_SEM_PRODUTO = Object.freeze(
  /** @type {Record<string, string>} */ ({
    bem_inativo: "Este bem está inativo: reative-o no cadastro de Bens para abastecer.",
    sem_tanque_ativo: "Este bem não tem tanque ativo. Cadastre ou reative um tanque no cadastro do bem.",
    tanque_sem_combustivel: "Os tanques deste bem não têm combustível permitido ativo em litros. Ajuste os combustíveis permitidos no cadastro do bem.",
    nenhum_produto_associado: "Nenhum Produto desta fazenda está associado aos combustíveis deste bem. Associe um Produto ao combustível no cadastro de Combustíveis.",
    produto_unidade_nao_kg: "O Produto associado tem estoque em outra unidade (não KG): o abastecimento só baixa estoque em KG. Ajuste a unidade de estoque do Produto.",
  }),
);

/** Campos que dependem do bem / do Produto (trocar um limpa os seguintes). */
const SEM_PRODUTO = Object.freeze({ produto: null, tipo_combustivel_id: null, tanque_id: null, local_estoque_id: null });

/** Rótulo do Produto na escolha (o NOME real do Produto; nunca o do combustível). @param {any} item */
const rotuloDoProduto = (item) => {
  const nome = String(item?.produto?.nome ?? "");
  return item?.pronto === true ? nome : `${nome} (sem fator kg/L)`;
};

/** "Tanque principal (180 L)". @param {any} t */
const rotuloDoTanque = (t) => {
  const nome = String(t?.identificador ?? "");
  return t?.capacidade_litros ? `${nome} (${formatarLitrosCurto(t.capacidade_litros)} L)` : nome;
};

/** O que da opção a tela reflete no formulário (fator, pronto, tanques): mudou → reaplica. @param {any} p */
const assinaturaDaOpcao = (p) =>
  JSON.stringify([p?.conversao?.id ?? null, p?.conversao?.versao ?? null, p?.pronto === true, (Array.isArray(p?.tanques) ? p.tanques : []).map((/** @type {any} */ t) => [t.id, t.capacidade_litros])]);

/** @param {{ texto: string|undefined }} props */
function ErroDoCampo({ texto }) {
  return texto ? <p className="col-span-12 -mt-1 text-[12px] text-red-700">{texto}</p> : null;
}

/**
 * Formulário do NOVO abastecimento (o estado vive na tela). UX-02 (D-PROD-160):
 * Máquina/Veículo → PRODUTO (o nome real do estoque; o tipo de combustível vem
 * da opção do SERVIDOR, derivado do vínculo ativo, e nunca é etapa da tela) →
 * tanque (só se o Produto cabe em mais de um) → local (automático com um só) →
 * data, litros, medidor → "Completou o tanque?" → Mais detalhes → Revisar.
 * Trocar um campo limpa os que dependem dele. Nada é gravado aqui: "Revisar
 * abastecimento" pede a prévia ao servidor.
 * @param {{
 *   empresaId: string,
 *   form: any,
 *   setForm: (atualizar: (f: any) => any) => void,
 *   hoje: string,
 *   erros: Record<string, string>,
 *   limparErro: (campo: string) => void,
 *   podeConfigurarFator: boolean,
 *   previando: boolean,
 *   situacaoPrevia: 'nenhuma'|'valida'|'invalidada',
 *   onPrevia: () => void,
 *   onReabrirPrevia: () => void,
 *   onConfigurarFator: (par: { tipo: { id: string, nome: string } | null, produto: { id: string, nome: string, conversao: any } | null }) => void,
 * }} props
 */
export default function FormularioAbastecimento({
  empresaId,
  form,
  setForm,
  hoje,
  erros,
  limparErro,
  podeConfigurarFator,
  previando,
  situacaoPrevia,
  onPrevia,
  onReabrirPrevia,
  onConfigurarFator,
}) {
  const bemId = form.bem?.id ? String(form.bem.id) : null;
  const produtoId = form.produto?.id ? String(form.produto.id) : null;
  const tipoId = form.tipo_combustivel_id ? String(form.tipo_combustivel_id) : null;
  const acoesCombustiveis = useAcoesTelaPatrimonio(TELAS_PATRIMONIO.COMBUSTIVEIS);
  const [indisponivel, setIndisponivel] = useState(false);
  const [maisDetalhes, setMaisDetalhes] = useState(() => Boolean(String(form.observacao ?? "").trim() || String(form.referencia_externa ?? "").trim()));

  /** @param {Record<string, any>} mudanca @param {string[]} campos */
  const mudar = (mudanca, campos) => {
    setForm((f) => ({ ...f, ...mudanca }));
    for (const c of campos) limparErro(c);
  };
  /** Aplica a opção de Produto do servidor (tipo e tanques vêm dela). @param {any} item */
  const escolherProduto = (item) => {
    setIndisponivel(false);
    setForm((f) => opcaoNoFormulario(f, item));
    for (const c of ["produto", "tanque_id", "local_estoque_id"]) limparErro(c);
  };

  // Decisão da escolha: 1ª página SEM busca, a maior permitida (100). `has_more` manda.
  const produtosQuery = useQuery({
    queryKey: chaveProdutosDoBem(empresaId, bemId),
    queryFn: () => listarProdutosDoBem(empresaId, bemId, { limit: 100 }),
    enabled: Boolean(empresaId && bemId),
    staleTime: 15 * 1000,
  });
  const resposta = /** @type {any} */ (produtosQuery.data ?? null);
  // Só vale a resposta DO BEM atual (nunca a de um bem anterior).
  const respostaDoBem = resposta && bemId && String(resposta.bem?.id ?? "") === bemId ? resposta : null;
  const itens = /** @type {any[]} */ (Array.isArray(respostaDoBem?.itens) ? respostaDoBem.itens : []);
  const resumo = /** @type {any} */ (respostaDoBem?.resumo ?? null);
  const completa = respostaDoBem?.has_more === false;
  const modoBotoes = completa && itens.length > 0 && itens.length <= MAXIMO_PRODUTOS_EM_BOTOES;
  const semProduto = Boolean(respostaDoBem) && !itens.length && (resumo?.total === 0 || completa);

  const locaisQuery = useQuery({
    queryKey: chaveLocais(empresaId, produtoId),
    queryFn: () => listarOpcoesAbastecimento("locais", empresaId, { produtoId }),
    enabled: Boolean(empresaId && produtoId),
    staleTime: 15 * 1000,
  });
  const locais = /** @type {any[]} */ (locaisQuery.data?.itens ?? []);

  // Um só Produto (resposta COMPLETA do bem atual): já vem escolhido.
  useEffect(() => {
    const item = produtoAutomatico(respostaDoBem, bemId);
    if (item) setForm((f) => (f.bem?.id && String(f.bem.id) === bemId && !f.produto ? opcaoNoFormulario(f, item) : f));
  }, [respostaDoBem, bemId, setForm]);

  // A escolha ainda está nas opções? Saiu (vínculo inativado, produto inativo…) → limpa e avisa;
  // continua mas o servidor mudou fator/tanques → reaplica a opção nova.
  useEffect(() => {
    const situacao = situacaoDaEscolha(respostaDoBem, form);
    if (situacao === "ausente") {
      setIndisponivel(true);
      setForm((f) => (String(f.produto?.id ?? "") === produtoId && String(f.tipo_combustivel_id ?? "") === tipoId ? { ...f, ...SEM_PRODUTO } : f));
      return;
    }
    if (situacao !== "presente") return;
    const item = itens.find((i) => String(i?.produto?.id ?? "") === produtoId && String(i?.tipo_combustivel?.id ?? "") === tipoId);
    if (item && assinaturaDaOpcao(item) !== assinaturaDaOpcao(form.produto)) {
      setForm((f) => (String(f.produto?.id ?? "") === produtoId ? opcaoNoFormulario(f, item) : f));
    }
    // Só reage à RESPOSTA do servidor e à troca de escolha (não a cada tecla).
  }, [respostaDoBem, bemId, produtoId, tipoId]);

  // Local: o único com saldo já vem escolhido; um local que sumiu da lista sai do formulário.
  useEffect(() => {
    if (!produtoId || !locaisQuery.isSuccess) return;
    const atual = form.local_estoque_id ? String(form.local_estoque_id) : null;
    if (atual && !locais.some((l) => String(l.local_estoque_id) === atual)) {
      setForm((f) => (String(f.produto?.id ?? "") === produtoId && String(f.local_estoque_id ?? "") === atual ? { ...f, local_estoque_id: null } : f));
      return;
    }
    if (!atual && locais.length === 1) {
      const local = String(locais[0].local_estoque_id);
      setForm((f) => (String(f.produto?.id ?? "") === produtoId && !f.local_estoque_id ? { ...f, local_estoque_id: local } : f));
    }
  }, [produtoId, form.local_estoque_id, locais, locaisQuery.isSuccess, setForm]);

  const tipoMedidor = medidorDoFormulario(form);
  const contador = medidorExigeLeitura(tipoMedidor);
  const unidade = UNIDADE_MEDIDOR[tipoMedidor] ?? "";
  const leituraVigente = respostaDoBem?.bem?.leitura_vigente ?? null;
  const produto = form.produto ?? null;
  const tanquesDoProduto = /** @type {any[]} */ (Array.isArray(produto?.tanques) ? produto.tanques : []);
  const localEscolhido = locais.find((l) => String(l.local_estoque_id) === String(form.local_estoque_id)) ?? null;
  const detalhesComErro = Boolean(erros.observacao || erros.referencia_externa);
  const mostrarDetalhes = maisDetalhes || detalhesComErro;
  // Erro num campo de "Mais detalhes" abre a seção (e ela fica aberta até a pessoa fechar).
  useEffect(() => {
    if (detalhesComErro) setMaisDetalhes(true);
  }, [detalhesComErro]);
  const tiposSemProduto = /** @type {any[]} */ (Array.isArray(resumo?.tipos_sem_produto) ? resumo.tipos_sem_produto : []);

  /** @param {React.FormEvent} ev */
  const enviar = (ev) => {
    ev.preventDefault();
    onPrevia();
  };

  let escolhaProduto = null;
  if (bemId) {
    if (produtosQuery.isError) {
      escolhaProduto = (
        <div className="col-span-12">
          <AvisoGestao testId="abastecimento-produtos-erro">
            {mensagemErroAbastecimento(produtosQuery.error, "Não foi possível ler os Produtos deste bem.")}{" "}
            <button type="button" className="underline" onClick={() => produtosQuery.refetch()}>
              Tentar novamente
            </button>
          </AvisoGestao>
        </div>
      );
    } else if (!respostaDoBem) {
      escolhaProduto = (
        <p role="status" className="col-span-12 text-[12px] text-[var(--mg-text-2,#475569)]" data-testid="abastecimento-produtos-carregando">
          Carregando os Produtos deste bem…
        </p>
      );
    } else if (semProduto) {
      const motivo = String(resumo?.motivo_sem_opcao ?? "nenhum_produto_associado");
      const associar = motivo === "nenhum_produto_associado";
      escolhaProduto = (
        <div className="col-span-12">
          <AvisoGestao testId="abastecimento-sem-produto">
            {TEXTO_SEM_PRODUTO[motivo] ?? TEXTO_SEM_PRODUTO.nenhum_produto_associado}
            {associar && tiposSemProduto.length ? ` Combustível sem Produto: ${tiposSemProduto.map((t) => String(t?.nome ?? "")).join(", ")}.` : null}
            {associar ? (
              acoesCombustiveis.criar ? (
                <>
                  {" "}
                  <a href="/combustiveis" className="font-semibold underline" data-testid="abastecimento-abrir-combustiveis">
                    Abrir Combustíveis
                  </a>
                </>
              ) : (
                " Peça a quem cuida do cadastro de Combustíveis."
              )
            ) : null}
          </AvisoGestao>
        </div>
      );
    } else if (modoBotoes) {
      escolhaProduto = (
        <EscolhaSegmentada
          rotulo="Produto"
          testId="abastecimento-produto"
          value={produtoId ?? ""}
          onChange={(v) => {
            const item = itens.find((i) => String(i?.produto?.id ?? "") === v);
            if (item) escolherProduto(item);
          }}
          opcoes={itens.map((i) => ({ value: String(i.produto.id), label: rotuloDoProduto(i) }))}
        />
      );
    } else {
      escolhaProduto = (
        <SeletorPaginadoGestao
          rotulo="Produto"
          testId="abastecimento-produto"
          chave={["patrimonio", "abastecimento", "produtos-do-bem", empresaId, bemId]}
          buscar={({ q, cursor, limit }) => listarProdutosDoBem(empresaId, bemId, { q, cursor, limit })}
          value={produto ? { id: String(produto.id), rotulo: String(produto.nome ?? "") } : null}
          onChange={(opcao) => (opcao ? escolherProduto(opcao) : null)}
          rotuloDaOpcao={(o) => String(o?.produto?.nome ?? "")}
          detalheDaOpcao={(o) => (o?.pronto === true ? null : "sem fator kg/L")}
          obrigatorio
          textoVazio="— Escolha o Produto —"
          span={12}
          maiusculas={false}
        />
      );
    }
  }

  return (
    <CadastroFormShell embedded title="Novo abastecimento">
      <div className="mg-b1-record-form">
        <form id={FORMULARIO_ABASTECIMENTO_ID} onSubmit={enviar} className="b1 mg-b1-form-grid w-full min-h-0" noValidate data-testid="abastecimento-form">
          <SecaoForm titulo="Máquina e Produto" />
          <SeletorPaginadoGestao
            rotulo="Máquina/Veículo"
            testId="abastecimento-bem"
            chave={["patrimonio", "abastecimento", "bens", empresaId]}
            buscar={({ q, cursor, limit }) => listarOpcoesAbastecimento("bens", empresaId, { q, cursor, limit, uso: "formulario" })}
            value={form.bem ? { id: String(form.bem.id), rotulo: rotuloDoBem(form.bem) } : null}
            onChange={(opcao) => {
              // A MESMA máquina de novo não muda nada (o Produto único, o local e a leitura continuam).
              if (opcao?.id != null && bemId && String(opcao.id) === bemId) return;
              setIndisponivel(false);
              mudar({ bem: opcao, ...SEM_PRODUTO, medidor_leitura: "" }, ["bem", "produto", "tanque_id", "tipo_combustivel_id", "local_estoque_id", "medidor_leitura"]);
            }}
            rotuloDaOpcao={rotuloDoBem}
            detalheDaOpcao={(o) => ROTULO_NATUREZA_CURTO[String(o?.natureza ?? "")] ?? null}
            obrigatorio
            erro={erros.bem}
            textoVazio="— Escolha a máquina ou veículo —"
            span={12}
            maiusculas={false}
          />
          {indisponivel && !produto ? (
            <p role="alert" className="col-span-12 rounded-md border border-amber-300 bg-amber-50 p-2 text-[12px] text-amber-900" data-testid="abastecimento-produto-indisponivel">
              O Produto escolhido deixou de estar disponível para este bem. Escolha de novo.
            </p>
          ) : null}
          {escolhaProduto}
          <ErroDoCampo texto={bemId ? erros.produto : undefined} />
          {produto && produto.pronto !== true ? (
            <div className="col-span-12">
              <AvisoGestao testId="abastecimento-sem-fator">
                Configure o fator kg/L deste Produto nesta fazenda antes de abastecer.
                {podeConfigurarFator ? (
                  <button
                    type="button"
                    className={`${BOTAO_SECUNDARIO} ml-2 mt-1 min-h-10 px-3`}
                    data-testid="abastecimento-form-configurar-fator"
                    onClick={() =>
                      onConfigurarFator({
                        tipo: produto.tipo_combustivel ? { id: String(produto.tipo_combustivel.id), nome: String(produto.tipo_combustivel.nome ?? "") } : null,
                        produto: { id: String(produto.id), nome: String(produto.nome ?? ""), conversao: produto.conversao ?? null },
                      })
                    }
                  >
                    Configurar fator kg/L
                  </button>
                ) : (
                  " Peça a quem configura o fator kg/L."
                )}
              </AvisoGestao>
            </div>
          ) : null}
          {produto && tanquesDoProduto.length > 1 ? (
            <>
              <EscolhaSegmentada
                rotulo="Qual tanque será abastecido?"
                testId="abastecimento-tanque"
                value={String(form.tanque_id ?? "")}
                onChange={(v) => mudar({ tanque_id: v }, ["tanque_id", "quantidade_litros"])}
                opcoes={tanquesDoProduto.map((t) => ({ value: String(t.id), label: rotuloDoTanque(t) }))}
              />
              <ErroDoCampo texto={erros.tanque_id} />
            </>
          ) : null}
          {produtoId ? (
            locaisQuery.isError ? (
              <div className="col-span-12">
                <AvisoGestao testId="abastecimento-locais-erro">
                  {mensagemErroAbastecimento(locaisQuery.error, "Não foi possível ler o saldo. A confirmação confere de novo.")}{" "}
                  <button type="button" className="underline" onClick={() => locaisQuery.refetch()}>
                    Tentar novamente
                  </button>
                </AvisoGestao>
              </div>
            ) : locaisQuery.isLoading ? (
              <p role="status" className="col-span-12 text-[12px] text-[var(--mg-text-2,#475569)]">
                Conferindo o saldo deste Produto…
              </p>
            ) : !locais.length ? (
              <div className="col-span-12">
                <AvisoGestao testId="abastecimento-sem-saldo">Sem saldo deste Produto nesta fazenda.</AvisoGestao>
              </div>
            ) : locais.length === 1 ? (
              <>
                <p className="col-span-12 min-w-0 break-words text-[13px]" data-testid="abastecimento-local-auto">
                  Sai do estoque: <span className="font-semibold">{String(localEscolhido?.local_nome ?? locais[0].local_nome ?? "")}</span>
                </p>
                <ErroDoCampo texto={erros.local_estoque_id} />
              </>
            ) : (
              <CampoSelect
                label="De qual local do estoque?"
                value={form.local_estoque_id ?? ""}
                onChange={(v) => mudar({ local_estoque_id: v || null }, ["local_estoque_id"])}
                options={locais.map((l) => ({ value: String(l.local_estoque_id), label: String(l.local_nome ?? "") }))}
                placeholder="— Escolha o local —"
                required
                span={12}
                error={erros.local_estoque_id}
              />
            )
          ) : null}

          <SecaoForm titulo="Abastecimento" />
          <CampoDia
            label="Data do abastecimento"
            value={form.data_operacional}
            onChange={(v) => mudar({ data_operacional: v }, ["data_operacional"])}
            max={hoje}
            required
            span={6}
            error={erros.data_operacional}
            testId="abastecimento-data"
          />
          <CampoNumero
            label="Litros abastecidos"
            sufixo="L"
            value={form.quantidade_litros}
            onChange={(v) => mudar({ quantidade_litros: v }, ["quantidade_litros"])}
            locale={LOCALE_ABASTECIMENTO}
            limites={LIMITES_ABASTECIMENTO.LITROS}
            required
            span={6}
            error={erros.quantidade_litros}
            testId="abastecimento-litros"
          />
          {contador ? (
            <>
              <CampoNumero
                label={ROTULO_LEITURA[tipoMedidor] ?? "Leitura do medidor"}
                sufixo={unidade}
                value={form.medidor_leitura}
                onChange={(v) => mudar({ medidor_leitura: v }, ["medidor_leitura"])}
                locale={LOCALE_ABASTECIMENTO}
                limites={LIMITES_ABASTECIMENTO.LEITURA}
                required
                span={6}
                error={erros.medidor_leitura}
                testId="abastecimento-leitura"
              />
              <div className="col-span-12 min-w-0 self-center break-words text-[12px] text-[var(--mg-text-2,#475569)] md:col-span-6" data-testid="abastecimento-ultima-leitura">
                {leituraVigente?.leitura
                  ? `Última leitura: ${formatarLeitura(leituraVigente.leitura)} ${unidade} em ${formatarDiaAbastecimento(leituraVigente.data)}${
                      leituraVigente.origem === "CADASTRO" ? " (cadastro do bem)" : leituraVigente.numero ? ` (abastecimento nº ${leituraVigente.numero})` : ""
                    }`
                  : null}
              </div>
            </>
          ) : null}
          <EscolhaSegmentada
            rotulo="Completou o tanque?"
            testId="abastecimento-tanque-cheio"
            value={form.tanque_cheio === true ? "sim" : "nao"}
            onChange={(v) => mudar({ tanque_cheio: v === "sim" }, [])}
            opcoes={[
              { value: "sim", label: "Sim" },
              { value: "nao", label: "Não" },
            ]}
          />
          <p className="col-span-12 -mt-1 min-w-0 break-words text-[11px] text-[var(--mg-text-2,#475569)]">
            Responda Sim só se encheu o tanque até o limite: o consumo (km/L ou L/h) é calculado entre dois abastecimentos com tanque cheio.
          </p>
          <div className="col-span-12 min-w-0">
            <button
              type="button"
              className="inline-flex min-h-10 items-center gap-1 rounded-md px-1 text-[13px] font-medium text-[var(--mg-text-1,#0f172a)] hover:bg-slate-50"
              aria-expanded={mostrarDetalhes}
              onClick={() => setMaisDetalhes((v) => (detalhesComErro ? true : !v))}
              data-testid="abastecimento-mais-detalhes"
            >
              {mostrarDetalhes ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />} Mais detalhes
            </button>
          </div>
          {mostrarDetalhes ? (
            <>
              <CampoTextoLongo label="Observação" value={form.observacao} onChange={(v) => mudar({ observacao: v }, ["observacao"])} maxLength={500} />
              <ErroDoCampo texto={erros.observacao} />
              <CampoTexto
                label="Referência externa"
                value={form.referencia_externa}
                onChange={(v) => mudar({ referencia_externa: v }, ["referencia_externa"])}
                maxLength={64}
                span={6}
                keepCase
                error={erros.referencia_externa}
              />
            </>
          ) : null}
          {situacaoPrevia === "invalidada" ? (
            <p role="status" className="col-span-12 rounded-md border border-amber-300 bg-amber-50 p-2 text-[12px] text-amber-900" data-testid="abastecimento-previa-invalidada">
              Os dados mudaram desde a revisão: revise de novo antes de confirmar.
            </p>
          ) : null}
          <div className="col-span-12 flex flex-wrap gap-2 pt-1">
            <button type="submit" className={BOTAO_PRIMARIO} disabled={previando} data-testid="abastecimento-previa">
              <Eye size={16} aria-hidden /> {previando ? "Calculando…" : "Revisar abastecimento"}
            </button>
            {situacaoPrevia === "valida" ? (
              <button type="button" className={BOTAO_SECUNDARIO} onClick={onReabrirPrevia} data-testid="abastecimento-reabrir-previa">
                Voltar à revisão
              </button>
            ) : null}
          </div>
        </form>
      </div>
    </CadastroFormShell>
  );
}
