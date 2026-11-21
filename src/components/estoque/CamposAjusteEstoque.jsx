import React from "react";
import { Plus, Trash2 } from "lucide-react";
import B1Field from "@/components/cadastro/base1/B1Field";
import { CampoSelect, SecaoForm } from "@/components/gestao/GestaoFormParts";
import { CampoNumero, ValorCalculado } from "@/components/financeiroGestao/CamposLancamento";
import SeletorPaginadoGestao from "@/components/financeiroGestao/SeletorPaginadoGestao";
import { formatarCustoUnitario, formatarDia, formatarQtd } from "@/lib/estoqueConsultaRegras";
import { LIMITES_ENTRADA, LOCALE_ENTRADA, comProduto, unidadesDoProduto } from "@/lib/estoqueEntradasRegras";
import { FALTA, MAX_ITENS_AJUSTE, ROTULO_TIPO_AJUSTE, SEM_DIFERENCA, SOBRA, diferencaDaLinha, formatarDiferenca, linhaVaziaAjuste, precisaCusto } from "@/lib/estoqueAjustesRegras";
import { listarCentrosDaEntrada, listarDepositosDaEntrada, listarProdutosDaEntrada } from "@/services/estoqueEntradasService";

/** @param {any} o */
const opcaoProduto = (o) => (o ? { id: String(o.id), rotulo: String(o.nome ?? ""), unidade_estoque: o.unidade_estoque, peso_por_saco_kg: o.peso_por_saco_kg ?? null } : null);
/** @param {any} o */
const opcaoSimples = (o) => (o ? { id: String(o.id), rotulo: String(o.nome ?? "") } : null);

const COR_DIFERENCA = /** @type {Record<string, string>} */ ({
  [SOBRA]: "text-emerald-800",
  [FALTA]: "text-red-800",
});

/**
 * Uma linha do AJUSTE (D-PROD-271): produto, unidade, depósito, o saldo CONTADO e, ao lado, o saldo atual do depósito
 * e a diferença (sobra +, falta −, sem diferença). O custo unitário só aparece (e é obrigatório) na sobra de um
 * depósito sem saldo, que não tem custo médio. Mesmo cartão de linha inteira da entrada e da saída.
 * @param {{ linha: any, indice: number, empresaId: string, erros: Record<string, string>, podeRemover: boolean,
 *   saldo: { data?: any, isLoading?: boolean, isError?: boolean } | undefined, onMudar: (l: any) => void, onRemover: () => void }} props
 */
function LinhaDeAjuste({ linha, indice, empresaId, erros, podeRemover, saldo, onMudar, onRemover }) {
  const e = (/** @type {string} */ campo) => erros[`itens.${indice}.${campo}`] || undefined;
  const unidades = unidadesDoProduto(linha.produto);
  const info = saldo?.data ?? null;
  const unidadeEstoque = info?.unidade_estoque ?? (linha.produto?.unidade_estoque === "L" ? "L" : "KG");
  const dif = diferencaDaLinha(linha, info);
  const pedeCusto = precisaCusto(linha, info);
  const textoSaldo = !linha.produto || !linha.deposito ? "—" : saldo?.isLoading ? "Carregando…" : saldo?.isError ? "Não foi possível ler" : info ? formatarQtd(info.saldo, unidadeEstoque) : "—";
  const textoDiferenca = dif ? `${formatarDiferenca(dif.diferenca, unidadeEstoque)} · ${ROTULO_TIPO_AJUSTE[dif.tipo]}` : "—";
  return (
    <div className="col-span-12 b1-form-embutido rounded border border-[var(--mg-border,#e2e8f0)] p-2" data-testid={`ajuste-linha-${indice}`}>
      <div className="grid grid-cols-12 gap-x-3 gap-y-2">
        <div className="col-span-12 flex items-center justify-between text-[12px] font-semibold text-[var(--mg-text-2,#475569)]">
          <span>Produto {indice + 1}</span>
          {podeRemover ? (
            <button type="button" className="tb-btn" onClick={onRemover} aria-label={`Remover o produto ${indice + 1}`} data-testid={`ajuste-linha-${indice}-remover`}>
              <Trash2 size={14} aria-hidden /> Remover
            </button>
          ) : null}
        </div>
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
          testId={`ajuste-linha-${indice}-deposito`}
          chave={["estoque", "entrada-depositos"]}
          buscar={({ q, cursor, limit }) => listarDepositosDaEntrada({ q, cursor, limit })}
          value={linha.deposito}
          onChange={(o) => onMudar({ ...linha, deposito: opcaoSimples(o) })}
          obrigatorio
          erro={e("deposito")}
          span={4}
        />
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
        <ValorCalculado label="Saldo atual" valor={textoSaldo} span={4} testId={`ajuste-linha-${indice}-saldo`} />
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
        {pedeCusto ? (
          <>
            <CampoNumero
              label={`Custo da sobra (R$ por ${unidadeEstoque === "L" ? "litro" : "kg"})`}
              value={linha.custo}
              onChange={(v) => onMudar({ ...linha, custo: v })}
              locale={LOCALE_ENTRADA}
              limites={LIMITES_ENTRADA}
              casasMin={2}
              required
              error={e("custo")}
              span={6}
              testId={`ajuste-linha-${indice}-custo`}
            />
            <p className="col-span-12 text-[12px] text-[var(--mg-text-2,#475569)] md:col-span-6" data-testid={`ajuste-linha-${indice}-aviso-custo`}>
              Este depósito não tem saldo deste produto, então não há custo médio: informe o custo da sobra.
            </p>
          </>
        ) : info?.custo_medio && dif && dif.tipo !== SEM_DIFERENCA ? (
          <p className="col-span-12 text-[12px] text-[var(--mg-text-2,#475569)]" data-testid={`ajuste-linha-${indice}-custo-medio`}>
            Valorizado pelo custo médio do depósito: {formatarCustoUnitario(info.custo_medio)} por {unidadeEstoque === "L" ? "litro" : "kg"}.
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Os campos do tipo AJUSTE na janela "Novo movimento" (D-PROD-271): data fixa (hoje na fazenda, só informação),
 * centros, observação e as linhas de contagem. `saldos[i]` é a consulta do saldo do depósito da linha `i` (feita
 * por quem usa, que também valida e monta o corpo).
 * @param {{ ajuste: any, empresaId: string, hoje: string, erros: Record<string, string>,
 *   saldos: Array<{ data?: any, isLoading?: boolean, isError?: boolean } | undefined>,
 *   observacao: React.ReactNode, onMudar: (mudanca: Record<string, any>) => void }} props
 */
export default function CamposAjusteEstoque({ ajuste, empresaId, hoje, erros, saldos, observacao, onMudar }) {
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
      {ajuste.itens.map((/** @type {any} */ linha, /** @type {number} */ i) => (
        <LinhaDeAjuste
          key={linha.chave}
          linha={linha}
          indice={i}
          empresaId={empresaId}
          erros={erros}
          podeRemover={ajuste.itens.length > 1}
          saldo={saldos[i]}
          onMudar={(l) => mudarLinha(i, l)}
          onRemover={() => onMudar({ itens: ajuste.itens.filter((/** @type {any} */ _, /** @type {number} */ j) => j !== i) })}
        />
      ))}
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
