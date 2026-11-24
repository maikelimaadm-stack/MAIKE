import React from "react";
import { X } from "lucide-react";

/**
 * D-PROD-285 — a lista de produtos do "Novo movimento" do Estoque no MESMO desenho da tabela "Áreas" do cadastro de
 * atividades (`SeletorAreasDaAtividade`, D-PROD-249): no computador, uma tabela `b1-tipo-tabela` (cabeçalho, uma linha
 * por produto com os campos editáveis nas células, números à direita, o ✕ de tirar no fim e a linha de total no
 * rodapé); no celular, a lista vira cartões (cada um com os campos rotulados e o ✕), com o total num cartão final.
 * Os campos são os mesmos componentes do formulário (o rótulo de cada um continua no DOM para leitor de tela e testes;
 * na tabela ele some da vista porque o cabeçalho da coluna já diz o que é).
 *
 * @param {{
 *   prefixo: string,
 *   linhas: any[],
 *   colunas: Array<{ id: string, titulo: string, numero?: boolean, largura?: number }>,
 *   celula: (linha: any, indice: number, colunaId: string) => React.ReactNode,
 *   detalhe?: (linha: any, indice: number) => React.ReactNode,
 *   podeRemover: boolean,
 *   onRemover: (indice: number) => void,
 *   total?: { rotulo: string, porColuna?: Record<string, React.ReactNode> },
 *   celular: boolean,
 * }} props `prefixo` forma os testids (`<prefixo>-tabela`, `<prefixo>-linha-<i>`, `<prefixo>-linha-<i>-remover`,
 *   `<prefixo>-tabela-total`). `detalhe` é o que não cabe numa célula (ex.: os lotes da saída): vai numa linha própria,
 *   logo abaixo da linha do produto (no cartão do celular, no fim do cartão).
 */
export default function TabelaProdutosMovimento({ prefixo, linhas, colunas, celula, detalhe = undefined, podeRemover, onRemover, total = undefined, celular }) {
  const botaoRemover = (/** @type {number} */ i) =>
    podeRemover ? (
      <button
        type="button"
        className="tb-btn tb-btn-icon"
        aria-label={`Remover o produto ${i + 1}`}
        title="Tirar do movimento"
        onClick={() => onRemover(i)}
        data-testid={`${prefixo}-linha-${i}-remover`}
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    ) : null;

  if (celular) {
    return (
      <ul className="col-span-12 flex min-w-0 flex-col gap-2" data-testid={`${prefixo}-tabela`}>
        {linhas.map((linha, i) => {
          const extra = detalhe ? detalhe(linha, i) : null;
          return (
            <li key={linha.chave ?? i} className="b1-mov-cartao min-w-0 rounded-[10px] border border-[var(--mg-divider,#E8E7E2)] bg-white p-3" data-testid={`${prefixo}-linha-${i}`}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-[13px] font-semibold">Produto {i + 1}</p>
                {botaoRemover(i)}
              </div>
              <div className="grid min-w-0 grid-cols-12 gap-x-3 gap-y-2">
                {colunas.map((c) => (
                  <React.Fragment key={c.id}>{celula(linha, i, c.id)}</React.Fragment>
                ))}
                {extra}
              </div>
            </li>
          );
        })}
        {total ? (
          <li className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] bg-[var(--mg-surface-2,#F5F5F2)] px-3 py-2 text-[13px] font-semibold" data-testid={`${prefixo}-tabela-total`}>
            <span>{total.rotulo}</span>
            {Object.entries(total.porColuna ?? {}).map(([k, v]) => (v ? <span key={k}>{v}</span> : null))}
          </li>
        ) : null}
      </ul>
    );
  }

  return (
    <div className="col-span-12 min-w-0 b1-tipo-tabela__rolagem">
      <table className="b1-tipo-tabela b1-mov-tabela" data-testid={`${prefixo}-tabela`}>
        <thead>
          <tr>
            {colunas.map((c) => (
              <th key={c.id} scope="col" className={c.numero ? "is-numero" : undefined} style={c.largura ? { minWidth: c.largura } : undefined}>
                {c.titulo}
              </th>
            ))}
            <th scope="col" className="b1-tipo-tabela__acoes" aria-label="Tirar" />
          </tr>
        </thead>
        <tbody>
          {linhas.map((linha, i) => {
            const extra = detalhe ? detalhe(linha, i) : null;
            return (
              <React.Fragment key={linha.chave ?? i}>
                <tr className={extra ? "tem-detalhe" : undefined} data-testid={`${prefixo}-linha-${i}`}>
                  {colunas.map((c) => (
                    <td key={c.id} className={c.numero ? "is-numero" : undefined}>
                      {celula(linha, i, c.id)}
                    </td>
                  ))}
                  <td className="b1-tipo-tabela__acoes">{botaoRemover(i)}</td>
                </tr>
                {extra ? (
                  <tr className="b1-mov-tabela__detalhe" data-testid={`${prefixo}-linha-${i}-detalhe`}>
                    <td colSpan={colunas.length + 1}>
                      <div className="grid grid-cols-12 gap-x-3 gap-y-2">{extra}</div>
                    </td>
                  </tr>
                ) : null}
              </React.Fragment>
            );
          })}
        </tbody>
        {total ? (
          <tfoot>
            <tr data-testid={`${prefixo}-tabela-total`}>
              {colunas.map((c, j) => (
                <td key={c.id} className={c.numero ? "is-numero" : undefined}>
                  {j === 0 ? total.rotulo : total.porColuna?.[c.id] ?? null}
                </td>
              ))}
              <td />
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}
