import React, { useEffect } from "react";
import { X } from "lucide-react";
import { AvisoGestao, SecaoForm } from "@/components/gestao/GestaoFormParts";
import { BOTAO_SECUNDARIO } from "@/components/patrimonio/DialogosAbastecimento";
import { CamposDaLinhaMaquina, CamposDaLinhaProduto, useMedidorDaLinha, useSaldoDoProduto } from "@/components/lancamento-atividades/JanelasDaLinha";
import { useEmpresaRealSelecionadaId } from "@/hooks/useLancamentoAtividadesSessao";
import { passaDoTeto, usoDaLinha, validarLinhaProduto } from "@/lib/atividadeLinhasRegras";

/** Cartão de cada linha do "Repetir" (o molde do item da Central). */
const CARTAO = "col-span-12 min-w-0 rounded-lg border border-[var(--mg-divider,#cbd5e1)] bg-white p-3";
const TITULO_CARTAO = "text-[12px] font-semibold uppercase text-[var(--mg-text-2,#475569)]";

/**
 * @typedef {import("@/lib/atividadeLinhasRegras").RascunhoProduto} RascunhoProduto
 * @typedef {import("@/lib/atividadeLinhasRegras").RascunhoMaquina} RascunhoMaquina
 * @typedef {{ disponivel?: string|null, medidor?: ReturnType<typeof import("@/lib/atividadeLinhasRegras").medidorDaResposta> | null }} ContextoDaLinha
 */

/**
 * Uma linha de PRODUTO do "Repetir": os campos da janela (produto, local com saldo, quantidade na unidade do produto,
 * dose/ha), já preenchidos com a base, para o operador só ajustar.
 * @param {{ rascunho: RascunhoProduto, ordem: number, atualizar: (chave: string, f: (form: any) => any) => void, onRetirar: () => void,
 *   onContexto: (chave: string, c: ContextoDaLinha) => void, erros: Record<string, string>, atividadeId: string, areaDoDia: string|null, bloqueado: boolean }} props
 */
function RascunhoProduto({ rascunho, ordem, atualizar, onRetirar, onContexto, erros, atividadeId, areaDoDia, bloqueado }) {
  const empresaId = useEmpresaRealSelecionadaId();
  const { chave, form } = rascunho;
  const setForm = (/** @type {(f: any) => any} */ f) => atualizar(chave, f);
  const saldo = useSaldoDoProduto(empresaId, form, setForm);
  const { aviso } = validarLinhaProduto(form, { disponivel: saldo.disponivel });
  useEffect(() => onContexto(chave, { disponivel: saldo.disponivel }), [chave, saldo.disponivel]);
  /** @param {Record<string, any>} mudanca */
  const mudar = (mudanca) => atualizar(chave, (f) => ({ ...f, ...mudanca }));
  return (
    <div className={CARTAO} data-testid={`repetir-produto-${ordem}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className={TITULO_CARTAO}>Produto {ordem + 1}</p>
        <button type="button" className={`${BOTAO_SECUNDARIO} tb-btn-sm`} onClick={onRetirar} disabled={bloqueado} data-testid={`repetir-produto-${ordem}-retirar`}>
          <X size={14} aria-hidden /> Retirar
        </button>
      </div>
      <div className="mg-b1-form-grid grid grid-cols-12 gap-x-3 gap-y-2">
        <CamposDaLinhaProduto
          form={form}
          mudar={mudar}
          erros={erros}
          aviso={aviso}
          saldo={saldo}
          atividadeId={atividadeId}
          areaDoDia={areaDoDia}
          bloqueado={bloqueado}
          prefixo={`repetir-produto-${ordem}`}
          comObservacao={false}
        />
      </div>
    </div>
  );
}

/**
 * Uma linha de MÁQUINA do "Repetir": a máquina e o implemento da base; a leitura inicial é sugerida de novo pela leitura
 * vigente (na data do lançamento) e a final fica em branco; "sem medidor" traz o uso da base.
 * @param {{ rascunho: RascunhoMaquina, ordem: number, atualizar: (chave: string, f: (form: any) => any) => void, onRetirar: () => void,
 *   onContexto: (chave: string, c: ContextoDaLinha) => void, erros: Record<string, string>, dia: string|null, permiteImplemento: boolean,
 *   saltoPedido: boolean, bloqueado: boolean }} props
 */
function RascunhoMaquina({ rascunho, ordem, atualizar, onRetirar, onContexto, erros, dia, permiteImplemento, saltoPedido, bloqueado }) {
  const empresaId = useEmpresaRealSelecionadaId();
  const { chave, form } = rascunho;
  const setForm = (/** @type {(f: any) => any} */ f) => atualizar(chave, f);
  const medidorDaLinha = useMedidorDaLinha(empresaId, form, setForm, dia);
  const { medidor } = medidorDaLinha;
  useEffect(() => onContexto(chave, { medidor }), [chave, medidor?.tipo, medidor?.teto, medidor?.contador, medidor?.vigente?.leitura]);
  const uso = medidor ? usoDaLinha(form, medidor) : null;
  /** @param {Record<string, any>} mudanca */
  const mudar = (mudanca) => atualizar(chave, (f) => ({ ...f, ...mudanca }));
  return (
    <div className={CARTAO} data-testid={`repetir-maquina-${ordem}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className={TITULO_CARTAO}>Máquina {ordem + 1}</p>
        <button type="button" className={`${BOTAO_SECUNDARIO} tb-btn-sm`} onClick={onRetirar} disabled={bloqueado} data-testid={`repetir-maquina-${ordem}-retirar`}>
          <X size={14} aria-hidden /> Retirar
        </button>
      </div>
      <div className="mg-b1-form-grid grid grid-cols-12 gap-x-3 gap-y-2">
        <CamposDaLinhaMaquina
          form={form}
          mudar={mudar}
          erros={erros}
          medidorDaLinha={medidorDaLinha}
          permiteImplemento={permiteImplemento}
          pedeJustificativa={saltoPedido || passaDoTeto(uso, medidor?.teto ?? null)}
          bloqueado={bloqueado}
          prefixo={`repetir-maquina-${ordem}`}
          comObservacao={false}
        />
      </div>
    </div>
  );
}

/**
 * As linhas do "Repetir último lançamento" (D-PROD-202, §5): as de produto e de máquina do lançamento base, prontas
 * para o operador só ajustar as quantidades — tudo vai num envio só (o lançamento com `produtos[]` e `maquinas[]`,
 * numa transação no servidor). "Retirar" tira a linha deste envio (a base não muda).
 * @param {{
 *   produtos: RascunhoProduto[],
 *   maquinas: RascunhoMaquina[],
 *   produtosForaDoTipo: number,
 *   atualizarProduto: (chave: string, f: (form: any) => any) => void,
 *   atualizarMaquina: (chave: string, f: (form: any) => any) => void,
 *   retirarProduto: (chave: string) => void,
 *   retirarMaquina: (chave: string) => void,
 *   onContexto: (chave: string, c: ContextoDaLinha) => void,
 *   erros: Record<string, Record<string, string>>,
 *   saltos: Record<string, boolean>,
 *   atividadeId: string,
 *   areaDoDia: string|null,
 *   dia: string|null,
 *   permiteImplemento: boolean,
 *   bloqueado: boolean,
 * }} props
 */
export default function LinhasDoLancamento({
  produtos,
  maquinas,
  produtosForaDoTipo,
  atualizarProduto,
  atualizarMaquina,
  retirarProduto,
  retirarMaquina,
  onContexto,
  erros,
  saltos,
  atividadeId,
  areaDoDia,
  dia,
  permiteImplemento,
  bloqueado,
}) {
  if (!produtos.length && !maquinas.length && !produtosForaDoTipo) return null;
  return (
    <>
      <SecaoForm titulo="Produtos e máquinas do lançamento" />
      <p className="col-span-12 min-w-0 break-words text-[12px] text-[var(--mg-text-2,#475569)]" data-testid="repetir-linhas-nota">
        As linhas vêm do lançamento repetido: ajuste as quantidades e as leituras. Tudo é gravado junto com o lançamento, de uma vez.
      </p>
      {produtosForaDoTipo ? (
        <div className="col-span-12">
          <AvisoGestao testId="repetir-produtos-fora-do-tipo">O tipo desta atividade não permite produto: os produtos do lançamento repetido não vão.</AvisoGestao>
        </div>
      ) : null}
      {produtos.map((r, i) => (
        <RascunhoProduto
          key={r.chave}
          rascunho={r}
          ordem={i}
          atualizar={atualizarProduto}
          onRetirar={() => retirarProduto(r.chave)}
          onContexto={onContexto}
          erros={erros[r.chave] ?? {}}
          atividadeId={atividadeId}
          areaDoDia={areaDoDia}
          bloqueado={bloqueado}
        />
      ))}
      {maquinas.map((r, i) => (
        <RascunhoMaquina
          key={r.chave}
          rascunho={r}
          ordem={i}
          atualizar={atualizarMaquina}
          onRetirar={() => retirarMaquina(r.chave)}
          onContexto={onContexto}
          erros={erros[r.chave] ?? {}}
          dia={dia}
          permiteImplemento={permiteImplemento}
          saltoPedido={saltos[r.chave] === true}
          bloqueado={bloqueado}
        />
      ))}
    </>
  );
}
