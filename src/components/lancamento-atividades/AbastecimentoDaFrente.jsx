import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Loader2 } from "lucide-react";
import B1Field, { B1_FIELD_CTL_CLS, DENSIDADE_BASE1 } from "@/components/cadastro/base1/B1Field";
import B1Select from "@/components/cadastro/base1/B1Select";
import { AvisoGestao, CampoTexto } from "@/components/gestao/GestaoFormParts";
import { CampoNumero } from "@/components/financeiroGestao/CamposLancamento";
import CampoLotes from "@/components/estoque/CampoLotes";
import { BOTAO_PRIMARIO, BOTAO_SECUNDARIO, CorpoDaPreviaAbastecimento, useEnvioAbastecimento } from "@/components/patrimonio/DialogosAbastecimento";
import { TEXTO_SEM_PRODUTO } from "@/components/patrimonio/FormularioAbastecimento";
import { useEmpresaRealSelecionadaId } from "@/hooks/useLancamentoAtividadesSessao";
import { useFluxoAbastecimento } from "@/hooks/useFluxoAbastecimento";
import { useOpcoesDoAbastecimento } from "@/hooks/useOpcoesDoAbastecimento";
import {
  LIMITES_ABASTECIMENTO,
  LIMITES_CUSTO_EXTERNO,
  LOCALE_ABASTECIMENTO,
  ORIGEM_ESTOQUE,
  ORIGEM_EXTERNO,
  dicaDaUnidadeDoProduto,
  ehExterno,
  formatarLitrosCurto,
  medidorDoFormulario,
  medidorExigeLeitura,
  opcaoNoFormulario,
  rotuloDaUnidade,
  tanqueDoFormulario,
  unidadeDoFormulario,
  validarFormulario,
} from "@/lib/abastecimentoRegras";
import { formatarDecimalLinha } from "@/lib/atividadeLinhasRegras";
import { formatarHorimetro as formatarHorimetroCanonico } from "@/lib/aberturaServicoRegras";
import { lerNumeroLocal } from "@/lib/dinheiroDecimal";
import { mensagemDeErroAtividade } from "@/lib/lancamentoAtividadesRegras";
import { notifyWarning } from "@/lib/maikeNotify";
import { mensagemErroAbastecimento } from "@/lib/patrimonioErros";

/** O id do formulário: o botão "Salvar abastecimento" fica no rodapé da janela (fora do <form>) e o referencia por `form=`. */
const ID_FORMULARIO = "formulario-abastecimento-frente";
/** O nome do rótulo do contador, como o formulário real (Horímetro/Odômetro/Ciclos). */
const ROTULO_CONTADOR = /** @type {Record<string, string>} */ ({ HORIMETRO: "Horímetro", ODOMETRO: "Odômetro", CICLOS: "Ciclos" });
/** A linha "último …" embaixo do campo do contador. */
const TEXTO_ULTIMA_LEITURA = /** @type {Record<string, string>} */ ({
  HORIMETRO: "Último horímetro desta máquina",
  ODOMETRO: "Último odômetro desta máquina",
  CICLOS: "Última leitura de ciclos desta máquina",
});
/** Mensagem de falha quando o abastecimento nem começou (nada gravado). */
const MSG_NAO_GRAVADO = "Não foi possível registrar o abastecimento. Nada foi gravado.";

/** @param {any} p o Produto da opção (o nome real do estoque) */
const rotuloDoProduto = (p) => String(p?.produto?.nome ?? "");
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

/**
 * Campo de escolha Base1 (o mesmo do Diário: cabeçalho, ajuda e a opção vazia quando pedida).
 * @param {{ label: string, value: string, onChange: (v: string) => void, options: Array<{ value: string, label: string }>, required?: boolean, error?: string, opcaoVazia?: string, testId: string, readOnly?: boolean }} props
 */
function CampoEscolha({ label, value, onChange, options, required = false, error = undefined, opcaoVazia = undefined, testId, readOnly = false }) {
  return (
    <B1Field label={label} required={required} span={12} hasValue={Boolean(value)} locked={readOnly} disabled={readOnly} error={error}>
      <B1Select aria-label={label} value={value ?? ""} onChange={(e) => onChange(e.target.value)} disabled={readOnly} className={B1_FIELD_CTL_CLS} pesquisa="sempre" data-testid={testId}>
        {opcaoVazia !== undefined ? <option value="">{opcaoVazia}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </B1Select>
    </B1Field>
  );
}

/** @param {{ texto: string|undefined }} props */
function ErroDoCampo({ texto }) {
  return texto ? <p className="col-span-12 -mt-1 text-[12px] text-red-700">{texto}</p> : null;
}

/**
 * D-PROD-359 — o "Abastecimento" da frente (máquina + implemento) do Diário das atividades, na MESMA janela do serviço
 * aberto (como a "Carga de insumo"). Usa o fluxo que já existe (`useFluxoAbastecimento`: a prévia no servidor, a
 * confirmação com `operation_id` e a baixa do estoque da tabela de abastecimentos); nada de gravação nova.
 *
 * Tela: o cabeçalho (Abastecimento · "Abastecer o <máquina>"), a origem (Tanque da fazenda | Posto externo), o Produto, o
 * tanque (só se a máquina tem mais de um que aceita o Produto), o local do estoque com o saldo, a quantidade (a unidade do
 * cadastro do Produto), o contador da máquina (quando tem) com a última leitura, e o Responsável (só leitura: a frente).
 *
 * "Salvar abastecimento": valida; cria (ou acha) o registro do dia da frente (`garantirRegistroDoDia`, do Diário, que é o
 * `apontamento_id`); pede a prévia; sem bloqueio, confirma direto. Com bloqueio (saldo insuficiente…), ou se o envio falhar
 * (resultado incerto ou recusa), mostra a revisão NA MESMA tela, com "Confirmar abastecimento"/"Repetir o mesmo envio" e
 * "Corrigir os dados". Nunca abre outro popup.
 *
 * @param {{
 *   bemId: string,                       // a máquina da frente
 *   bemNome: string,                     // o nome dela (a linha "Abastecer o …")
 *   responsavelNome: string,             // o responsável da abertura (só leitura)
 *   hoje: string,                        // o "hoje" da fazenda (AAAA-MM-DD)
 *   podeGravar: boolean,
 *   podeCriar: boolean,                  // a permissão de criar abastecimento (`useAcoesTelaAbastecimento().criar`)
 *   escopo: string,
 *   alvoRodape: HTMLElement | null,      // o lugar do botão do rodapé da janela
 *   garantirRegistroDoDia: () => Promise<string>, // o id do apontamento do dia da frente (cria se preciso)
 *   onEnviando?: (enviando: boolean) => void,     // o abastecimento está saindo (o pai trava voltar e fechar)
 *   onSalvo: (registro: any) => void,    // confirmado no servidor: o pai volta ao serviço e relê "Lançado hoje"
 * }} props
 */
export default function AbastecimentoDaFrente({
  bemId,
  bemNome,
  responsavelNome,
  hoje,
  podeGravar,
  podeCriar,
  escopo,
  alvoRodape,
  garantirRegistroDoDia,
  onEnviando = undefined,
  onSalvo,
}) {
  const empresaId = useEmpresaRealSelecionadaId();
  const fluxo = useFluxoAbastecimento({
    empresaId,
    hoje,
    podeCriar,
    escopo,
    onConcluido: (registro, _emp, tipo) => {
      if (tipo === "confirmar") onSalvo(registro);
    },
  });
  const { form, setForm, erros, limparErro } = fluxo;
  const opcoes = useOpcoesDoAbastecimento({ empresaId, bemId, form, setForm });
  const { itens, semProduto, produtosQuery, locaisQuery, locais, indisponivel, setIndisponivel } = opcoes;

  // A máquina do formulário é a do SERVIDOR (o `bem` de Produtos do bem: traz o medidor e a leitura vigente). Enquanto ela
  // não chega, o formulário não aparece (o medidor decide o contador).
  const bemDoServidor = opcoes.respostaDoBem?.bem ?? null;
  useEffect(() => {
    if (bemDoServidor) setForm((f) => (f.bem ? f : { ...f, bem: bemDoServidor }));
  }, [bemDoServidor, setForm]);
  const pronto = Boolean(form.bem);

  // O envio (um por vez, com o aviso de resultado incerto), a revisão na própria tela e o "ocupado" do rodapé.
  const envio = useEnvioAbastecimento(fluxo.confirmarDaPrevia, "Não foi possível confirmar o abastecimento. Nada foi gravado.");
  const [criandoRegistro, setCriandoRegistro] = useState(false);
  const [revisao, setRevisao] = useState(false);
  const ocupado = envio.estado.fase === "enviando" || fluxo.previando || criandoRegistro;
  // Erro ou resultado incerto do envio: a revisão mostra o aviso (com repetir/consultar) na mesma tela.
  useEffect(() => {
    if (envio.estado.fase === "erro" || envio.estado.fase === "incerto") setRevisao(true);
  }, [envio.estado.fase]);
  // O pai trava o voltar e o fechar enquanto o abastecimento está saindo (senão a janela some com o envio no ar).
  useEffect(() => {
    onEnviando?.(ocupado);
    return () => onEnviando?.(false);
  }, [ocupado]);

  const previa = fluxo.previa?.resposta ?? null;
  const bloqueios = Array.isArray(previa?.bloqueios) ? previa.bloqueios : [];
  const podeConfirmar = podeCriar && Boolean(previa?.plano) && bloqueios.length === 0;

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
  /** Origem: Tanque da fazenda (estoque) ou Posto externo (sem local, sem baixa; pede o valor da nota). @param {string} origem */
  const trocarOrigem = (origem) => {
    if (ocupado) return;
    if (origem === ORIGEM_EXTERNO) mudar({ origem: ORIGEM_EXTERNO, local_estoque_id: null }, ["local_estoque_id"]);
    else mudar({ origem: ORIGEM_ESTOQUE, custo_total: "", referencia_externa: "" }, ["custo_total", "referencia_externa"]);
  };

  /** "Salvar abastecimento": valida, cria/acha o registro do dia, pede a prévia e confirma direto (sem bloqueio). */
  const salvar = async () => {
    if (ocupado || !podeGravar || !pronto) return;
    // A validação é a da prévia (a mesma): com erro, a própria prévia mostra os campos destacados e não cria nada.
    const erroDeCampo = validarFormulario(form, { hoje, capacidadeLitros: tanqueDoFormulario(form)?.capacidade_litros ?? null, unidade: unidadeDoFormulario(form) }).erros;
    if (Object.keys(erroDeCampo).length) {
      await fluxo.pedirPrevia();
      return;
    }
    let apontamentoId;
    setCriandoRegistro(true);
    try {
      apontamentoId = await garantirRegistroDoDia();
    } catch (erro) {
      notifyWarning("Não foi possível registrar o abastecimento", mensagemDeErroAtividade(erro, MSG_NAO_GRAVADO));
      return;
    } finally {
      setCriandoRegistro(false);
    }
    const nova = await fluxo.pedirPrevia({ apontamento_id: apontamentoId });
    if (!nova) return;
    if (!nova.resposta?.plano || (Array.isArray(nova.resposta?.bloqueios) && nova.resposta.bloqueios.length)) {
      setRevisao(true);
      return;
    }
    setRevisao(false);
    await envio.disparar(null);
  };

  /** "Consultar" depois de um envio sem resposta: o que já foi gravado conta como gravado (a tela sai sozinha). */
  const consultar = async () => {
    const texto = await fluxo.consultarConfirmacao();
    if (texto) envio.setEstado((e) => ({ ...e, consulta: texto }));
  };
  /** "Corrigir os dados": volta ao formulário (o envio anterior, se houve, segue como estava). */
  const corrigir = () => setRevisao(false);

  // ─── O formulário ──────────────────────────────────────────────────
  const externo = ehExterno(form);
  const produto = form.produto ?? null;
  const produtoId = produto?.id ? String(produto.id) : null;
  const tanquesDoProduto = /** @type {any[]} */ (Array.isArray(produto?.tanques) ? produto.tanques : []);
  const tipoMedidor = medidorDoFormulario(form);
  const contador = medidorExigeLeitura(tipoMedidor);
  const unidadeProduto = rotuloDaUnidade(produto?.unidade_principal_estoque) || "—";
  const dicaDaUnidade = dicaDaUnidadeDoProduto(produto?.unidade_principal_estoque);
  const localEscolhido = locais.find((l) => String(l.local_estoque_id) === String(form.local_estoque_id)) ?? null;
  const leituraVigente = opcoes.respostaDoBem?.bem?.leitura_vigente ?? null;

  const formulario = (
    <form
      id={ID_FORMULARIO}
      className="grid grid-cols-12 gap-3 b1-form-embutido b1-realizacao__abertura"
      data-densidade={DENSIDADE_BASE1}
      noValidate
      data-testid="abastecimento-frente-form"
      onSubmit={(e) => {
        e.preventDefault();
        void salvar();
      }}
    >
      <div className="col-span-12 b1-carga-cab" data-testid="abastecimento-cabecalho">
        <strong>Abastecimento</strong>
        <span>{bemNome ? `Abastecer o ${bemNome}` : "Abastecer a máquina desta frente"}</span>
      </div>
      <div className="col-span-12 b1-carga-modo" role="group" aria-label="Origem do abastecimento">
        <button type="button" className={externo ? undefined : "on"} aria-pressed={!externo} onClick={() => trocarOrigem(ORIGEM_ESTOQUE)} disabled={ocupado} data-testid="abastecimento-origem-estoque">
          Tanque da fazenda
        </button>
        <button type="button" className={externo ? "on" : undefined} aria-pressed={externo} onClick={() => trocarOrigem(ORIGEM_EXTERNO)} disabled={ocupado} data-testid="abastecimento-origem-externo">
          Posto externo
        </button>
      </div>

      {produtosQuery.isError && pronto ? (
        <div className="col-span-12">
          <AvisoGestao testId="abastecimento-frente-produtos-erro">
            {mensagemErroAbastecimento(produtosQuery.error, "Não foi possível ler os Produtos deste bem.")}{" "}
            <button type="button" className="underline" onClick={() => produtosQuery.refetch()}>
              Tentar novamente
            </button>
          </AvisoGestao>
        </div>
      ) : null}
      {semProduto ? (
        <div className="col-span-12">
          <AvisoGestao testId="abastecimento-frente-sem-produto">
            {TEXTO_SEM_PRODUTO[String(opcoes.resumo?.motivo_sem_opcao ?? "tanque_sem_produto")] ?? TEXTO_SEM_PRODUTO.tanque_sem_produto}
          </AvisoGestao>
        </div>
      ) : null}
      {indisponivel && !produto ? (
        <p role="alert" className="col-span-12 rounded-md border border-amber-300 bg-amber-50 p-2 text-[12px] text-amber-900" data-testid="abastecimento-frente-indisponivel">
          O Produto escolhido deixou de estar disponível para esta máquina. Escolha de novo.
        </p>
      ) : null}
      {!semProduto && itens.length ? (
        <CampoEscolha
          label="Produto"
          required
          value={produtoId ?? ""}
          onChange={(v) => {
            const item = itens.find((i) => String(i?.produto?.id ?? "") === v);
            if (item) escolherProduto(item);
          }}
          options={itens.map((i) => ({ value: String(i.produto.id), label: rotuloDoProduto(i) }))}
          opcaoVazia="— Escolha o Produto —"
          error={erros.produto}
          readOnly={ocupado}
          testId="abastecimento-frente-produto"
        />
      ) : null}

      {produto && tanquesDoProduto.length > 1 ? (
        <CampoEscolha
          label="Qual tanque da máquina será abastecido?"
          required
          value={String(form.tanque_id ?? "")}
          onChange={(v) => mudar({ tanque_id: v }, ["tanque_id", "quantidade"])}
          options={tanquesDoProduto.map((t) => ({ value: String(t.id), label: rotuloDoTanque(t) }))}
          opcaoVazia="— Escolha o tanque —"
          error={erros.tanque_id}
          readOnly={ocupado}
          testId="abastecimento-frente-tanque"
        />
      ) : null}

      {produtoId && !externo ? (
        locaisQuery.isError ? (
          <div className="col-span-12">
            <AvisoGestao testId="abastecimento-frente-locais-erro">
              {mensagemErroAbastecimento(locaisQuery.error, "Não foi possível ler o saldo. A confirmação confere de novo.")}{" "}
              <button type="button" className="underline" onClick={() => locaisQuery.refetch()}>
                Tentar novamente
              </button>
            </AvisoGestao>
          </div>
        ) : locaisQuery.isLoading ? (
          <p role="status" className="b1-carga-nota col-span-12">
            Conferindo o saldo deste Produto…
          </p>
        ) : !locais.length ? (
          <div className="col-span-12">
            <AvisoGestao testId="abastecimento-frente-sem-saldo">Sem saldo deste Produto nesta fazenda.</AvisoGestao>
          </div>
        ) : (
          <>
            <CampoEscolha
              label="De qual local do estoque?"
              required
              value={form.local_estoque_id ?? ""}
              onChange={(v) => mudar({ local_estoque_id: v || null }, ["local_estoque_id"])}
              options={locais.map((l) => ({ value: String(l.local_estoque_id), label: String(l.local_nome ?? "") }))}
              opcaoVazia="— Escolha o local —"
              error={erros.local_estoque_id}
              readOnly={ocupado}
              testId="abastecimento-frente-local"
            />
            {localEscolhido ? (
              <p className="b1-carga-nota col-span-12" data-testid="abastecimento-frente-disponivel">
                {`Disponível neste local: ${formatarDecimalLinha(localEscolhido.disponivel) || "0"}${rotuloDaUnidade(produto?.unidade_principal_estoque) ? ` ${rotuloDaUnidade(produto?.unidade_principal_estoque)}` : ""} · ${String(localEscolhido.local_nome ?? "")}`}
              </p>
            ) : null}
          </>
        )
      ) : null}

      <div className="b1-carga-qtd col-span-12">
        <div className="min-w-0">
          <CampoNumero
            label="Quantidade abastecida"
            value={form.quantidade}
            onChange={(v) => mudar({ quantidade: v }, ["quantidade"])}
            locale={LOCALE_ABASTECIMENTO}
            limites={LIMITES_ABASTECIMENTO.QUANTIDADE}
            required
            span={12}
            readOnly={ocupado}
            error={erros.quantidade}
            testId="abastecimento-frente-quantidade"
          />
        </div>
        {/* A unidade vem do cadastro do Produto (sem seletor): só leitura. */}
        <span className="b1-carga-un" data-testid="abastecimento-frente-unidade">
          {unidadeProduto}
        </span>
      </div>
      {dicaDaUnidade ? (
        <p role="note" className="col-span-12 -mt-1 min-w-0 break-words rounded-md border border-amber-300 bg-amber-50 p-2 text-[12px] text-amber-900" data-testid="abastecimento-frente-dica-unidade">
          {dicaDaUnidade}
        </p>
      ) : null}

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
              if ("lotes" in patch || "confirmaVencido" in patch) mudar(patch, ["lotes"]);
              else setForm((f) => ({ ...f, ...patch }));
            }}
            testId="abastecimento-frente-lotes"
          />
          <ErroDoCampo texto={erros.lotes} />
        </>
      ) : null}

      {externo ? (
        <>
          <CampoNumero
            label="Valor total da nota (R$)"
            value={form.custo_total ?? ""}
            onChange={(v) => mudar({ custo_total: v }, ["custo_total"])}
            locale={LOCALE_ABASTECIMENTO}
            limites={LIMITES_CUSTO_EXTERNO}
            casasMin={2}
            required
            span={12}
            readOnly={ocupado}
            error={erros.custo_total}
            testId="abastecimento-frente-valor"
          />
          <CampoTexto
            label="Número da nota ou cupom"
            value={form.referencia_externa}
            onChange={(v) => mudar({ referencia_externa: v }, ["referencia_externa"])}
            maxLength={64}
            span={12}
            keepCase
            readOnly={ocupado}
            error={erros.referencia_externa}
            testId="abastecimento-frente-nota"
          />
        </>
      ) : null}

      {contador ? (
        <>
          <CampoNumero
            label={ROTULO_CONTADOR[tipoMedidor] ?? "Horímetro"}
            value={form.medidor_leitura}
            onChange={(v) => mudar({ medidor_leitura: v }, ["medidor_leitura"])}
            locale={LOCALE_ABASTECIMENTO}
            limites={LIMITES_ABASTECIMENTO.LEITURA}
            required
            span={12}
            readOnly={ocupado}
            error={erros.medidor_leitura}
            testId="abastecimento-frente-horimetro"
          />
          {leituraVigente?.leitura ? (
            <p className="b1-carga-nota col-span-12" data-testid="abastecimento-frente-ultima-leitura">
              {`${TEXTO_ULTIMA_LEITURA[tipoMedidor] ?? "Última leitura desta máquina"}: ${formatarHorimetroCanonico(leituraVigente.leitura)}`}
            </p>
          ) : null}
        </>
      ) : null}

      {/* Só leitura: o abastecimento não tem campo de operador (o vínculo é o apontamento da frente). */}
      <CampoTexto label="Responsável" value={responsavelNome} onChange={() => {}} readOnly span={12} testId="abastecimento-frente-responsavel" />
    </form>
  );

  // Antes da máquina do servidor: a leitura (ou o aviso de falha, com nova tentativa); o formulário não aparece ainda.
  const carregando = !pronto ? (
    <div className="b1-realizacao__passo" data-testid="abastecimento-frente-carregando">
      {produtosQuery.isError ? (
        <AvisoGestao testId="abastecimento-frente-produtos-erro">
          {mensagemErroAbastecimento(produtosQuery.error, "Não foi possível ler a máquina desta frente.")}{" "}
          <button type="button" className="underline" onClick={() => produtosQuery.refetch()}>
            Tentar novamente
          </button>
        </AvisoGestao>
      ) : (
        <p role="status" className="b1-realizacao__ajuda">
          Carregando a máquina…
        </p>
      )}
    </div>
  ) : null;

  // Os botões do rodapé: o "Salvar" (com a janela no formulário) ou, na revisão, Corrigir e Confirmar/Repetir.
  const rodape = revisao ? (
    <>
      <button type="button" className={BOTAO_SECUNDARIO} onClick={corrigir} disabled={ocupado} data-testid="abastecimento-corrigir">
        Corrigir os dados
      </button>
      {podeConfirmar ? (
        <button type="button" className={BOTAO_PRIMARIO} onClick={() => void envio.disparar(null)} disabled={ocupado} data-testid="abastecimento-confirmar">
          {envio.estado.fase === "enviando" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          {envio.estado.fase === "enviando" ? "Confirmando…" : envio.estado.fase === "incerto" ? "Repetir o mesmo envio" : "Confirmar abastecimento"}
        </button>
      ) : null}
    </>
  ) : (
    <button type="submit" form={ID_FORMULARIO} className={`${BOTAO_PRIMARIO} b1-aberto-rodape-unico`} disabled={!podeGravar || ocupado || !pronto} data-testid="abastecimento-salvar">
      {ocupado ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
      {ocupado ? "Salvando…" : "Salvar abastecimento"}
    </button>
  );

  return (
    <>
      {/* O formulário fica montado durante a revisão (escondido): corrigir não perde o que foi digitado. */}
      <div hidden={revisao}>{pronto ? formulario : carregando}</div>
      {revisao ? (
        <section className="min-w-0" aria-labelledby="abastecimento-frente-confira" data-testid="abastecimento-frente-revisao">
          <h3 className="mb-1 text-[14px] font-semibold" id="abastecimento-frente-confira">
            Confira antes de confirmar
          </h3>
          <CorpoDaPreviaAbastecimento
            previa={previa}
            origem={fluxo.origemDaPrevia}
            custoExterno={fluxo.custoExternoDaPrevia}
            estado={envio.estado}
            podeConfirmar={podeConfirmar}
            onRepetir={() => void envio.disparar(null)}
            onConsultar={() => void consultar()}
          />
        </section>
      ) : null}
      {alvoRodape ? createPortal(rodape, alvoRodape) : null}
    </>
  );
}
