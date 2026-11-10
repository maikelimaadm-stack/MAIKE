import React, { useState } from "react";
import { X } from "lucide-react";
import SeletorPaginadoGestao from "@/components/financeiroGestao/SeletorPaginadoGestao";
import { AvisoGestao, SecaoForm } from "@/components/gestao/GestaoFormParts";
import { disponibilidadeDoProduto, listarOpcoesProdutosCombustivel } from "@/services/combustivelProdutoService";

/** Texto de ajuda do cadastro: o operador escolhe o Produto; o combustível só define os tanques. */
export const AJUDA_PRODUTOS_NOVO_COMBUSTIVEL =
  "Escolha os Produtos do estoque desta fazenda que são este combustível. Eles são associados logo depois de salvar. No abastecimento, quem abastece escolhe o Produto; o combustível só define quais tanques o aceitam.";

export const AVISO_FAZENDA_MUDOU = "A fazenda mudou: os Produtos escolhidos eram da fazenda anterior e foram retirados. Escolha de novo.";

export const NOTA_COMBUSTIVEL_M3 = "Combustível em m³ não é usado em tanques: estas associações não aparecem no abastecimento.";

/**
 * Enter na busca do seletor não envia o formulário do combustível (a busca já
 * vai ao servidor enquanto se digita). @param {React.KeyboardEvent} e
 */
const segurarEnterDaBusca = (e) => {
  const alvo = /** @type {any} */ (e.target);
  if (e.key === "Enter" && alvo?.tagName === "INPUT" && alvo.type === "search") e.preventDefault();
};

/**
 * Escolha de VÁRIOS Produtos ativos da fazenda (seletor paginado no servidor +
 * lista "A associar"). Só escolhe: quem grava é o pai. O Produto já associado a
 * outro combustível (ou a este, com `tipoId`) aparece marcado e não entra na
 * lista — o motivo legível fica num `role="alert"` (o servidor continua sendo a
 * barreira final: 409). Chave = IDs, nunca nomes.
 *
 * Renderiza dentro de uma grade de 12 colunas.
 *
 * @param {{
 *   empresaId: string,
 *   tipoId: string|null,
 *   escolhidos: Array<{ id: string, nome: string }>,
 *   onChange: (proximos: Array<{ id: string, nome: string }>) => void,
 *   readOnly?: boolean,
 *   chave: unknown[],
 *   ids: { seletor: string, bloqueado: string, lista: string, pendente: (id: string) => string },
 * }} props
 */
export function EscolhaDeProdutos({ empresaId, tipoId, escolhidos, onChange, readOnly = false, chave, ids }) {
  const [bloqueio, setBloqueio] = useState(/** @type {string|null} */ (null));
  const escolhidosIds = new Set(escolhidos.map((p) => String(p.id)));

  /** @param {any} opcao */
  const escolher = (opcao) => {
    if (!opcao) return;
    const d = disponibilidadeDoProduto(opcao, tipoId);
    if (!d.livre) {
      setBloqueio(d.motivo);
      return;
    }
    setBloqueio(null);
    const id = String(opcao.id);
    if (escolhidosIds.has(id)) return;
    onChange([...escolhidos, { id, nome: String(opcao.nome ?? "") }]);
  };

  /** @param {string} id */
  const remover = (id) => onChange(escolhidos.filter((p) => String(p.id) !== id));

  return (
    <>
      <SeletorPaginadoGestao
        rotulo="Produto desta fazenda"
        testId={ids.seletor}
        chave={chave}
        buscar={({ q, cursor, limit }) => listarOpcoesProdutosCombustivel(empresaId, { q, cursor, limit })}
        value={null}
        onChange={escolher}
        rotuloDaOpcao={(o) => String(o?.nome ?? "")}
        detalheDaOpcao={(o) => {
          const detalhe = disponibilidadeDoProduto(o, tipoId).detalhe;
          return escolhidosIds.has(String(o?.id)) ? [detalhe, "já escolhido"].filter(Boolean).join(" · ") : detalhe;
        }}
        readOnly={readOnly}
        textoVazio="— Escolha um Produto para adicionar —"
        span={12}
      />
      {bloqueio ? (
        <p className="col-span-12 text-xs text-amber-800" role="alert" data-testid={ids.bloqueado}>
          {bloqueio}
        </p>
      ) : null}
      <div className="col-span-12 min-w-0">
        <p className="text-[11px] font-semibold text-[var(--mg-text-2,#475569)]">A associar ({escolhidos.length})</p>
        {escolhidos.length ? (
          <ul className="mt-1 flex flex-wrap gap-1.5" aria-label="A associar" data-testid={ids.lista}>
            {escolhidos.map((p) => (
              <li
                key={p.id}
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-[var(--mg-divider,#cbd5e1)] bg-white py-0.5 pl-3 pr-1 text-xs"
                data-testid={ids.pendente(p.id)}
              >
                <span className="min-w-0 break-words font-medium uppercase">{p.nome}</span>
                <button
                  type="button"
                  aria-label={`Remover ${p.nome}`}
                  disabled={readOnly}
                  onClick={() => remover(String(p.id))}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-slate-100"
                >
                  <X aria-hidden size={14} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-xs text-[var(--mg-text-2,#475569)]">Nenhum Produto escolhido.</p>
        )}
      </div>
    </>
  );
}

/**
 * "Produtos associados nesta fazenda" no cadastro de um combustível NOVO
 * (UX-02, D-PROD-160). Escolhe os Produtos ANTES de salvar; o pai cria o
 * combustível e associa cada um (endpoints existentes) com resultado
 * explícito. O catálogo é do tenant; os Produtos e a associação são da fazenda
 * selecionada — sem fazenda só avisa (o combustível pode ser salvo sem
 * Produtos e associado depois).
 *
 * @param {{
 *   empresaId: string|null,
 *   empresaNome?: string|null,
 *   unidade: string,
 *   pendentes: Array<{ id: string, nome: string }>,
 *   onChange: (proximos: Array<{ id: string, nome: string }>) => void,
 *   fazendaMudou?: boolean,
 *   readOnly?: boolean,
 * }} props
 */
export default function ProdutosNovoCombustivel({ empresaId, empresaNome = null, unidade, pendentes, onChange, fazendaMudou = false, readOnly = false }) {
  return (
    <>
      <SecaoForm titulo="Produtos associados nesta fazenda" />
      <div className="col-span-12 min-w-0" role="group" aria-label="Produtos associados nesta fazenda" data-testid="combustivel-novo-produtos" onKeyDown={segurarEnterDaBusca}>
        {empresaId ? (
          <>
            <p className="text-xs font-medium text-[var(--mg-text-1,#0f172a)]" data-testid="combustivel-novo-fazenda">
              Fazenda: {empresaNome || "a selecionada no topo da tela"}
            </p>
            <p className="mb-2 mt-1 text-[11px] text-[var(--mg-text-2,#475569)]">{AJUDA_PRODUTOS_NOVO_COMBUSTIVEL}</p>
          </>
        ) : null}
        {unidade !== "L" ? (
          <AvisoGestao tone="blue" testId="combustivel-novo-nota-m3">
            {NOTA_COMBUSTIVEL_M3}
          </AvisoGestao>
        ) : null}
        {fazendaMudou ? <AvisoGestao testId="combustivel-novo-fazenda-mudou">{AVISO_FAZENDA_MUDOU}</AvisoGestao> : null}
        {empresaId ? (
          <div className="mg-b1-form-grid grid grid-cols-12 gap-x-3 gap-y-2">
            <EscolhaDeProdutos
              key={empresaId}
              empresaId={empresaId}
              tipoId={null}
              escolhidos={pendentes}
              onChange={onChange}
              readOnly={readOnly}
              chave={["patrimonio", "combustivel-novo-produtos", empresaId]}
              ids={{
                seletor: "combustivel-novo-produto-seletor",
                bloqueado: "combustivel-novo-bloqueado",
                lista: "combustivel-novo-pendentes",
                pendente: (id) => `combustivel-novo-pendente-${id}`,
              }}
            />
          </div>
        ) : (
          <AvisoGestao testId="combustivel-novo-sem-empresa">
            Selecione uma fazenda no topo da tela para associar Produtos. O combustível pode ser salvo sem Produtos e associado depois.
          </AvisoGestao>
        )}
      </div>
    </>
  );
}
