import React, { useEffect } from "react";
import { AlertCircle, Check, Plus, X } from "lucide-react";
import { CampoTexto, SecaoForm } from "@/components/gestao/GestaoFormParts";
import { BOTAO_PRIMARIO, BOTAO_SECUNDARIO } from "@/components/patrimonio/DialogosAbastecimento";
import {
  CamposDaLinhaMaoObra,
  CamposDaLinhaMaquina,
  CamposDaLinhaProduto,
  CamposDaLinhaServico,
  useMedidorDaLinha,
  useSaldoDoProduto,
} from "@/components/lancamento-atividades/JanelasDaLinha";
import { useEmpresaRealSelecionadaId } from "@/hooks/useLancamentoAtividadesSessao";
import {
  LINHAS_NO_LANCAMENTO_MAXIMO,
  ROTULO_MEDIDA,
  corpoDaLinhaMaoObra,
  corpoDaLinhaProduto,
  corpoDaLinhaServico,
  doseHa,
  formatarCustoLinha,
  formatarDose,
  formatarQuantidadeLinha,
  formatarQuantidadeMaoObra,
  formatarQuantidadeServico,
  formatarUso,
  passaDoTeto,
  unidadeDoProduto,
  usoDaLinha,
  validarLinhaProduto,
  valorDaLinhaServico,
} from "@/lib/atividadeLinhasRegras";
import { lerVc, textoDoVc } from "@/lib/camposPorTipo";

/**
 * @typedef {import("@/lib/registroDeCampoRegras").ColecaoDoRegistro} ColecaoDoRegistro
 * @typedef {import("@/lib/registroDeCampoRegras").ItemDoRegistro} ItemDoRegistro
 * @typedef {{ id: number, chave: string|null, form: any, erros: Record<string, string>, saltoPedido: boolean }} EditorDaSecao
 *   O editor aberto de uma seção: `chave` nula = item novo; senão, o item da tabela que está sendo alterado. `id` muda a
 *   cada abertura (o editor monta de novo, com os ganchos do medidor e do saldo zerados).
 * @typedef {{ id: number, medidor?: any, pedeJustificativa?: boolean, disponivel?: string|null, localNome?: string|null }} LidoNoEditor
 *   O que o editor leu e o registro precisa para validar e montar o item: o medidor da máquina (e se a justificativa do
 *   salto é pedida) ou o saldo e o nome do local do insumo.
 * @typedef {{ titulo: string, id: string, plural: string, incluir: string, novo: string, editar: string, remover: string,
 *   colunas: string[], numericas: number[] }} ConfigDaSecao
 */

/**
 * D-PROD-262 — as quatro seções do "Registrar serviço", na ordem e com os nomes da maquete "Nova realização": cada uma é
 * uma tabela com os itens incluídos e um "+ Incluir …". `id` e `plural` formam os testids (`registro-incluir-insumo`,
 * `registro-insumos-tabela`, `registro-insumo-linha-1`, `registro-remover-insumo-1`, `registro-insumo-editor`).
 */
export const SECOES_DO_REGISTRO = Object.freeze(
  /** @type {Record<ColecaoDoRegistro, ConfigDaSecao>} */ ({
    produtos: {
      titulo: "Insumos",
      id: "insumo",
      plural: "insumos",
      incluir: "Incluir insumo",
      novo: "Novo insumo",
      editar: "Editar insumo",
      remover: "Remover insumo",
      colunas: ["Insumo", "Local de estoque", "Dose/ha", "Total"],
      numericas: [2, 3],
    },
    maquinas: {
      titulo: "Máquinas",
      id: "maquina",
      plural: "maquinas",
      incluir: "Incluir máquina",
      novo: "Nova máquina",
      editar: "Editar máquina",
      remover: "Remover máquina",
      colunas: ["Máquina", "Implemento", "Uso"],
      numericas: [2],
    },
    mao_obra: {
      titulo: "Equipe",
      id: "pessoa",
      plural: "pessoas",
      incluir: "Incluir pessoa",
      novo: "Nova pessoa",
      editar: "Editar pessoa",
      remover: "Remover pessoa",
      colunas: ["Pessoa", "Medida", "Quantidade"],
      numericas: [2],
    },
    servicos: {
      titulo: "Serviço de terceiro (se houver)",
      id: "servico",
      plural: "servicos",
      incluir: "Incluir serviço",
      novo: "Novo serviço",
      editar: "Editar serviço",
      remover: "Remover serviço",
      colunas: ["Serviço", "Prestador", "Quantidade", "Total"],
      numericas: [2, 3],
    },
  }),
);

/**
 * Os textos das colunas de um item (o primeiro é o nome). O insumo calcula a dose/ha pelos hectares de AGORA — os
 * TOTAIS das áreas do registro (D-PROD-263; mudar os hectares de uma área depois muda a dose); o total dele é a
 * quantidade que sai do estoque, na unidade do produto (o custo é do servidor; com várias áreas, o servidor a reparte
 * pelos hectares). A máquina mostra o uso pelo medidor guardado no "Incluir".
 * @param {ColecaoDoRegistro} colecao @param {ItemDoRegistro} item @param {string|null} areaDoDia
 * @returns {string[]}
 */
const celulasDoItem = (colecao, item, areaDoDia) => {
  const f = item.form;
  if (colecao === "produtos") {
    const unidade = unidadeDoProduto(f.produto);
    const quantidade = corpoDaLinhaProduto(f).quantidade;
    const dose = doseHa(quantidade, areaDoDia);
    return [f.produto?.rotulo ?? "", item.localNome || "—", dose ? formatarDose(dose, unidade) : "—", formatarQuantidadeLinha(quantidade, unidade) || "—"];
  }
  if (colecao === "maquinas") {
    const uso = item.medidor ? usoDaLinha(f, item.medidor) : null;
    return [f.bem?.rotulo ?? "", f.implemento?.rotulo || "—", (uso && formatarUso(uso, item.medidor?.tipo, item.medidor?.unidade)) || "—"];
  }
  if (colecao === "mao_obra") {
    return [f.parceiro?.rotulo ?? "", ROTULO_MEDIDA[f.tipo_medida] ?? "—", formatarQuantidadeMaoObra(corpoDaLinhaMaoObra(f).quantidade, f.tipo_medida) || "—"];
  }
  return [
    f.servico?.rotulo ?? "",
    f.parceiro?.rotulo || "—",
    formatarQuantidadeServico(corpoDaLinhaServico(f).quantidade, f.servico?.unidade) || "—",
    formatarCustoLinha(valorDaLinhaServico(f)) || "—",
  ];
};

/**
 * D-PROD-273 — a linha de baixo do insumo na tabela: o VC da semente e os pontos de VC/ha (dose × VC), quando há VC.
 * @param {ColecaoDoRegistro} colecao @param {ItemDoRegistro} item @param {string|null} areaDoDia
 */
const detalheDoItem = (colecao, item, areaDoDia) => {
  if (colecao !== "produtos") return "";
  const vc = lerVc(item.form?.vc).valor;
  if (!vc) return "";
  return textoDoVc(vc, doseHa(corpoDaLinhaProduto(item.form).quantidade, areaDoDia));
};

/**
 * Os itens de uma seção: tabela (`b1-tipo-tabela`, a tabela das janelas do Base1); no celular, um cartão por item
 * (`b1-tipo-card`), sem rolagem para o lado. Clicar no item abre o editor nele; o ✕ tira o item. A recusa do servidor
 * fica embaixo do item, com a marca de erro.
 * @param {{ colecao: ColecaoDoRegistro, itens: ItemDoRegistro[], areaDoDia: string|null, celular: boolean, editandoChave: string|null,
 *   podeAbrir: boolean, bloqueado: boolean, errosDasLinhas: Record<string, string>, onAbrir: (item: ItemDoRegistro) => void,
 *   onRemover: (item: ItemDoRegistro) => void }} props
 */
function ItensDaSecao({ colecao, itens, areaDoDia, celular, editandoChave, podeAbrir, bloqueado, errosDasLinhas, onAbrir, onRemover }) {
  const cfg = SECOES_DO_REGISTRO[colecao];
  if (!itens.length) return null;
  const testId = `registro-${cfg.plural}-tabela`;
  /** @param {ItemDoRegistro} item @param {number} n */
  const botaoRemover = (item, n) => (
    <button
      type="button"
      className="tb-btn tb-btn-icon"
      aria-label={`${cfg.remover} ${n}`}
      title={`${cfg.remover} ${n}`}
      onClick={(e) => {
        e.stopPropagation();
        onRemover(item);
      }}
      disabled={bloqueado}
      data-testid={`registro-remover-${cfg.id}-${n}`}
    >
      <X className="h-4 w-4" aria-hidden />
    </button>
  );
  /** @param {ItemDoRegistro} item */
  const abrir = (item) => {
    if (podeAbrir) onAbrir(item);
  };

  if (celular) {
    return (
      <ul className="col-span-12 min-w-0 b1-tipo-cards" aria-label={cfg.titulo} data-testid={testId}>
        {itens.map((item, i) => {
          const n = i + 1;
          const [nome, ...resto] = celulasDoItem(colecao, item, areaDoDia);
          const extra = detalheDoItem(colecao, item, areaDoDia);
          const erro = errosDasLinhas[item.chave];
          const detalhe = resto
            // O par "rótulo: valor" não se parte no fim da linha do cartão (valores curtos, como "0,2 L/ha", ficam inteiros).
            .map((valor, j) => (valor && valor !== "—" ? `${cfg.colunas[j + 1]}:\u00a0${String(valor).length <= 16 ? String(valor).replace(/ /g, "\u00a0") : valor}` : ""))
            .filter(Boolean)
            .join(" · ");
          return (
            <li
              key={item.chave}
              className={`b1-tipo-card${erro ? " is-recusada" : item.chave === editandoChave ? " is-editando" : ""}`}
              data-testid={`registro-${cfg.id}-linha-${n}`}
              data-recusada={erro ? "" : undefined}
            >
              <div className="b1-tipo-card__topo">
                <button type="button" className="b1-tipo-card__nome" onClick={() => abrir(item)} disabled={!podeAbrir} data-testid={`registro-${cfg.id}-linha-${n}-abrir`}>
                  <span className="b1-tipo-card__titulo inline-flex min-w-0 items-center gap-1.5 break-words">
                    {erro ? <AlertCircle className="h-4 w-4 shrink-0 text-red-600" aria-hidden /> : null}
                    {nome}
                  </span>
                  {extra ? <span className="b1-tipo-card__valor break-words" data-testid={`registro-${cfg.id}-linha-${n}-vc`}>{extra}</span> : null}
                  {detalhe ? <span className="b1-tipo-card__valor break-words">{detalhe}</span> : null}
                </button>
                {botaoRemover(item, n)}
              </div>
              {erro ? (
                <p role="alert" className="mt-1 break-words text-[12px] text-red-700" data-testid={`registro-${cfg.id}-linha-${n}-erro`}>
                  {erro}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="col-span-12 min-w-0 b1-tipo-tabela__rolagem" data-testid={testId}>
      <table className="b1-tipo-tabela" aria-label={cfg.titulo}>
        <thead>
          <tr>
            {cfg.colunas.map((coluna, j) => (
              <th key={coluna} scope="col" className={cfg.numericas.includes(j) ? "is-numero" : undefined}>
                {coluna}
              </th>
            ))}
            <th scope="col" className="b1-tipo-tabela__acoes">
              <span className="sr-only">Remover</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {itens.map((item, i) => {
            const n = i + 1;
            const [nome, ...resto] = celulasDoItem(colecao, item, areaDoDia);
            const extra = detalheDoItem(colecao, item, areaDoDia);
            const erro = errosDasLinhas[item.chave];
            const editando = item.chave === editandoChave;
            return (
              <React.Fragment key={item.chave}>
                <tr
                  className={`${podeAbrir ? "cursor-pointer" : ""}${erro ? " is-recusada" : editando ? " is-editando" : ""}`.trim() || undefined}
                  onClick={() => abrir(item)}
                  aria-current={editando ? "true" : undefined}
                  data-recusada={erro ? "" : undefined}
                  data-testid={`registro-${cfg.id}-linha-${n}`}
                >
                  <td className="is-nome">
                    <button
                      type="button"
                      className="b1-tipo-tabela__abrir inline-flex items-center gap-1.5"
                      onClick={(e) => {
                        e.stopPropagation();
                        abrir(item);
                      }}
                      disabled={!podeAbrir}
                      data-testid={`registro-${cfg.id}-linha-${n}-abrir`}
                    >
                      {erro ? <AlertCircle className="h-4 w-4 shrink-0 text-red-600" aria-hidden /> : null}
                      {nome}
                    </button>
                    {extra ? (
                      <span className="block min-w-0 whitespace-normal text-[11px] normal-case text-[var(--mg-text-2,#475569)]" data-testid={`registro-${cfg.id}-linha-${n}-vc`}>
                        {extra}
                      </span>
                    ) : null}
                  </td>
                  {resto.map((valor, j) => (
                    <td key={cfg.colunas[j + 1]} className={cfg.numericas.includes(j + 1) ? "is-numero" : undefined}>
                      {valor}
                    </td>
                  ))}
                  <td className="b1-tipo-tabela__acoes">{botaoRemover(item, n)}</td>
                </tr>
                {erro ? (
                  <tr className="is-recusada">
                    <td colSpan={cfg.colunas.length + 1}>
                      <p role="alert" className="whitespace-normal break-words text-[12px] text-red-700" data-testid={`registro-${cfg.id}-linha-${n}-erro`}>
                        {erro}
                      </p>
                    </td>
                  </tr>
                ) : null}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Os campos do editor de INSUMO: os da linha de produto (`CamposDaLinhaProduto`), com o saldo do produto escolhido. Conta
 * para o registro o disponível e o nome do local escolhido. D-PROD-273: no Plantio de pastagem (`comVc`), o VC % do saco
 * de semente (opcional) e, com ele, os pontos de VC/ha.
 * @param {{ editor: EditorDaSecao, mudar: (mudanca: Record<string, any>, campos: string[]) => void, setForm: (f: (atual: any) => any) => void,
 *   onLido: (lido: LidoNoEditor) => void, areaDoDia: string|null, bloqueado: boolean, comVc?: boolean }} props
 */
function CamposDoInsumo({ editor, mudar, setForm, onLido, areaDoDia, bloqueado, comVc = false }) {
  const empresaId = useEmpresaRealSelecionadaId();
  const saldo = useSaldoDoProduto(empresaId, editor.form, setForm, null);
  const { aviso } = validarLinhaProduto(editor.form, { disponivel: saldo.disponivel });
  const localNome = saldo.escolhido ? String(saldo.escolhido.local_nome ?? "") || null : null;
  useEffect(() => onLido({ id: editor.id, disponivel: saldo.disponivel, localNome }));
  const campos = (
    <CamposDaLinhaProduto
      form={editor.form}
      mudar={mudar}
      erros={editor.erros}
      aviso={aviso}
      saldo={saldo}
      atividadeId=""
      areaDoDia={areaDoDia}
      bloqueado={bloqueado}
      prefixo="registro-produto"
      comObservacao={false}
      tituloGrupo={null}
    />
  );
  if (!comVc) return campos;
  const vc = lerVc(editor.form?.vc);
  const pontos = vc.valor ? textoDoVc(vc.valor, doseHa(corpoDaLinhaProduto(editor.form).quantidade, areaDoDia)) : "";
  return (
    <>
      {campos}
      <CampoTexto
        label="VC % (semente)"
        value={editor.form?.vc ?? ""}
        onChange={(v) => mudar({ vc: v }, ["vc"])}
        readOnly={bloqueado}
        error={editor.erros.vc ?? vc.erro ?? undefined}
        span={6}
        inputMode="decimal"
        maxLength={6}
        placeholder="Ex.: 50"
        keepCase
      />
      <p className="col-span-12 min-w-0 text-[12px] text-[var(--mg-text-2,#475569)] md:col-span-6 md:self-center" data-testid="registro-produto-vc-nota">
        {pontos || "opcional · está no rótulo do saco"}
      </p>
    </>
  );
}

/**
 * Os campos do editor de MÁQUINA: os da linha de máquina (`CamposDaLinhaMaquina`), com o medidor do bem na data do
 * registro. A justificativa do salto aparece quando o uso passa do teto ou o servidor a pediu (`saltoPedido`). Conta para
 * o registro o medidor lido e se a justificativa é pedida.
 * @param {{ editor: EditorDaSecao, mudar: (mudanca: Record<string, any>, campos: string[]) => void, setForm: (f: (atual: any) => any) => void,
 *   onLido: (lido: LidoNoEditor) => void, dia: string|null, permiteImplemento: boolean, bloqueado: boolean }} props
 */
function CamposDaMaquina({ editor, mudar, setForm, onLido, dia, permiteImplemento, bloqueado }) {
  const empresaId = useEmpresaRealSelecionadaId();
  // Item da tabela aberto de novo: a leitura dele vale e não é sugerida outra vez.
  const medidorDaLinha = useMedidorDaLinha(empresaId, editor.form, setForm, dia, editor.chave !== null);
  const { medidor } = medidorDaLinha;
  const uso = medidor ? usoDaLinha(editor.form, medidor) : null;
  const pedeJustificativa = editor.saltoPedido || passaDoTeto(uso, medidor?.teto ?? null);
  useEffect(() => onLido({ id: editor.id, medidor, pedeJustificativa }));
  return (
    <CamposDaLinhaMaquina
      form={editor.form}
      mudar={mudar}
      erros={editor.erros}
      medidorDaLinha={medidorDaLinha}
      permiteImplemento={permiteImplemento}
      pedeJustificativa={pedeJustificativa}
      bloqueado={bloqueado}
      prefixo="registro-maquina"
      comObservacao={false}
      tituloGrupo={null}
    />
  );
}

/**
 * O editor de uma seção, DENTRO da janela (D-PROD-252: um nível de janela só): os campos da linha (os mesmos das janelas
 * da linha) e "Incluir" (ou "Atualizar", no item da tabela) e "Cancelar". Os ganchos do medidor e do saldo vivem só
 * aqui — há no máximo um editor por seção.
 * @param {{ colecao: ColecaoDoRegistro, editor: EditorDaSecao, numero: number, mudar: (mudanca: Record<string, any>, campos: string[]) => void,
 *   setForm: (f: (atual: any) => any) => void, onLido: (lido: LidoNoEditor) => void, areaDoDia: string|null, dia: string|null,
 *   permiteImplemento: boolean, bloqueado: boolean, onIncluir: () => void, onCancelar: () => void, comVc?: boolean }} props `numero`: a
 *   posição do item na tabela (0 = item novo). D-PROD-273: `comVc` mostra o VC % no editor de insumo (Plantio de pastagem).
 */
export function EditorDaLinhaDoRegistro({ colecao, editor, numero, mudar, setForm, onLido, areaDoDia, dia, permiteImplemento, bloqueado, onIncluir, onCancelar, comVc = false }) {
  const cfg = SECOES_DO_REGISTRO[colecao];
  const editando = editor.chave !== null;
  const campos =
    colecao === "produtos" ? (
      <CamposDoInsumo editor={editor} mudar={mudar} setForm={setForm} onLido={onLido} areaDoDia={areaDoDia} bloqueado={bloqueado} comVc={comVc} />
    ) : colecao === "maquinas" ? (
      <CamposDaMaquina editor={editor} mudar={mudar} setForm={setForm} onLido={onLido} dia={dia} permiteImplemento={permiteImplemento} bloqueado={bloqueado} />
    ) : colecao === "mao_obra" ? (
      <CamposDaLinhaMaoObra form={editor.form} mudar={mudar} erros={editor.erros} bloqueado={bloqueado} prefixo="registro-mao-obra" comObservacao={false} tituloGrupo={null} />
    ) : (
      <CamposDaLinhaServico form={editor.form} mudar={mudar} erros={editor.erros} bloqueado={bloqueado} prefixo="registro-servico" comObservacao={false} tituloGrupo={null} />
    );
  return (
    <div
      role="group"
      aria-label={editando ? `${cfg.editar} ${numero}` : cfg.novo}
      className="col-span-12 min-w-0 mg-b1-form-grid b1-form-embutido b1-registro-editor grid grid-cols-12 gap-x-3 gap-y-2 rounded-[10px] border border-[var(--mg-divider,#E8E7E2)] bg-white p-3"
      data-testid={`registro-${cfg.id}-editor`}
    >
      {campos}
      <div className="col-span-12 flex flex-wrap justify-end gap-2">
        <button type="button" className={BOTAO_SECUNDARIO} onClick={onCancelar} disabled={bloqueado} data-testid={`registro-${cfg.id}-editor-cancelar`}>
          Cancelar
        </button>
        <button type="button" className={BOTAO_PRIMARIO} onClick={onIncluir} disabled={bloqueado} data-testid={`registro-${cfg.id}-editor-incluir`}>
          <Check className="h-4 w-4" aria-hidden />
          {editando ? "Atualizar" : "Incluir"}
        </button>
      </div>
    </div>
  );
}

/**
 * Uma seção de linhas do "Registrar serviço" (D-PROD-262): o título, a tabela dos itens incluídos (só com item), o editor
 * aberto e o "+ Incluir …" (some com o editor aberto e no 20º item, o máximo do servidor por coleção). Com o editor
 * preenchido aberto, os itens não abrem (o que foi digitado nele não se perde); vazio, abrir um item o troca.
 * @param {{ colecao: ColecaoDoRegistro, itens: ItemDoRegistro[], editor: EditorDaSecao|null, editorPreenchido: boolean,
 *   editorAberto: React.ReactNode, areaDoDia: string|null, celular: boolean, bloqueado: boolean, errosDasLinhas: Record<string, string>,
 *   onNovo: () => void, onAbrir: (item: ItemDoRegistro) => void, onRemover: (item: ItemDoRegistro) => void }} props
 */
export function SecaoDeLinhasDoRegistro({ colecao, itens, editor, editorPreenchido, editorAberto, areaDoDia, celular, bloqueado, errosDasLinhas, onNovo, onAbrir, onRemover }) {
  const cfg = SECOES_DO_REGISTRO[colecao];
  return (
    <>
      <SecaoForm titulo={cfg.titulo} />
      <ItensDaSecao
        colecao={colecao}
        itens={itens}
        areaDoDia={areaDoDia}
        celular={celular}
        editandoChave={editor?.chave ?? null}
        podeAbrir={!bloqueado && !editorPreenchido}
        bloqueado={bloqueado}
        errosDasLinhas={errosDasLinhas}
        onAbrir={onAbrir}
        onRemover={onRemover}
      />
      {editorAberto}
      {!editor && itens.length < LINHAS_NO_LANCAMENTO_MAXIMO ? (
        <div className="col-span-12 min-w-0">
          <button type="button" className={BOTAO_SECUNDARIO} onClick={onNovo} disabled={bloqueado} data-testid={`registro-incluir-${cfg.id}`}>
            <Plus className="h-4 w-4" aria-hidden />
            {cfg.incluir}
          </button>
        </div>
      ) : null}
    </>
  );
}
