import React, { useEffect, useState } from "react";
import { DENSIDADE_BASE1 } from "@/components/cadastro/base1/B1Field";
import { ChevronDown, ChevronRight, Eye } from "lucide-react";
import CadastroFormShell from "@/components/cadastro/base1/CadastroFormShell";
import { AvisoGestao, CampoSelect, CampoTexto, SecaoForm } from "@/components/gestao/GestaoFormParts";
import { CampoDia, CampoNumero, EscolhaSegmentada, ValorCalculado } from "@/components/financeiroGestao/CamposLancamento";
import SeletorPaginadoGestao from "@/components/financeiroGestao/SeletorPaginadoGestao";
import { CampoTextoLongo } from "@/components/patrimonio/PatrimonioFormParts";
import { useAcoesTelaPatrimonio } from "@/hooks/usePatrimonioSessao";
import { TELAS_PATRIMONIO } from "@/lib/patrimonioPermissions";
import { listarOpcoesAbastecimento, listarProdutosDoBem } from "@/services/abastecimentoService";
import { chaveProdutosDoBem } from "@/hooks/useFluxoAbastecimento";
import { mensagemErroAbastecimento } from "@/lib/patrimonioErros";
import { createPageUrl } from "@/utils";
import {
  LIMITES_ABASTECIMENTO,
  LIMITES_CUSTO_EXTERNO,
  LOCALE_ABASTECIMENTO,
  ORIGEM_ESTOQUE,
  ORIGEM_EXTERNO,
  ROTULO_ORIGEM_ABASTECIMENTO,
  ROTULO_LEITURA,
  UNIDADE_MEDIDOR,
  dicaDaUnidadeDoProduto,
  ehExterno,
  formatarDiaAbastecimento,
  formatarLeitura,
  formatarLitrosCurto,
  medidorDoFormulario,
  medidorExigeLeitura,
  opcaoNoFormulario,
  rotuloDaUnidade,
  rotuloDoBem,
  unidadeDoFormulario,
} from "@/lib/abastecimentoRegras";
import { BOTAO_PRIMARIO, BOTAO_SECUNDARIO } from "@/components/patrimonio/DialogosAbastecimento";
import CampoLotes from "@/components/estoque/CampoLotes";
import { lerNumeroLocal } from "@/lib/dinheiroDecimal";
import { SEM_PRODUTO, chaveLocais, useOpcoesDoAbastecimento } from "@/hooks/useOpcoesDoAbastecimento";

export const FORMULARIO_ABASTECIMENTO_ID = "formulario-abastecimento";

/** Chaves das leituras do formulário (prefixo da tela: confirmar/cancelar/recusas invalidam). */
export { chaveProdutosDoBem, chaveLocais };

/** Até este número de Produtos (resposta completa) a escolha é por botões; acima, seletor com busca. */
export const MAXIMO_PRODUTOS_EM_BOTOES = 6;

const ROTULO_NATUREZA_CURTO = /** @type {Record<string, string>} */ ({ MAQUINA: "Máquina", VEICULO: "Veículo", EQUIPAMENTO: "Equipamento" });

/**
 * Texto de cada motivo de "nenhum Produto" do servidor (`resumo.motivo_sem_opcao`,
 * D-PROD-162): tudo se resolve no cadastro de Bens (Produtos aceitos do tanque).
 */
export const TEXTO_SEM_PRODUTO = Object.freeze(
  /** @type {Record<string, string>} */ ({
    bem_inativo: "Este bem está inativo: reative-o no cadastro de Bens para abastecer.",
    sem_tanque_ativo: "Este bem não tem tanque ativo. Cadastre ou reative um tanque no cadastro do bem.",
    tanque_sem_produto: "Os tanques deste bem não têm Produto aceito. Marque os Produtos aceitos em Bens Patrimoniais › Operação › Tanques.",
    produto_unidade_incompativel:
      "O Produto aceito não tem estoque em litros (L), quilos (KG) nem sacos (SACO): o abastecimento não é possível. Aceite no tanque outro Produto em Bens Patrimoniais › Operação › Tanques.",
    produto_inativo_ou_outra_fazenda:
      "Os Produtos aceitos pelos tanques deste bem estão inativos ou são de outra fazenda. Ajuste os Produtos aceitos em Bens Patrimoniais › Operação › Tanques.",
  }),
);

/** Rótulo do Produto na escolha: o NOME real do Produto do estoque. @param {any} item */
const rotuloDoProduto = (item) => String(item?.produto?.nome ?? "");

/** "Tanque principal (180 L)". @param {any} t */
const rotuloDoTanque = (t) => {
  const nome = String(t?.identificador ?? "");
  return t?.capacidade_litros ? `${nome} (${formatarLitrosCurto(t.capacidade_litros)} L)` : nome;
};

/** A quantidade digitada como número (na unidade de estoque do Produto), 0 quando inválida. @param {unknown} v */
const quantidadeDoEstoque = (v) => {
  const r = lerNumeroLocal(v, LOCALE_ABASTECIMENTO, LIMITES_ABASTECIMENTO.QUANTIDADE);
  return r.ok ? Number(r.valor) : 0;
};

/** @param {{ texto: string|undefined }} props */
function ErroDoCampo({ texto }) {
  return texto ? <p className="col-span-12 -mt-1 text-[12px] text-red-700">{texto}</p> : null;
}

/**
 * Formulário do NOVO abastecimento (o estado vive na tela). D-PROD-162:
 * Máquina/Veículo → PRODUTO (o nome real do estoque, dos "Produtos aceitos"
 * dos tanques do bem, opção do SERVIDOR) → tanque (só se o Produto é aceito em
 * mais de um) → local (automático com um só) → data → "Quantidade abastecida"
 * na unidade de estoque do Produto (L; kg para KG e para SACO — D-PROD-169 —,
 * com a dica fixa) → medidor →
 * "Completou o tanque?" → Mais detalhes → Revisar. Sem tipo de combustível e
 * sem fator kg/L. Trocar um campo limpa os que dependem dele. Nada é gravado
 * aqui: "Revisar abastecimento" pede a prévia ao servidor.
 *
 * D-PROD-211: "Origem" — Estoque da fazenda (o local de estoque, como sempre)
 * ou Posto externo (sem local; pede o valor total da nota). O tipo de medidor vem do bem e o centro de custo é o
 * snapshot do servidor: nenhum dos dois se pergunta. D-PROD-383: o vínculo com o lançamento da atividade saiu.
 * @param {{
 *   empresaId: string,
 *   form: any,
 *   setForm: (atualizar: (f: any) => any) => void,
 *   hoje: string,
 *   erros: Record<string, string>,
 *   limparErro: (campo: string) => void,
 *   previando: boolean,
 *   situacaoPrevia: 'nenhuma'|'valida'|'invalidada',
 *   onPrevia: () => void,
 *   onReabrirPrevia: () => void,
 *   botoesNoRodape?: boolean,
 * }} props `botoesNoRodape` (D-PROD-252): quem abre o formulário numa janela põe "Revisar abastecimento" no rodapé dela
 *   (`type="submit" form={FORMULARIO_ABASTECIMENTO_ID}`) e o formulário não repete os botões.
 */
export default function FormularioAbastecimento({
  empresaId,
  form,
  setForm,
  hoje,
  erros,
  limparErro,
  previando,
  situacaoPrevia,
  onPrevia,
  onReabrirPrevia,
  botoesNoRodape = false,
}) {
  const bemId = form.bem?.id ? String(form.bem.id) : null;
  const produtoId = form.produto?.id ? String(form.produto.id) : null;
  // Posto externo: o combustível não sai do estoque (sem local, sem leitura de saldo).
  const externo = ehExterno(form);
  // "Abrir Bens Patrimoniais" só para quem vê a tela de Bens (onde ficam os Produtos aceitos do tanque).
  const acoesBens = useAcoesTelaPatrimonio(TELAS_PATRIMONIO.BENS);
  const [maisDetalhes, setMaisDetalhes] = useState(() => Boolean(String(form.observacao ?? "").trim() || String(form.referencia_externa ?? "").trim()));
  // As opções do bem e dos locais, e as regras da escolha (um só Produto/local já vem escolhido; a que saiu é avisada).
  const { respostaDoBem, itens, resumo, completa, semProduto, produtosQuery, locaisQuery, locais, indisponivel, setIndisponivel } = useOpcoesDoAbastecimento({
    empresaId,
    bemId,
    form,
    setForm,
  });
  const modoBotoes = completa && itens.length > 0 && itens.length <= MAXIMO_PRODUTOS_EM_BOTOES;

  /** @param {Record<string, any>} mudanca @param {string[]} campos */
  const mudar = (mudanca, campos) => {
    setForm((f) => ({ ...f, ...mudanca }));
    for (const c of campos) limparErro(c);
  };
  /** Aplica a opção de Produto do servidor (os tanques que o aceitam vêm dela). @param {any} item */
  const escolherProduto = (item) => {
    setIndisponivel(false);
    setForm((f) => opcaoNoFormulario(f, item));
    for (const c of ["produto", "tanque_id", "local_estoque_id"]) limparErro(c);
  };

  const tipoMedidor = medidorDoFormulario(form);
  const contador = medidorExigeLeitura(tipoMedidor);
  const unidade = UNIDADE_MEDIDOR[tipoMedidor] ?? "";
  const leituraVigente = respostaDoBem?.bem?.leitura_vigente ?? null;
  const produto = form.produto ?? null;
  // Unidade EFETIVA do estoque (SACO guarda em kg) e a dica da unidade do Produto (KG ou SACO).
  const unidadeProduto = unidadeDoFormulario(form);
  const dicaDaUnidade = dicaDaUnidadeDoProduto(produto?.unidade_principal_estoque);
  const tanquesDoProduto = /** @type {any[]} */ (Array.isArray(produto?.tanques) ? produto.tanques : []);
  const localEscolhido = locais.find((l) => String(l.local_estoque_id) === String(form.local_estoque_id)) ?? null;
  const detalhesComErro = Boolean(erros.observacao || erros.referencia_externa);
  const mostrarDetalhes = maisDetalhes || detalhesComErro;
  // Erro num campo de "Mais detalhes" abre a seção (e ela fica aberta até a pessoa fechar).
  useEffect(() => {
    if (detalhesComErro) setMaisDetalhes(true);
  }, [detalhesComErro]);

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
      const motivo = String(resumo?.motivo_sem_opcao ?? "tanque_sem_produto");
      escolhaProduto = (
        <div className="col-span-12">
          <AvisoGestao testId="abastecimento-sem-produto">
            {TEXTO_SEM_PRODUTO[motivo] ?? TEXTO_SEM_PRODUTO.tanque_sem_produto}
            {acoesBens.ver ? (
              <>
                {" "}
                <a href={createPageUrl("BensPatrimoniais")} className="font-semibold underline" data-testid="abastecimento-abrir-bens">
                  Abrir Bens Patrimoniais
                </a>
              </>
            ) : (
              " Peça a quem cuida do cadastro de Bens Patrimoniais."
            )}
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
          detalheDaOpcao={(o) => rotuloDaUnidade(o?.produto?.unidade_principal_estoque) || null}
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
        <form id={FORMULARIO_ABASTECIMENTO_ID} onSubmit={enviar} className="b1 mg-b1-form-grid w-full min-h-0" noValidate data-testid="abastecimento-form" data-densidade={DENSIDADE_BASE1}>
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
              mudar({ bem: opcao, ...SEM_PRODUTO, medidor_leitura: "" }, ["bem", "produto", "tanque_id", "local_estoque_id", "medidor_leitura"]);
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
          {produto && tanquesDoProduto.length > 1 ? (
            <>
              <EscolhaSegmentada
                rotulo="Qual tanque será abastecido?"
                testId="abastecimento-tanque"
                value={String(form.tanque_id ?? "")}
                onChange={(v) => mudar({ tanque_id: v }, ["tanque_id", "quantidade"])}
                opcoes={tanquesDoProduto.map((t) => ({ value: String(t.id), label: rotuloDoTanque(t) }))}
              />
              <ErroDoCampo texto={erros.tanque_id} />
            </>
          ) : null}
          <EscolhaSegmentada
            rotulo="Origem"
            testId="abastecimento-origem"
            value={externo ? ORIGEM_EXTERNO : ORIGEM_ESTOQUE}
            onChange={(v) =>
              v === ORIGEM_EXTERNO
                ? mudar({ origem: ORIGEM_EXTERNO, local_estoque_id: null }, ["local_estoque_id"])
                : mudar({ origem: ORIGEM_ESTOQUE, custo_total: "" }, ["custo_total"])
            }
            opcoes={[
              { value: ORIGEM_ESTOQUE, label: ROTULO_ORIGEM_ABASTECIMENTO.ESTOQUE },
              { value: ORIGEM_EXTERNO, label: ROTULO_ORIGEM_ABASTECIMENTO.EXTERNO },
            ]}
          />
          {externo ? (
            <p className="col-span-12 -mt-1 min-w-0 break-words text-[11px] text-[var(--mg-text-2,#475569)]" data-testid="abastecimento-externo-nota">
              Posto externo: o combustível não sai do estoque da fazenda. Informe o valor total da nota do posto.
            </p>
          ) : null}
          {produtoId && !externo ? (
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
            label={unidadeProduto ? `Quantidade abastecida (${rotuloDaUnidade(unidadeProduto)})` : "Quantidade abastecida"}
            value={form.quantidade}
            onChange={(v) => mudar({ quantidade: v }, ["quantidade"])}
            locale={LOCALE_ABASTECIMENTO}
            limites={LIMITES_ABASTECIMENTO.QUANTIDADE}
            required
            span={6}
            error={erros.quantidade}
            testId="abastecimento-quantidade"
          />
          {dicaDaUnidade ? (
            <p role="note" className="col-span-12 -mt-1 min-w-0 break-words rounded-md border border-amber-300 bg-amber-50 p-2 text-[12px] text-amber-900" data-testid="abastecimento-dica-kg">
              {dicaDaUnidade}
            </p>
          ) : null}
          {externo ? (
            <CampoNumero
              label="Valor total da nota (R$)"
              value={form.custo_total ?? ""}
              onChange={(v) => mudar({ custo_total: v }, ["custo_total"])}
              locale={LOCALE_ABASTECIMENTO}
              limites={LIMITES_CUSTO_EXTERNO}
              casasMin={2}
              required
              span={6}
              error={erros.custo_total}
              testId="abastecimento-custo-total"
            />
          ) : null}
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
          {/* D-PROD-282 em todas as telas: combustível com lote — sugestão FEFO, escolher e dividir, aviso de vencido. */}
          {!externo && produto?.controla_lote && form.local_estoque_id ? (
            <>
              <CampoLotes
                empresaId={empresaId}
                produto={produto}
                localId={String(form.local_estoque_id)}
                quantidade={quantidadeDoEstoque(form.quantidade)}
                lotes={form.lotes}
                confirmaVencido={form.confirmaVencido}
                loteVencido={form.loteVencido}
                erroLote={form.erroLote}
                onMudar={(patch) => {
                  // O que a pessoa escolhe passa pelo `mudar` (limpa o erro); o que o campo devolve só marca o formulário.
                  if ("lotes" in patch || "confirmaVencido" in patch) mudar(patch, ["lotes"]);
                  else setForm((f) => ({ ...f, ...patch }));
                }}
                testId="abastecimento-lotes"
              />
              <ErroDoCampo texto={erros.lotes} />
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
            Responda Sim só se encheu o tanque até o limite: o consumo (km/L, L/h, km/kg ou kg/h) é calculado entre dois abastecimentos com tanque cheio.
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
                label={externo ? "Número da nota ou cupom" : "Referência externa"}
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
          {botoesNoRodape ? null : (
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
          )}
        </form>
      </div>
    </CadastroFormShell>
  );
}
