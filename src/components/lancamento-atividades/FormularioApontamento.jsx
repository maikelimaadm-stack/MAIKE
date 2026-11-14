import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import B1Janela from "@/components/cadastro/base1/B1Janela";
import { DENSIDADE_BASE1 } from "@/components/cadastro/base1/B1Field";
import { MobileSheetPortalCtx } from "@/components/common/MobileSheet";
import { AvisoGestao, CampoSelect } from "@/components/gestao/GestaoFormParts";
import { CampoDia, CampoNumero } from "@/components/financeiroGestao/CamposLancamento";
import SeletorPaginadoGestao from "@/components/financeiroGestao/SeletorPaginadoGestao";
import { CampoTextoLongo } from "@/components/patrimonio/PatrimonioFormParts";
import { BOTAO_PRIMARIO, BOTAO_SECUNDARIO } from "@/components/patrimonio/DialogosAbastecimento";
import LinhasDoLancamento from "@/components/lancamento-atividades/LinhasDoLancamento";
import { useEmpresaRealSelecionadaId, useFusoDaFazenda } from "@/hooks/useLancamentoAtividadesSessao";
import { notifyInfo, notifyWarning } from "@/lib/maikeNotify";
import {
  LIMITES_DECIMAL_ATIVIDADE,
  LOCALE_ATIVIDADE,
  MAX_OBSERVACAO_ATIVIDADE,
  STATUS_ABERTA,
  STATUS_CONFIRMADO,
  formatarDiaAtividade,
  mensagemDeErroAtividade,
  rotuloDoUsuario,
} from "@/lib/lancamentoAtividadesRegras";
import {
  CAMPO_DO_FORMULARIO_APONTAMENTO,
  OPCOES_TURNO,
  RAIZ_CONSULTAS_ATIVIDADES,
  camposAlteradosDoApontamento,
  campoDoFormulario,
  corpoDoApontamento,
  foraDoPeriodo,
  formularioApontamentoVazio,
  formularioDaBase,
  formularioDoApontamento,
  mesmoConteudoDaBase,
  normalizarPaginaDeOpcoes,
  normalizarRespostaDeEscrita,
  pedeReleitura,
  rotuloDaPassada,
  siglaDaProducao,
  textoDoPeriodo,
  validarFormularioApontamento,
} from "@/lib/atividadeApontamentoRegras";
import {
  corpoDaLinhaMaquina,
  corpoDaLinhaProduto,
  linhaEmbutidaRecusada,
  linhasParaRepetir,
  campoDaLinhaRecusada,
  ehSaltoDoMedidor,
  mensagemDeErroLinha,
  passaDoTeto,
  temLinhaConfirmada,
  usoDaLinha,
  validarLinhaMaquina,
  validarLinhaProduto,
} from "@/lib/atividadeLinhasRegras";
import { criarApontamento, duplicarApontamento, editarApontamento, listarOpcoesOperadores } from "@/services/lancamentoAtividadesService";
import { CODIGO_ENVIO_PENDENTE, ehRecusaDefinitiva, ehResultadoIncerto } from "@/services/operacaoFinanceiraService";

export const FORMULARIO_APONTAMENTO_ID = "formulario-apontamento-atividade";

/**
 * Formulário do apontamento do DIA (D-PROD-200, Fatia 2), na janela do motor
 * Base1 (`B1Janela`). Só os campos do dia, nesta ordem: Data (padrão hoje no
 * fuso da fazenda, nunca futura), Turno (vazio, Manhã, Tarde ou Noite),
 * Operador, Área do dia, Produção do dia (com a sigla da unidade do cabeçalho)
 * e Observação. Área, setor, safra, centros, unidade e máquina NÃO aparecem
 * aqui: são do cabeçalho, herdados e travados. A sequência (1ª, 2ª passada) é
 * calculada pelo servidor.
 *
 * Três modos:
 *  - novo (`apontamento` e `base` nulos): POST do lançamento;
 *  - edição (`apontamento`): PATCH mínimo com a `versao` lida; só o
 *    CONFIRMADO de atividade ABERTA (o servidor também recusa);
 *  - "Repetir" (`base`): o formulário já vem com turno, operador, área do dia,
 *    produção e observação da base e a data de hoje, para o operador só
 *    ajustar. Nada é gravado antes de salvar: sem ajuste (só a data, ou nem
 *    ela), vai o DUPLICAR do servidor (a cópia fiel da base, sequência nova);
 *    com ajuste, vai um lançamento novo com os dados ajustados. Fatia 3
 *    (D-PROD-201): a base com linhas de produto e de máquina CONFIRMADAS traz
 *    as linhas preenchidas (as leituras sugeridas de novo) e vai UM lançamento
 *    novo com `produtos[]` e `maquinas[]` — tudo numa transação, com o
 *    `operation_id` persistente (sem resposta, "Repetir o mesmo envio" não
 *    duplica).
 *
 * Decimais vão em texto canônico. Fora do período da atividade o lançamento é
 * aceito com aviso (o alerta da resposta, que a lista mostra). A recusa do
 * servidor aparece no campo apontado (`field`) e no aviso da janela, com a
 * mensagem do Lançamento de Atividades. Sem resposta do servidor o resultado é
 * INCERTO (o lançamento pode ter sido gravado): a janela avisa e a lista é
 * relida (`onMudou`).
 *
 * @param {{
 *   atividade: any,
 *   apontamento?: any,
 *   base?: any,
 *   onSalvo: (resultado: { apontamento: any, atividade: any, alertas: any[] }) => void,
 *   onCancelar: () => void,
 *   onMudou?: (() => void) | null,
 *   permiteProduto?: boolean,
 *   permiteImplemento?: boolean,
 *   escopo?: string,
 * }} props `onMudou`: a atividade ou o lançamento mudou no servidor (versão, status, sumiu) ou o envio ficou sem resposta — quem abriu relê.
 */
export default function FormularioApontamento({
  atividade,
  apontamento = null,
  base = null,
  onSalvo,
  onCancelar,
  onMudou = null,
  permiteProduto = false,
  permiteImplemento = false,
  escopo = "",
}) {
  const empresaId = useEmpresaRealSelecionadaId();
  const { hoje, fuso, semFuso } = useFusoDaFazenda(empresaId);
  const existente = Boolean(apontamento?.id);
  const repetindo = !existente && Boolean(base?.id);
  const atividadeId = atividade?.id ? String(atividade.id) : "";
  const aberta = atividade?.status === STATUS_ABERTA;
  const editavel = !existente || apontamento?.status === STATUS_CONFIRMADO;
  // Campos travados quando nada pode ser gravado. O fuso ainda chegando não trava os campos: só segura o envio.
  const somenteLeitura = !empresaId || !atividadeId || !aberta || !editavel || semFuso;
  const esperandoFuso = !somenteLeitura && !fuso;
  const podeGravar = !somenteLeitura && Boolean(fuso);
  const sigla = siglaDaProducao(atividade);

  const [form, setForm] = useState(() =>
    existente ? formularioDoApontamento(apontamento) : repetindo ? formularioDaBase(base, hoje) : formularioApontamentoVazio(hoje),
  );
  const [erros, setErros] = useState(/** @type {Record<string, string>} */ ({}));
  const [erroGeral, setErroGeral] = useState(/** @type {string|null} */ (null));
  const [enviando, setEnviando] = useState(false);
  const emCurso = useRef(false);
  // A data do lançamento NOVO acompanha o "hoje" da fazenda (o fuso chegando, a virada do dia) até a pessoa mexer nela.
  const dataEditada = useRef(existente);
  // Folhas do celular (Turno, Operador) nascem dentro da janela: fora dela o diálogo bloqueia o toque.
  const [alvoFolha, setAlvoFolha] = useState(/** @type {HTMLElement | null} */ (null));

  // ─── Linhas do "Repetir" (Fatia 3) ─────────────────────────────────
  const linhasDaBase = useMemo(() => (repetindo ? linhasParaRepetir(base) : { produtos: [], maquinas: [] }), []);
  const [rascProdutos, setRascProdutos] = useState(() => linhasDaBase.produtos);
  const [rascMaquinas, setRascMaquinas] = useState(() => linhasDaBase.maquinas);
  const [errosLinhas, setErrosLinhas] = useState(/** @type {Record<string, Record<string, string>>} */ ({}));
  const [saltos, setSaltos] = useState(/** @type {Record<string, boolean>} */ ({}));
  /** Saldo e medidor que cada linha leu (para validar e montar o corpo). @type {React.MutableRefObject<Record<string, any>>} */
  const contextoLinhas = useRef({});
  // Sem `permite_produto` no tipo, os produtos da base não vão (o servidor recusaria).
  const produtosDoEnvio = permiteProduto ? rascProdutos : [];
  // A base tinha linhas: o envio é sempre o lançamento novo (o duplicar copia só os dados do dia).
  const baseTinhaLinhas = linhasDaBase.produtos.length > 0 || linhasDaBase.maquinas.length > 0;
  const comLinhas = produtosDoEnvio.length > 0 || rascMaquinas.length > 0;
  // Envio com linhas sem resposta: o próximo clique repete EXATAMENTE aquele corpo (mesma chave, sem duplicar).
  const repetirEnvio = useRef(false);
  const ultimoCorpo = useRef(/** @type {Record<string, any> | null} */ (null));
  const [incerto, setIncerto] = useState(false);
  const esquecerEnvio = () => {
    ultimoCorpo.current = null;
  };
  /** @param {string} chave @param {string[]} [campos] */
  const limparErrosDaLinha = (chave, campos = []) =>
    setErrosLinhas((e) => {
      if (!e[chave]) return e;
      const resto = campos.length ? Object.fromEntries(Object.entries(e[chave]).filter(([k]) => !campos.includes(k))) : {};
      return { ...e, [chave]: resto };
    });
  /** @param {string} chave @param {(f: any) => any} f */
  const atualizarProduto = (chave, f) => {
    setRascProdutos((l) => l.map((r) => (r.chave === chave ? { ...r, form: f(r.form) } : r)));
    limparErrosDaLinha(chave);
    esquecerEnvio();
  };
  /** @param {string} chave @param {(f: any) => any} f */
  const atualizarMaquina = (chave, f) => {
    setRascMaquinas((l) => l.map((r) => (r.chave === chave ? { ...r, form: f(r.form) } : r)));
    limparErrosDaLinha(chave);
    esquecerEnvio();
  };
  /** @param {string} chave @param {Record<string, any>} c */
  const aoContexto = (chave, c) => {
    contextoLinhas.current = { ...contextoLinhas.current, [chave]: { ...(contextoLinhas.current[chave] ?? {}), ...c } };
  };

  useEffect(() => {
    if (dataEditada.current || !hoje) return;
    setForm((f) => (f.data_operacional === hoje ? f : { ...f, data_operacional: hoje }));
  }, [hoje]);

  const bloqueado = somenteLeitura || enviando;

  /** @param {Partial<import("@/lib/atividadeApontamentoRegras").FormularioApontamento>} mudanca @param {string[]} campos */
  const mudar = (mudanca, campos) => {
    esquecerEnvio();
    setForm((f) => ({ ...f, ...mudanca }));
    setErros((e) => (campos.some((c) => e[c]) ? Object.fromEntries(Object.entries(e).filter(([k]) => !campos.includes(k))) : e));
    setErroGeral(null);
  };

  /** @param {unknown} erro @param {boolean} [enviouLinhas] */
  const tratarErro = (erro, enviouLinhas = false) => {
    const manteve = /** @type {any} */ (erro)?.code === CODIGO_ENVIO_PENDENTE;
    if (enviouLinhas) {
      // Com linhas o envio leva `operation_id`: sem resposta definitiva, o próximo clique repete o mesmo envio.
      repetirEnvio.current = manteve || !ehRecusaDefinitiva(erro);
      if (!repetirEnvio.current) ultimoCorpo.current = null;
      setIncerto(repetirEnvio.current);
    }
    if (manteve) {
      setErroGeral("Há um envio anterior deste lançamento sem resposta do servidor. Nada foi enviado agora: repita aquele envio para concluí-lo sem duplicar.");
      return;
    }
    if (ehResultadoIncerto(erro)) {
      const texto = existente
        ? "Não recebemos a resposta do servidor: a alteração PODE ter sido gravada. Feche e confira o lançamento antes de salvar de novo."
        : enviouLinhas
          ? "Não recebemos a resposta do servidor: o lançamento com os produtos e as máquinas PODE ter sido gravado. Confira a lista; se ele não estiver lá, use \"Repetir o mesmo envio\": com a mesma chave, nada é lançado nem baixado duas vezes."
          : "Não recebemos a resposta do servidor: o lançamento PODE ter sido gravado. Feche e confira a lista antes de lançar de novo: se ele já estiver lá, lançar outra vez grava mais uma passada.";
      setErroGeral(texto);
      notifyWarning("Resultado incerto", texto);
      onMudou?.();
      return;
    }
    if (enviouLinhas) {
      // A recusa que aponta uma linha embutida (índice) vai para ela: o salto pede a justificativa, o saldo, a quantidade.
      const alvo = linhaEmbutidaRecusada(erro);
      const lista = alvo?.colecao === "produtos" ? produtosDoEnvio : alvo?.colecao === "maquinas" ? rascMaquinas : null;
      let chave = lista && alvo ? lista[alvo.indice]?.chave ?? null : null;
      if (!chave && ehSaltoDoMedidor(erro) && rascMaquinas.length === 1) chave = rascMaquinas[0].chave;
      const mensagemLinha = mensagemDeErroLinha(erro, "Não foi possível gravar o lançamento. Nada foi gravado.");
      if (chave) {
        const campo = campoDaLinhaRecusada(erro);
        if (campo) setErrosLinhas((e) => ({ ...e, [/** @type {string} */ (chave)]: { ...(e[/** @type {string} */ (chave)] ?? {}), [campo]: mensagemLinha } }));
        if (ehSaltoDoMedidor(erro)) setSaltos((s) => ({ ...s, [/** @type {string} */ (chave)]: true }));
      }
      if (chave || campoDaLinhaRecusada(erro)) {
        setErroGeral(mensagemLinha);
        notifyWarning("Atenção", mensagemLinha);
        if (pedeReleitura(erro)) onMudou?.();
        return;
      }
    }
    const mensagem = enviouLinhas
      ? mensagemDeErroLinha(erro, "Não foi possível gravar o lançamento. Nada foi gravado.")
      : mensagemDeErroAtividade(erro, "Não foi possível gravar o lançamento. Nada foi gravado.");
    const campo = campoDoFormulario(erro, CAMPO_DO_FORMULARIO_APONTAMENTO);
    if (campo) setErros((e) => ({ ...e, [campo]: mensagem }));
    setErroGeral(mensagem);
    notifyWarning("Atenção", mensagem);
    if (pedeReleitura(erro)) onMudou?.();
  };

  const enviar = async () => {
    if (emCurso.current || !podeGravar) return;
    const v = validarFormularioApontamento(form, { hoje });
    setErros(v);
    if (Object.keys(v).length) {
      notifyWarning("Atenção", "Revise os campos destacados.");
      return;
    }
    const corpo = corpoDoApontamento(form);
    // Linhas do "Repetir": cada uma validada com o saldo e o medidor que ela leu.
    /** @type {Record<string, Record<string, string>>} */
    const errosDasLinhas = {};
    /** @type {Record<string, any>[]} */
    const produtos = [];
    /** @type {Record<string, any>[]} */
    const maquinas = [];
    let esperandoMedidor = false;
    for (const r of produtosDoEnvio) {
      const ctx = contextoLinhas.current[r.chave] ?? {};
      const { erros: e } = validarLinhaProduto(r.form, { disponivel: ctx.disponivel ?? null });
      if (Object.keys(e).length) errosDasLinhas[r.chave] = e;
      else produtos.push(corpoDaLinhaProduto(r.form));
    }
    for (const r of rascMaquinas) {
      const medidor = contextoLinhas.current[r.chave]?.medidor ?? null;
      if (!medidor) {
        esperandoMedidor = true;
        continue;
      }
      const pede = saltos[r.chave] === true || passaDoTeto(usoDaLinha(r.form, medidor), medidor.teto);
      const e = validarLinhaMaquina(r.form, { medidor, permiteImplemento, pedeJustificativa: pede });
      if (Object.keys(e).length) errosDasLinhas[r.chave] = e;
      else maquinas.push(corpoDaLinhaMaquina(r.form, medidor, { comJustificativa: pede }));
    }
    setErrosLinhas(errosDasLinhas);
    if (Object.keys(errosDasLinhas).length) {
      notifyWarning("Atenção", "Revise os campos destacados nas linhas de produto e de máquina.");
      return;
    }
    if (esperandoMedidor) {
      notifyInfo("Aguarde", "Lendo o medidor das máquinas: envie de novo em instantes.");
      return;
    }
    emCurso.current = true;
    setEnviando(true);
    setErroGeral(null);
    const enviouLinhas = !existente && comLinhas;
    try {
      let resposta;
      if (enviouLinhas) {
        // Retentativa: o MESMO corpo daquele envio sem resposta (a pendência casa a chave e o servidor devolve o gravado).
        const corpoComLinhas = repetirEnvio.current && ultimoCorpo.current ? ultimoCorpo.current : { ...corpo, produtos, maquinas };
        ultimoCorpo.current = corpoComLinhas;
        resposta = await criarApontamento(atividadeId, corpoComLinhas, { escopo, retentativa: repetirEnvio.current });
        repetirEnvio.current = false;
        ultimoCorpo.current = null;
        setIncerto(false);
      } else if (existente) {
        const mudancas = camposAlteradosDoApontamento(apontamento, corpo);
        if (!Object.keys(mudancas).length) {
          notifyInfo("Sem alterações", "Nada foi alterado.");
          onCancelar();
          return;
        }
        resposta = await editarApontamento(atividadeId, String(apontamento.id), { ...mudancas, versao: apontamento.versao });
      } else if (repetindo && !baseTinhaLinhas && mesmoConteudoDaBase(form, base)) {
        resposta = await duplicarApontamento(atividadeId, String(base.id), { data_operacional: corpo.data_operacional });
      } else {
        // A porta tira as chaves vazias da criação: o opcional não informado não vai.
        resposta = await criarApontamento(atividadeId, corpo);
      }
      onSalvo(normalizarRespostaDeEscrita(resposta));
    } catch (erro) {
      tratarErro(erro, enviouLinhas);
    } finally {
      emCurso.current = false;
      setEnviando(false);
    }
  };

  const passada = existente ? rotuloDaPassada(apontamento?.sequencia) : "";
  const titulo = existente
    ? `Editar lançamento de ${formatarDiaAtividade(apontamento?.data_operacional)}${passada ? ` (${passada})` : ""}`
    : repetindo
      ? "Repetir lançamento"
      : "Novo lançamento";
  const daAtividade = [atividade?.numero != null ? `Atividade nº ${atividade.numero}` : "Atividade", typeof atividade?.nome === "string" ? atividade.nome : ""]
    .filter(Boolean)
    .join(" — ");
  const passadaDaBase = repetindo ? rotuloDaPassada(base?.sequencia) : "";
  const daBase = repetindo
    ? ` Os dados vêm do lançamento de ${formatarDiaAtividade(base?.data_operacional)}${passadaDaBase ? ` (${passadaDaBase})` : ""}: ajuste o que mudou e salve. Nada é gravado antes de salvar.`
    : "";
  const periodo = textoDoPeriodo(atividade?.data_inicio, atividade?.data_prevista_fim);
  const fora = !somenteLeitura && foraDoPeriodo(form.data_operacional, atividade);

  let aviso = null;
  if (!empresaId) aviso = "Selecione uma fazenda para lançar.";
  else if (!aberta) aviso = "Esta atividade não está aberta: ela não aceita lançamento novo nem edição.";
  else if (!editavel) aviso = "Este lançamento está cancelado: ele continua no histórico e não aceita edição.";
  else if (semFuso) aviso = "Configure o fuso horário da fazenda (Empresa → Fuso horário) antes de lançar: o servidor recusa sem ele.";

  const rotuloDoEnvio = incerto ? "Repetir o mesmo envio" : existente ? "Salvar alterações" : repetindo ? "Repetir lançamento" : "Lançar";
  // A data do lançamento com linha confirmada não muda (o servidor recusa: ATIVIDADE_DATA_COM_LINHAS).
  const dataTravada = existente && temLinhaConfirmada(apontamento);

  return (
    <B1Janela
      aberto
      onFechar={onCancelar}
      podeFechar={!enviando}
      // Folha do celular aberta dentro da janela: o pedido de fechar (Escape) fecha só a folha.
      aoPedirFechar={() => !alvoFolha?.querySelector(".mk-sheet-root")}
      titulo={titulo}
      descricao={`${daAtividade}.${daBase}`}
      testId="janela-apontamento"
      // Os botões daqui seguem as ações da tela (lançar/editar apontamento): a heurística de texto do Layout não vale.
      contentProps={{ "data-permissao-explicita": "" }}
      fora={<div ref={setAlvoFolha} className="contents" data-testid="janela-apontamento-alvo-folha" />}
      rodape={
        <>
          <button type="button" className={BOTAO_SECUNDARIO} onClick={onCancelar} disabled={enviando} data-testid="apontamento-voltar">
            <X className="h-4 w-4" aria-hidden />
            Voltar
          </button>
          <button type="submit" form={FORMULARIO_APONTAMENTO_ID} className={BOTAO_PRIMARIO} disabled={enviando || !podeGravar} data-testid="apontamento-salvar">
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
            {enviando ? "Salvando…" : rotuloDoEnvio}
          </button>
        </>
      }
    >
      <MobileSheetPortalCtx.Provider value={alvoFolha}>
        <form
          id={FORMULARIO_APONTAMENTO_ID}
          onSubmit={(e) => {
            e.preventDefault();
            void enviar();
          }}
          className="b1 mg-b1-form-grid b1-form-embutido"
          data-densidade={DENSIDADE_BASE1}
          noValidate
          data-testid="b1-form-apontamento"
          data-modo={existente ? "edicao" : repetindo ? "repetir" : "novo"}
        >
          {aviso ? (
            <div className="col-span-12">
              <AvisoGestao testId="apontamento-aviso">{aviso}</AvisoGestao>
            </div>
          ) : null}
          {esperandoFuso ? (
            <p role="status" className="col-span-12 text-[12px] text-[var(--mg-text-2,#475569)]" data-testid="apontamento-esperando-fuso">
              Lendo o fuso horário da fazenda para conferir o dia: o envio libera assim que ele chegar.
            </p>
          ) : null}
          <CampoDia
            label="Data"
            value={form.data_operacional}
            onChange={(v) => {
              dataEditada.current = true;
              mudar({ data_operacional: v }, ["data_operacional"]);
            }}
            max={hoje || undefined}
            readOnly={bloqueado || dataTravada}
            required
            span={6}
            error={erros.data_operacional}
            testId="apontamento-data"
          />
          <CampoSelect
            label="Turno"
            value={form.turno}
            onChange={(v) => mudar({ turno: v }, ["turno"])}
            options={[...OPCOES_TURNO]}
            placeholder="Sem turno"
            readOnly={bloqueado}
            span={6}
            error={erros.turno}
          />
          {fora ? (
            <div className="col-span-12">
              <AvisoGestao testId="apontamento-fora-do-periodo">
                Esta data fica fora do período da atividade{periodo ? ` (${periodo})` : ""}. O lançamento é aceito, com aviso.
              </AvisoGestao>
            </div>
          ) : null}
          <SeletorPaginadoGestao
            rotulo="Operador"
            testId="apontamento-operador"
            chave={[RAIZ_CONSULTAS_ATIVIDADES, "operadores", empresaId]}
            buscar={async ({ q, cursor, limit }) => normalizarPaginaDeOpcoes(await listarOpcoesOperadores({ q, cursor, limit }))}
            value={form.operador}
            onChange={(o) => mudar({ operador: o ? { id: String(o.id), rotulo: rotuloDoUsuario(o) || String(o.id) } : null }, ["operador"])}
            rotuloDaOpcao={rotuloDoUsuario}
            readOnly={bloqueado}
            permitirLimpar
            erro={erros.operador}
            span={12}
            maiusculas={false}
          />
          <CampoNumero
            label="Área do dia (ha)"
            value={form.area_executada_dia}
            onChange={(v) => mudar({ area_executada_dia: v }, ["area_executada_dia"])}
            locale={LOCALE_ATIVIDADE}
            limites={LIMITES_DECIMAL_ATIVIDADE}
            readOnly={bloqueado}
            span={6}
            error={erros.area_executada_dia}
            testId="apontamento-area-dia"
          />
          <CampoNumero
            label={sigla ? `Produção do dia (${sigla})` : "Produção do dia"}
            value={form.quantidade_produzida_dia}
            onChange={(v) => mudar({ quantidade_produzida_dia: v }, ["quantidade_produzida_dia"])}
            locale={LOCALE_ATIVIDADE}
            limites={LIMITES_DECIMAL_ATIVIDADE}
            readOnly={bloqueado}
            span={6}
            error={erros.quantidade_produzida_dia}
            testId="apontamento-producao-dia"
          />
          <CampoTextoLongo
            label="Observação"
            value={form.observacao}
            onChange={(v) => mudar({ observacao: v }, ["observacao"])}
            readOnly={bloqueado}
            maxLength={MAX_OBSERVACAO_ATIVIDADE}
          />
          {dataTravada ? (
            <p className="col-span-12 min-w-0 break-words text-[12px] text-[var(--mg-text-2,#475569)]" data-testid="apontamento-data-travada">
              A data não muda enquanto houver produto ou máquina confirmados neste lançamento: para mudar o dia, cancele o lançamento e lance de novo.
            </p>
          ) : null}
          {repetindo ? (
            <LinhasDoLancamento
              produtos={produtosDoEnvio}
              maquinas={rascMaquinas}
              produtosForaDoTipo={permiteProduto ? 0 : rascProdutos.length}
              atualizarProduto={atualizarProduto}
              atualizarMaquina={atualizarMaquina}
              retirarProduto={(chave) => {
                esquecerEnvio();
                setRascProdutos((l) => l.filter((r) => r.chave !== chave));
              }}
              retirarMaquina={(chave) => {
                esquecerEnvio();
                setRascMaquinas((l) => l.filter((r) => r.chave !== chave));
              }}
              onContexto={aoContexto}
              erros={errosLinhas}
              saltos={saltos}
              atividadeId={atividadeId}
              areaDoDia={corpoDoApontamento(form).area_executada_dia}
              dia={form.data_operacional || null}
              permiteImplemento={permiteImplemento}
              bloqueado={bloqueado}
            />
          ) : null}
          {erroGeral ? (
            <div className="col-span-12">
              <AvisoGestao testId="apontamento-erro">{erroGeral}</AvisoGestao>
            </div>
          ) : null}
        </form>
      </MobileSheetPortalCtx.Provider>
    </B1Janela>
  );
}
