import React from "react";
import { Plus } from "lucide-react";
import B1Field from "@/components/cadastro/base1/B1Field";
import { CampoSelect, SecaoForm } from "@/components/gestao/GestaoFormParts";
import { CampoNumero, ValorCalculado } from "@/components/financeiroGestao/CamposLancamento";
import SeletorPaginadoGestao from "@/components/financeiroGestao/SeletorPaginadoGestao";
import { useCelular } from "@/components/common/MobileSheet";
import TabelaProdutosMovimento from "@/components/estoque/TabelaProdutosMovimento";
import { formatarCustoUnitario, formatarDia, formatarQtd } from "@/lib/estoqueConsultaRegras";
import { LIMITES_ENTRADA, LOCALE_ENTRADA, comProduto, equivalenciaDaLinha, unidadesDoProduto } from "@/lib/estoqueEntradasRegras";
import { FALTA, MAX_ITENS_AJUSTE, ROTULO_TIPO_AJUSTE, SEM_DIFERENCA, SOBRA, diferencaDaLinha, formatarDiferenca, linhaVaziaAjuste, precisaCusto } from "@/lib/estoqueAjustesRegras";
import { listarCentrosDaEntrada, listarDepositosDaEntrada, listarProdutosDaEntrada } from "@/services/estoqueEntradasService";

/** @param {any} o */
const opcaoProduto = (o) => (o ? { id: String(o.id), rotulo: String(o.nome ?? ""), unidade_estoque: o.unidade_estoque, peso_por_saco_kg: o.peso_por_saco_kg ?? null, unidades_conversao: Array.isArray(o.unidades_conversao) ? o.unidades_conversao : [] } : null);
/** @param {any} o */
const opcaoSimples = (o) => (o ? { id: String(o.id), rotulo: String(o.nome ?? "") } : null);

const COR_DIFERENCA = /** @type {Record<string, string>} */ ({
  [SOBRA]: "text-emerald-800",
  [FALTA]: "text-red-800",
});

const COLUNAS_AJUSTE = [
  { id: "produto", titulo: "Produto", largura: 220 },
  { id: "unidade", titulo: "Unidade", largura: 100 },
  { id: "deposito", titulo: "Local de estoque", largura: 190 },
  { id: "contado", titulo: "Contado", numero: true, largura: 120 },
  { id: "saldo", titulo: "Saldo atual", numero: true, largura: 120 },
  { id: "diferenca", titulo: "Diferença", numero: true, largura: 150 },
];

/**
 * O que a linha do AJUSTE (D-PROD-272) calcula: o saldo atual do depósito e a diferença (sobra +, falta −, sem
 * diferença). @param {any} linha @param {{ data?: any, isLoading?: boolean, isError?: boolean } | undefined} saldo
 */
function contaDaLinha(linha, saldo) {
  const info = saldo?.data ?? null;
  const unidadeEstoque = info?.unidade_estoque ?? (linha.produto?.unidade_estoque === "L" ? "L" : "KG");
  const dif = diferencaDaLinha(linha, info);
  return { info, unidadeEstoque, dif, pedeCusto: precisaCusto(linha, info) };
}

/**
 * Uma célula da linha do AJUSTE: produto, unidade, depósito, o saldo CONTADO e, ao lado, o saldo atual do depósito e
 * a diferença. A linha é uma linha da `TabelaProdutosMovimento` (D-PROD-285), no desenho da tabela "Áreas".
 * @param {{ linha: any, indice: number, empresaId: string, erros: Record<string, string>,
 *   saldo: { data?: any, isLoading?: boolean, isError?: boolean } | undefined, onMudar: (l: any) => void }} p
 * @param {string} coluna
 */
function celulaDeAjuste({ linha, indice, empresaId, erros, saldo, onMudar }, coluna) {
  const e = (/** @type {string} */ campo) => erros[`itens.${indice}.${campo}`] || undefined;
  const unidades = unidadesDoProduto(linha.produto);
  const { info, unidadeEstoque, dif } = contaDaLinha(linha, saldo);
  switch (coluna) {
    case "produto":
      return (
        <SeletorPaginadoGestao
          rotulo="Produto"
          testId={`ajuste-linha-${indice}-produto`}
          chave={["estoque", "entrada-produtos", empresaId]}
          buscar={({ q, cursor, limit }) => listarProdutosDaEntrada(empresaId, { q, cursor, limit })}
          value={linha.produto ? { id: linha.produto.id, rotulo: linha.produto.rotulo } : null}
          onChange={(o) => onMudar(comProduto(linha, opcaoProduto(o)))}
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
          testId={`ajuste-linha-${indice}-deposito`}
          chave={["estoque", "entrada-depositos"]}
          buscar={({ q, cursor, limit }) => listarDepositosDaEntrada({ q, cursor, limit })}
          value={linha.deposito}
          onChange={(o) => onMudar({ ...linha, deposito: opcaoSimples(o) })}
          obrigatorio
          erro={e("deposito")}
          span={8}
        />
      );
    case "contado":
      return (
        <>
        <CampoNumero
          label="Contado"
          value={linha.contado}
          onChange={(v) => onMudar({ ...linha, contado: v })}
          locale={LOCALE_ENTRADA}
          limites={LIMITES_ENTRADA}
          required
          error={e("contado")}
          span={4}
          testId={`ajuste-linha-${indice}-contado`}
        />
        {/* D-PROD-288: a contagem em outra unidade mostra a equivalência ("8 SACO = 200 kg"). */}
        {equivalenciaDaLinha({ ...linha, quantidade: linha.contado }) ? (
          <p className="mt-1 text-[12px] text-[var(--mg-text-2,#475569)]" role="status" data-testid={`ajuste-linha-${indice}-equivalencia`}>{equivalenciaDaLinha({ ...linha, quantidade: linha.contado })}</p>
        ) : null}
        </>
      );
    case "saldo": {
      const textoSaldo = !linha.produto || !linha.deposito ? "—" : saldo?.isLoading ? "Carregando…" : saldo?.isError ? "Não foi possível ler" : info ? formatarQtd(info.saldo, unidadeEstoque) : "—";
      return <ValorCalculado label="Saldo atual" valor={textoSaldo} span={4} testId={`ajuste-linha-${indice}-saldo`} />;
    }
    case "diferenca": {
      const textoDiferenca = dif ? `${formatarDiferenca(dif.diferenca, unidadeEstoque)} · ${ROTULO_TIPO_AJUSTE[dif.tipo]}` : "—";
      return (
        <B1Field label="Diferença" span={4} hasValue locked>
          <output
            data-testid={`ajuste-linha-${indice}-diferenca`}
            data-tipo={dif?.tipo ?? ""}
            aria-label="Diferença"
            className={`mg-input min-w-0 font-semibold ${dif ? COR_DIFERENCA[dif.tipo] ?? "" : ""}`}
          >
            <span className="block min-w-0 truncate">{textoDiferenca}</span>
          </output>
        </B1Field>
      );
    }
    default:
      return null;
  }
}

/**
 * O detalhe da linha do AJUSTE: o custo unitário só aparece (e é obrigatório) na sobra de um depósito sem saldo, que
 * não tem custo médio; senão, a nota do custo médio usado. Nada a dizer, sem detalhe.
 * @param {{ linha: any, indice: number, erros: Record<string, string>,
 *   saldo: { data?: any, isLoading?: boolean, isError?: boolean } | undefined, onMudar: (l: any) => void }} p
 */
function detalheDoAjuste({ linha, indice, erros, saldo, onMudar }) {
  const { info, unidadeEstoque, dif, pedeCusto } = contaDaLinha(linha, saldo);
  if (pedeCusto) {
    return (
      <>
        <CampoNumero
          label={`Custo da sobra (R$ por ${unidadeEstoque === "L" ? "litro" : "kg"})`}
          value={linha.custo}
          onChange={(v) => onMudar({ ...linha, custo: v })}
          locale={LOCALE_ENTRADA}
          limites={LIMITES_ENTRADA}
          casasMin={2}
          required
          error={erros[`itens.${indice}.custo`] || undefined}
          span={6}
          testId={`ajuste-linha-${indice}-custo`}
        />
        <p className="col-span-12 text-[12px] text-[var(--mg-text-2,#475569)] md:col-span-6" data-testid={`ajuste-linha-${indice}-aviso-custo`}>
          Este depósito não tem saldo deste produto, então não há custo médio: informe o custo da sobra.
        </p>
      </>
    );
  }
  if (info?.custo_medio && dif && dif.tipo !== SEM_DIFERENCA) {
    return (
      <p className="col-span-12 text-[12px] text-[var(--mg-text-2,#475569)]" data-testid={`ajuste-linha-${indice}-custo-medio`}>
        Valorizado pelo custo médio do depósito: {formatarCustoUnitario(info.custo_medio)} por {unidadeEstoque === "L" ? "litro" : "kg"}.
      </p>
    );
  }
  return null;
}

/**
 * Os campos do tipo AJUSTE na tela "Novo movimento" (D-PROD-272): data fixa (hoje na fazenda, só informação),
 * centros, observação e as linhas de contagem. `saldos[i]` é a consulta do saldo do depósito da linha `i` (feita
 * por quem usa, que também valida e monta o corpo).
 * @param {{ ajuste: any, empresaId: string, hoje: string, erros: Record<string, string>,
 *   saldos: Array<{ data?: any, isLoading?: boolean, isError?: boolean } | undefined>,
 *   observacao: React.ReactNode, onMudar: (mudanca: Record<string, any>) => void }} props
 */
export default function CamposAjusteEstoque({ ajuste, empresaId, hoje, erros, saldos, observacao, onMudar }) {
  const celular = useCelular();
  /** @param {number} i @param {any} linha */
  const mudarLinha = (i, linha) => onMudar({ itens: ajuste.itens.map((/** @type {any} */ l, /** @type {number} */ j) => (j === i ? linha : l)) });
  return (
    <>
      <SecaoForm titulo="Ajuste de inventário" />
      <ValorCalculado label="Data" valor={`Hoje (${formatarDia(hoje)})`} span={4} testId="ajuste-data" />
      <p className="col-span-12 self-end text-[12px] text-[var(--mg-text-2,#475569)] md:col-span-8">
        Digite o saldo CONTADO de cada produto no depósito. A diferença para o saldo atual entra como sobra ou sai como falta, pelo custo médio do depósito.
      </p>
      <SeletorPaginadoGestao
        rotulo="Centro de resultado"
        testId="ajuste-centro-resultado"
        chave={["estoque", "entrada-centros-resultado", empresaId]}
        buscar={({ q, cursor, limit }) => listarCentrosDaEntrada("resultado", empresaId, { q, cursor, limit })}
        value={ajuste.centro_resultado}
        onChange={(o) => onMudar({ centro_resultado: opcaoSimples(o) })}
        permitirLimpar
        span={6}
      />
      <SeletorPaginadoGestao
        rotulo="Centro de custo"
        testId="ajuste-centro-custo"
        chave={["estoque", "entrada-centros-custo", empresaId]}
        buscar={({ q, cursor, limit }) => listarCentrosDaEntrada("custo", empresaId, { q, cursor, limit })}
        value={ajuste.centro_custo}
        onChange={(o) => onMudar({ centro_custo: opcaoSimples(o) })}
        permitirLimpar
        span={6}
      />
      {observacao}

      <SecaoForm titulo="Contagem" />
      <TabelaProdutosMovimento
        prefixo="ajuste"
        linhas={ajuste.itens}
        colunas={COLUNAS_AJUSTE}
        celula={(linha, i, coluna) => celulaDeAjuste({ linha, indice: i, empresaId, erros, saldo: saldos[i], onMudar: (l) => mudarLinha(i, l) }, coluna)}
        detalhe={(linha, i) => detalheDoAjuste({ linha, indice: i, erros, saldo: saldos[i], onMudar: (l) => mudarLinha(i, l) })}
        podeRemover={ajuste.itens.length > 1}
        onRemover={(i) => onMudar({ itens: ajuste.itens.filter((/** @type {any} */ _, /** @type {number} */ j) => j !== i) })}
        total={{ rotulo: `Total · ${ajuste.itens.length} ${ajuste.itens.length === 1 ? "produto" : "produtos"}` }}
        celular={celular}
      />
      {erros.itens ? <p className="col-span-12 text-[12px] text-red-800">{erros.itens}</p> : null}
      <div className="col-span-12 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          className="tb-btn"
          disabled={ajuste.itens.length >= MAX_ITENS_AJUSTE}
          onClick={() => onMudar({ itens: [...ajuste.itens, linhaVaziaAjuste()] })}
          data-testid="ajuste-adicionar-produto"
        >
          <Plus size={14} aria-hidden /> Adicionar produto
        </button>
      </div>
    </>
  );
}
