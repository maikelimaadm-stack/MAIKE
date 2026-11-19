import React, { useCallback, useMemo } from "react";
import CadastroBase1Grade from "@/components/cadastro/base1/CadastroBase1Grade";
import { BASE1_GRADE_REFERENCE_HEADERS } from "@/components/cadastro/base1/base1VisualPreset";
import { useCelular } from "@/components/common/MobileSheet";

const SEM_LINHAS = Object.freeze([]);
const ORDEM = "__ordem";

/**
 * A tabela do Lançamento de Atividades no modelo Base1 (D-PROD-252, emenda 2): é a MESMA grade da lista do Lançamento de
 * Atividades e dos cadastros (`CadastroBase1Grade` → `Base1Grid`, as classes `mg-grid`, o cabeçalho de referência, o ⚡ e o
 * rodapé `<tfoot class="mg-grid-foot">`), sem cartão em volta. Este componente só junta o que a grade pede (ordem das
 * linhas como vieram, cabeçalho de referência, chave das preferências de coluna) para as tabelas da atividade aberta.
 *
 * O rodapé do Base1 ("N registros", tamanho da página) é do chrome da tela, no fim da casca; o `rodape` daqui é a linha de
 * TOTAL da própria tabela (um `<tfoot>`), recebida com os ids das colunas na ordem em que aparecem.
 *
 * @param {{
 *   colunas: Array<{ id: string, label: string, align?: string, width?: number, sortable?: boolean, default?: boolean }>,
 *   linhas: any[],
 *   chave: string,
 *   valorDoCampo: (linha: any, colunaId: string) => string,
 *   renderCelula?: (linha: any, colunaId: string) => React.ReactNode,
 *   renderAcoes?: (linha: any) => React.ReactNode,
 *   onAbrir?: (linha: any) => void,
 *   comparar?: (a: any, b: any, colunaId: string) => number | undefined,
 *   rodape?: (colunasVisiveis: string[], colunaSelecao: boolean) => React.ReactNode,
 *   vazio?: string,
 *   carregando?: boolean,
 *   testId?: string,
 *   solta?: boolean,
 * }} props `colunas`: na ordem do computador; no celular a tela passa a ordem dela (o dado principal primeiro).
 *   `comparar`: a ordem própria de uma coluna (dia e dinheiro pelo valor, não pelo texto); `undefined` = a regra da grade.
 *   `renderAcoes`: o ⚡ da linha (liga a coluna de seleção, como na lista). `solta`: a tabela tem a altura do conteúdo
 *   (dentro de um detalhe que rola) em vez de preencher a casca.
 */
export default function TabelaBase1({ colunas, linhas, chave, valorDoCampo, renderCelula, renderAcoes, onAbrir, comparar: compararDaTela, rodape, vazio = "Nada registrado aqui ainda.", carregando = false, testId, solta = false }) {
  const celular = useCelular();
  const colunaSelecao = typeof renderAcoes === "function";
  // A ordem que a tela mandou (a da atividade, a mais nova primeiro…) é a inicial; clicar no cabeçalho ordena como na lista.
  // (um mapa, sem mexer nas linhas: elas voltam inteiras para o ⚡, a abertura e as ações da tela)
  const lista = linhas?.length ? linhas : SEM_LINHAS;
  const posicao = useMemo(() => new Map(lista.map((l, i) => [l, i])), [lista]);
  const comparar = useCallback((/** @type {any} */ a, /** @type {any} */ b, /** @type {string} */ coluna) => (coluna === ORDEM ? (posicao.get(a) ?? 0) - (posicao.get(b) ?? 0) : compararDaTela?.(a, b, coluna)), [posicao, compararDaTela]);
  const getFieldValue = useCallback((/** @type {any} */ l, /** @type {string} */ id) => valorDoCampo(l, id) ?? "", [valorDoCampo]);
  const celula = useCallback((/** @type {any} */ l, /** @type {string} */ id) => (renderCelula ? renderCelula(l, id) : getFieldValue(l, id) || "–"), [renderCelula, getFieldValue]);
  const gridFooter = useMemo(() => (rodape ? (/** @type {string[]} */ ids) => rodape(ids, colunaSelecao) : undefined), [rodape, colunaSelecao]);
  /** @type {any} */
  const Grade = CadastroBase1Grade;
  return (
    <div className={`b1-tabela${solta ? " b1-tabela--solta" : ""}`} data-testid={testId}>
      <Grade
        rows={lista}
        columns={colunas}
        storageKey={`${chave}${celular ? "-celular" : ""}`}
        droppableId={`colunas-${chave}`}
        getFieldValue={getFieldValue}
        renderCell={celula}
        compararParaOrdenar={comparar}
        defaultSortKey={ORDEM}
        emptyText={vazio}
        isLoading={carregando}
        onOpen={onAbrir}
        renderAcoesDaLinha={renderAcoes}
        gridFooter={gridFooter}
        quickFilterIds={SEM_LINHAS}
        {...BASE1_GRADE_REFERENCE_HEADERS}
        colunaSelecao={colunaSelecao}
      />
    </div>
  );
}
