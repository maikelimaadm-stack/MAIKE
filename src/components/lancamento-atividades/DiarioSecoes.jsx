import React, { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import B1Field, { B1_FIELD_CTL_CLS } from "@/components/cadastro/base1/B1Field";
import { AvisoGestao, CampoSelect } from "@/components/gestao/GestaoFormParts";
import { EscolhaSegmentada } from "@/components/financeiroGestao/CamposLancamento";
import SeletorPaginadoGestao from "@/components/financeiroGestao/SeletorPaginadoGestao";
import { BOTAO_PRIMARIO, BOTAO_SECUNDARIO } from "@/components/patrimonio/DialogosAbastecimento";
import { normalizarPaginaDeOpcoes } from "@/lib/atividadeApontamentoRegras";
import { validarAbrirServico } from "@/lib/diarioServicoRegras";
import { formatarMoedaAtividade, medidorDaResposta } from "@/lib/atividadeLinhasRegras";
import {
  formularioVazio,
  formatarLitrosCurto,
  opcaoNoFormulario,
  ROTULO_LEITURA,
  tanqueDoFormulario,
  unidadeDoFormulario,
  validarFormulario,
} from "@/lib/abastecimentoRegras";
import {
  OPCOES_SOBRA_TROCAR,
  TIPO_SOBRA,
  formatarVolume,
  lerDecimal,
  produtosDaAplicacao,
  quantidadePadraoDoProduto,
  rotuloUnidade,
  unidadeDoEnvio,
  validarAplicacao,
  validarMistura,
  validarSobra,
  volumeAplicado,
} from "@/lib/implementoRegras";
import { listarProdutosDoBem } from "@/services/abastecimentoService";
import { listarLocaisDoProduto, listarOpcoesProdutos, obterMedidorDoBem } from "@/services/lancamentoAtividadesService";

/** A chave das consultas do diário no react-query (o prefixo que a tela invalida depois de gravar). */
export const CHAVE_DIARIO = "diario-maquina";

/** Botões do rodapé das seções (mesmo desenho dos lançamentos da tela). */
export function Rodape({ children }) {
  return <div className="flex w-full flex-wrap justify-end gap-2">{children}</div>;
}

/** Botão verde de ação principal (o "ok" dos lançamentos). */
export const BotaoAcao = ({ onClick, disabled = false, children, testId }) => (
  <button type="button" className={BOTAO_PRIMARIO} onClick={onClick} disabled={disabled} data-testid={testId}>
    {children}
  </button>
);

/** Botão cinza de voltar / cancelar. */
export const BotaoVoltar = ({ onClick, children = "Voltar ao diário", testId = "diario-voltar" }) => (
  <button type="button" className={BOTAO_SECUNDARIO} onClick={onClick} data-testid={testId}>
    {children}
  </button>
);

/**
 * Campo de texto ou número no desenho de campo da tela (B1Field, como o cadastro de produtos).
 * @param {{ label: string, value: string, onChange: (v: string) => void, testId?: string, inputMode?: "decimal"|"text"|"numeric", span?: number, error?: string, dica?: any, readOnly?: boolean }} props
 */
export function CampoDeTexto({ label, value, onChange, testId, inputMode = "decimal", span = 6, error = undefined, dica = undefined, readOnly = false }) {
  return (
    <B1Field label={label} span={span} hasValue={Boolean(String(value ?? "").trim())} locked={readOnly} disabled={readOnly} error={error} dica={dica}>
      <input
        type="text"
        inputMode={inputMode}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        readOnly={readOnly}
        className={B1_FIELD_CTL_CLS}
        aria-label={label}
        data-testid={testId}
      />
    </B1Field>
  );
}

/** Texto curto de apoio (a mesma cor das notas dos formulários). */
export const Nota = ({ children, testId = undefined }) => (
  <p className="col-span-12 min-w-0 break-words text-[13px] text-[var(--mg-text-2,#475569)]" data-testid={testId}>
    {children}
  </p>
);

/** Uma linha de produto da mistura: produto (com a quantidade padrão), local com o saldo e a quantidade. */
function LinhaDeProduto({ atividadeId, empresaId, linha, erros, onChange, onRemover, numero }) {
  const produtoId = linha.produto?.id ?? "";
  const locais = useQuery({
    queryKey: [CHAVE_DIARIO, "locais", produtoId],
    // Os locais do saldo vêm em `itens` com `local_estoque_id` (não têm `id`): leitura direta, como o saldo da linha de produto.
    queryFn: async () => (await listarLocaisDoProduto(produtoId))?.itens ?? [],
    enabled: Boolean(produtoId),
    staleTime: 15 * 1000,
  });
  const unidade = rotuloUnidade(linha.produto?.unidade ?? "KG");
  return (
    <div className="col-span-12 grid grid-cols-12 gap-2" data-testid={`diario-linha-produto-${numero}`}>
      <div className="col-span-12">
        <SeletorPaginadoGestao
          rotulo="Produto"
          testId={`diario-produto-${numero}`}
          chave={[CHAVE_DIARIO, "produtos", empresaId, atividadeId]}
          buscar={async ({ q, cursor, limit }) => normalizarPaginaDeOpcoes(await listarOpcoesProdutos(atividadeId, { q, cursor, limit }))}
          value={linha.produto ? { id: linha.produto.id, rotulo: linha.produto.rotulo } : null}
          onChange={(o) => {
            if (!o) return onChange({ produto: null, local_estoque_id: "", quantidade: "" });
            const padrao = quantidadePadraoDoProduto(o);
            // A quantidade padrão entra no campo como se fosse digitada ("4", "0,5"), e continua editável.
            const quantidade = padrao.quantidade ? String(Number(padrao.quantidade)).replace(".", ",") : "";
            onChange({
              produto: { id: String(o.id), rotulo: String(o.nome ?? ""), unidade: padrao.unidade },
              local_estoque_id: "",
              quantidade,
            });
          }}
          rotuloDaOpcao={(o) => String(o?.nome ?? "")}
          obrigatorio
          erro={erros.produto}
          span={12}
          maiusculas={false}
        />
      </div>
      <div className="col-span-7 min-w-0">
        <CampoSelect
          label="Local do estoque"
          value={linha.local_estoque_id ?? ""}
          onChange={(v) => onChange({ local_estoque_id: v || "" })}
          options={(locais.data ?? []).map((l) => ({
            value: String(l.local_estoque_id),
            label: `${String(l.local_nome ?? "")} (disponível ${formatarVolume(l.disponivel)} ${unidade})`,
          }))}
          placeholder={produtoId ? "— Escolha o local —" : "Escolha o produto antes"}
          readOnly={!produtoId}
          required
          span={12}
          error={erros.local}
        />
      </div>
      <div className="col-span-4 min-w-0">
        <CampoDeTexto label={`Quantidade (${unidade})`} value={linha.quantidade} onChange={(v) => onChange({ quantidade: v })} testId={`diario-quantidade-${numero}`} error={erros.quantidade} span={12} />
      </div>
      <div className="col-span-12 flex justify-end">
        <button type="button" className="text-[13px] text-[#b91c1c] underline" onClick={onRemover} data-testid={`diario-tirar-produto-${numero}`}>
          Tirar este produto
        </button>
      </div>
    </div>
  );
}

/**
 * Passo 1 · Mistura no implemento: o implemento (com a capacidade do bem) e os produtos com a quantidade por implemento
 * cheio, pré-preenchida com a quantidade padrão do produto (editável). Não baixa estoque: só o que for aplicado baixa.
 */
/**
 * Passo 1 · Lançar produto / mistura. Com `implementoFixo` (o implemento do serviço aberto), o implemento não é perguntado
 * de novo: aparece como texto e é o da mistura. Sem ele, escolhe-se (o último usado vem pré-selecionado).
 */
export function SecaoPasso1({ atividadeId, empresaId, implementos, ultimaImplementoId, implementoFixo = null, onVoltar, onGravar, enviando }) {
  const [implementoId, setImplementoId] = useState(implementoFixo ? String(implementoFixo.id) : ultimaImplementoId ? String(ultimaImplementoId) : "");
  const [linhas, setLinhas] = useState(() => [{ produto: null, local_estoque_id: "", quantidade: "" }]);
  const [erros, setErros] = useState(/** @type {any} */ ({ linhas: [] }));
  // Sem implemento escolhido, o primeiro com capacidade cadastrada.
  useEffect(() => {
    if (!implementoId && implementos.length) {
      const com = implementos.find((i) => (lerDecimal(i.capacidade) ?? 0) > 0) ?? implementos[0];
      setImplementoId(String(com.id));
    }
  }, [implementos, implementoId]);
  const implemento = implementos.find((i) => String(i.id) === String(implementoId)) ?? null;
  const unidadeImplemento = unidadeDoEnvio(implemento?.capacidade_unidade);
  const atualizar = (k, mudanca) => setLinhas((atual) => atual.map((l, i) => (i === k ? { ...l, ...mudanca } : l)));

  const enviar = () => {
    const resultado = validarMistura({
      implementoId,
      capacidade: implemento?.capacidade,
      linhas: linhas.map((l) => ({ produto_id: l.produto?.id ?? "", local_estoque_id: l.local_estoque_id, quantidade: l.quantidade })),
    });
    setErros(resultado.erros);
    if (!resultado.ok) return;
    onGravar({ implementoId, linhas });
  };

  return (
    <div className="flex flex-col gap-3" data-testid="diario-passo-1">
      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-12">
          {implementoFixo ? (
            <p className="text-[13px] text-[#73726c]" data-testid="diario-passo-1-implemento">
              Implemento: <b className="text-[#141413]">{implementoFixo.nome || "—"}</b> <span>(do serviço aberto)</span>
            </p>
          ) : (
            <CampoSelect
              label="Implemento"
              value={implementoId}
              onChange={(v) => setImplementoId(v || "")}
              options={implementos.map((i) => ({ value: String(i.id), label: String(i.nome ?? "") }))}
              placeholder="— Escolha o implemento —"
              required
              span={12}
              error={erros.implemento}
            />
          )}
          {implemento ? (
            <p className="mt-1 text-[12.5px] text-[var(--mg-text-2,#475569)]" data-testid="diario-capacidade">
              Capacidade: {formatarVolume(implemento.capacidade, unidadeImplemento)}
              {erros.capacidade ? <span className="block text-[#b91c1c]">{erros.capacidade}</span> : null}
            </p>
          ) : null}
        </div>
        {linhas.map((l, k) => (
          <LinhaDeProduto
            key={k}
            numero={k + 1}
            atividadeId={atividadeId}
            empresaId={empresaId}
            linha={l}
            erros={erros.linhas?.[k] ?? {}}
            onChange={(m) => atualizar(k, m)}
            onRemover={() => setLinhas((atual) => (atual.length > 1 ? atual.filter((_, i) => i !== k) : [{ produto: null, local_estoque_id: "", quantidade: "" }]))}
          />
        ))}
        <div className="col-span-12">
          <button type="button" className={BOTAO_SECUNDARIO} onClick={() => setLinhas((atual) => [...atual, { produto: null, local_estoque_id: "", quantidade: "" }])} data-testid="diario-mais-produto">
            + Produto
          </button>
        </div>
        {erros.itens ? <AvisoGestao testId="diario-erro-itens">{erros.itens}</AvisoGestao> : null}
      </div>
      <Rodape>
        <BotaoVoltar onClick={onVoltar} />
        <BotaoAcao onClick={enviar} disabled={enviando} testId="diario-implemento-cheio">
          {enviando ? "Salvando…" : "Implemento cheio"}
        </BotaoAcao>
      </Rodape>
    </div>
  );
}

/**
 * Passo 2 · Aplicar no pasto: esvaziou o implemento neste pasto? Se não, quanto sobrou (a sobra fica no implemento).
 * Mostra quanto de cada produto foi para o pasto. Não precisa do lançamento do dia: o servidor cria o de hoje (D-PROD-324).
 */
export function SecaoPasso2({ mistura, onVoltar, onGravar, enviando }) {
  const [esvaziou, setEsvaziou] = useState(true);
  const [sobra, setSobra] = useState("");
  const [erro, setErro] = useState(/** @type {string|null} */ (null));
  const saldo = lerDecimal(mistura?.saldo) ?? 0;
  const unidade = unidadeDoEnvio(mistura?.unidade);
  const volume = volumeAplicado({ saldo, esvaziou, sobra });
  const porProduto = mistura ? produtosDaAplicacao(mistura, volume) : [];

  if (!mistura) {
    return (
      <div className="flex flex-col gap-3" data-testid="diario-passo-2">
        <AvisoGestao testId="diario-sem-mistura">Não há mistura no implemento. Faça o Passo 1 antes.</AvisoGestao>
        <Rodape>
          <BotaoVoltar onClick={onVoltar} />
        </Rodape>
      </div>
    );
  }
  const enviar = () => {
    const msg = validarAplicacao({ esvaziou, sobra, saldo, unidade });
    setErro(msg);
    if (msg) return;
    onGravar({ esvaziou, sobra });
  };

  return (
    <div className="flex flex-col gap-3" data-testid="diario-passo-2">
      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-12">
          <EscolhaSegmentada
            rotulo="O implemento esvaziou neste pasto?"
            opcoes={[
              { value: "sim", label: "Sim, esvaziou todo" },
              { value: "nao", label: "Não, sobrou um pouco" },
            ]}
            value={esvaziou ? "sim" : "nao"}
            onChange={(v) => {
              setErro(null);
              setEsvaziou(v === "sim");
            }}
            testId="diario-esvaziou"
          />
        </div>
        {esvaziou ? null : (
          <div className="col-span-12">
            <CampoDeTexto
              label={`Quanto sobrou no implemento? (${rotuloUnidade(unidade)})`}
              value={sobra}
              onChange={(v) => {
                setErro(null);
                setSobra(v);
              }}
              testId="diario-sobra"
              span={12}
              error={erro ?? undefined}
            />
          </div>
        )}
        <div className="col-span-12 rounded-[10px] border border-[#c9f2d4] bg-[#f3fdf6] p-3 text-[13px]" data-testid="diario-vai-para-o-pasto">
          <p className="font-semibold text-[#15803d]">Vai para o pasto: {formatarVolume(volume, rotuloUnidade(unidade))}</p>
          {porProduto.map((p) => (
            <p key={p.produto_id} className="text-[#373733]">
              {p.nome}: {formatarVolume(p.quantidade, p.unidade)}
            </p>
          ))}
        </div>
      </div>
      <Rodape>
        <BotaoVoltar onClick={onVoltar} />
        <BotaoAcao onClick={enviar} disabled={enviando} testId="diario-gravar-aplicacao">
          {enviando ? "Salvando…" : "Salvar aplicação"}
        </BotaoAcao>
      </Rodape>
    </div>
  );
}

/** Uma ação em lista (linha inteira, para toque). */
const BotaoSeco = ({ onClick, children, testId }) => (
  <button type="button" className={`${BOTAO_SECUNDARIO} w-full justify-start`} onClick={onClick} data-testid={testId}>
    {children}
  </button>
);

/** Rótulo do tanque na escolha, como no formulário de abastecimento: "Tanque principal (180 L)". @param {any} t */
const rotuloDoTanque = (t) => {
  const nome = String(t?.identificador ?? "");
  return t?.capacidade_litros ? `${nome} (${formatarLitrosCurto(t.capacidade_litros)} L)` : nome;
};

/**
 * Abastecer (D-PROD-324, item 1): a MÁQUINA já vem do contexto; a pessoa informa os litros (ou kg) e o horímetro. Produto,
 * tanque e local vêm das opções do servidor e só aparecem quando há mais de uma escolha. Grava pelo caminho da tela
 * Abastecimentos (prévia e confirmação, `abastecimentoService`), ligado ao lançamento de hoje da área, sem abrir janela nova.
 * @param {{ empresaId: string, bem: { id?: unknown, nome?: string }|null, hoje: string, onVoltar: () => void,
 *   onGravar: (form: any) => void, enviando: boolean }} props
 */
export function SecaoAbastecer({ empresaId, bem, hoje, onVoltar, onGravar, enviando }) {
  const bemId = bem?.id ? String(bem.id) : "";
  const [produtoId, setProdutoId] = useState("");
  const [tanqueId, setTanqueId] = useState("");
  const [localId, setLocalId] = useState("");
  const [litros, setLitros] = useState("");
  const [leitura, setLeitura] = useState("");
  const [erros, setErros] = useState(/** @type {Record<string, string>} */ ({}));

  const produtosQ = useQuery({
    queryKey: [CHAVE_DIARIO, "abastecer-produtos", empresaId, bemId],
    queryFn: () => listarProdutosDoBem(String(empresaId), bemId, { limit: 100 }),
    enabled: Boolean(empresaId && bemId),
  });
  const opcoes = Array.isArray(produtosQ.data?.itens) ? produtosQ.data.itens : [];
  // Com um Produto só, ele já vem escolhido.
  useEffect(() => {
    if (!produtoId && opcoes.length === 1) setProdutoId(String(opcoes[0].produto?.id ?? ""));
  }, [opcoes.length, produtoId]);
  const opcao = opcoes.find((o) => String(o.produto?.id ?? "") === produtoId) ?? null;
  const tanques = Array.isArray(opcao?.tanques) ? opcao.tanques : [];
  const unidade = unidadeDoFormulario({ produto: opcao?.produto ?? null }) ?? "L";

  const locaisQ = useQuery({
    queryKey: [CHAVE_DIARIO, "abastecer-locais", produtoId],
    queryFn: async () => (await listarLocaisDoProduto(produtoId))?.itens ?? [],
    enabled: Boolean(produtoId),
    staleTime: 15 * 1000,
  });
  const locais = Array.isArray(locaisQ.data) ? locaisQ.data : [];

  // O medidor do bem (tipo e leitura vigente): define se pede horímetro e sugere a última leitura, até a pessoa mexer.
  const medidorQ = useQuery({
    queryKey: [CHAVE_DIARIO, "abastecer-medidor", empresaId, bemId, hoje],
    queryFn: () => obterMedidorDoBem(bemId, hoje),
    enabled: Boolean(empresaId && bemId && hoje),
    staleTime: 15 * 1000,
  });
  const medidor = medidorQ.data ? medidorDaResposta(medidorQ.data) : null;
  const vigente = medidor?.vigente?.leitura ?? null;
  useEffect(() => {
    if (vigente && !leitura) setLeitura(String(Number(vigente)).replace(".", ","));
  }, [vigente]);

  if (!bemId) {
    return (
      <div className="flex flex-col gap-3" data-testid="diario-abastecer">
        <AvisoGestao testId="diario-abastecer-sem-maquina">Esta atividade não tem máquina. Não há o que abastecer aqui.</AvisoGestao>
        <Rodape>
          <BotaoVoltar onClick={onVoltar} />
        </Rodape>
      </div>
    );
  }

  const enviar = () => {
    const localEscolhido = localId || (locais.length === 1 ? String(locais[0].local_estoque_id) : "");
    const base = {
      ...formularioVazio(hoje),
      bem: { id: bemId, nome: bem?.nome ?? "", medidor: { tipo: medidor?.tipo ?? "SEM_MEDIDOR" } },
      data_operacional: hoje,
      quantidade: litros,
      medidor_leitura: leitura,
    };
    let form = opcao ? opcaoNoFormulario(base, opcao) : { ...base, produto: null };
    if (opcao && tanques.length > 1) form = { ...form, tanque_id: tanqueId };
    form = { ...form, local_estoque_id: localEscolhido || null };
    const v = validarFormulario(form, { hoje, capacidadeLitros: tanqueDoFormulario(form)?.capacidade_litros ?? null, unidade: unidadeDoFormulario(form) });
    setErros(v.erros);
    if (Object.keys(v.erros).length) return;
    onGravar(form);
  };

  return (
    <div className="flex flex-col gap-3" data-testid="diario-abastecer">
      <div className="grid grid-cols-12 gap-3">
        <p className="col-span-12 text-[13px] text-[#73726c]">
          Máquina: <b className="text-[#141413]">{bem?.nome || "—"}</b>
        </p>
        <div className="col-span-12">
          <CampoSelect
            label="Produto"
            value={produtoId}
            onChange={(v) => {
              setProdutoId(v || "");
              setTanqueId("");
              setLocalId("");
            }}
            options={opcoes.map((o) => ({ value: String(o.produto?.id ?? ""), label: String(o.produto?.nome ?? "") }))}
            placeholder="— Escolha o produto —"
            required
            span={12}
            error={erros.produto}
          />
        </div>
        {tanques.length > 1 ? (
          <div className="col-span-12">
            <CampoSelect
              label="Qual tanque será abastecido?"
              value={tanqueId}
              onChange={(v) => setTanqueId(v || "")}
              options={tanques.map((t) => ({ value: String(t.id), label: rotuloDoTanque(t) }))}
              placeholder="— Escolha o tanque —"
              required
              span={12}
              error={erros.tanque_id}
            />
          </div>
        ) : null}
        {produtoId ? (
          <div className="col-span-12">
            <CampoSelect
              label="Local do estoque"
              value={localId || (locais.length === 1 ? String(locais[0].local_estoque_id) : "")}
              onChange={(v) => setLocalId(v || "")}
              options={locais.map((l) => ({
                value: String(l.local_estoque_id),
                label: `${String(l.local_nome ?? "")} (disponível ${formatarVolume(l.disponivel, rotuloUnidade(unidade))})`,
              }))}
              placeholder="— Escolha o local —"
              required
              span={12}
              error={erros.local_estoque_id}
            />
          </div>
        ) : null}
        <div className="col-span-6 min-w-0">
          <CampoDeTexto label={unidade === "KG" ? "Quantidade (kg)" : "Litros (L)"} value={litros} onChange={setLitros} testId="diario-abastecer-litros" error={erros.quantidade} span={12} />
        </div>
        {medidor?.contador ? (
          <div className="col-span-6 min-w-0">
            <CampoDeTexto
              label={ROTULO_LEITURA[medidor.tipo] ?? "Leitura do medidor"}
              value={leitura}
              onChange={setLeitura}
              testId="diario-abastecer-horimetro"
              error={erros.medidor_leitura}
              span={12}
            />
          </div>
        ) : medidorQ.isSuccess ? (
          <Nota testId="diario-abastecer-sem-medidor">Esta máquina não tem medidor: não há horímetro para informar.</Nota>
        ) : null}
        {erros.bem ? <AvisoGestao testId="diario-abastecer-erro">{erros.bem}</AvisoGestao> : null}
      </div>
      <Rodape>
        <BotaoVoltar onClick={onVoltar} />
        <BotaoAcao onClick={enviar} disabled={enviando || medidorQ.isPending} testId="diario-abastecer-gravar">
          {enviando ? "Salvando…" : "Abastecer"}
        </BotaoAcao>
      </Rodape>
    </div>
  );
}

/** Mais: abastecer e mão de obra (as janelas que já existem, no lugar desta). */
/**
 * Mais (D-PROD-324): serviços, mão de obra e outros custos do serviço aberto. Lançados depois, não no primeiro passo.
 * "Outros custos" abre o lançamento de hoje (todas as linhas).
 */
export function SecaoMais({ onServicos, onMaoObra, onOutrosCustos, onVoltar }) {
  return (
    <div className="flex flex-col gap-2" data-testid="diario-mais">
      <BotaoSeco onClick={onServicos} testId="diario-servicos">
        Serviços
      </BotaoSeco>
      <BotaoSeco onClick={onMaoObra} testId="diario-mao-de-obra">
        Mão de obra
      </BotaoSeco>
      <BotaoSeco onClick={onOutrosCustos} testId="diario-outros-custos">
        Outros custos
      </BotaoSeco>
      <Rodape>
        <BotaoVoltar onClick={onVoltar} />
      </Rodape>
    </div>
  );
}

/**
 * Abrir serviço (D-PROD-324): o primeiro passo do dia no pasto. SÓ estes campos: máquina, responsável, implemento e a hora
 * de início (padrão = agora, no fuso da fazenda). A operação aparece só quando o pasto não tem atividade em andamento (sem
 * ela não há atividade a abrir). Quem chama passa as listas e os padrões; esta seção não busca nada.
 */
export function SecaoAbrirServico({ maquinas, responsaveis, implementos, padroes, pedirOperacao, operacoes = [], voltarRotulo = "Voltar", onVoltar, onAbrir, enviando }) {
  const [bemId, setBemId] = useState(padroes.bemId ? String(padroes.bemId) : "");
  const [responsavelId, setResponsavelId] = useState(padroes.responsavelId ? String(padroes.responsavelId) : "");
  const [implementoId, setImplementoId] = useState(padroes.implementoId ? String(padroes.implementoId) : "");
  const [inicio, setInicio] = useState(padroes.inicio ?? "");
  const [tipoId, setTipoId] = useState("");
  const [erros, setErros] = useState(/** @type {Record<string, string>} */ ({}));

  const enviar = () => {
    const e = validarAbrirServico({ bemId, responsavelId, inicio, tipoId, pedirOperacao });
    setErros(e);
    if (Object.keys(e).length) return;
    onAbrir({ bemId, responsavelId, implementoId: implementoId || null, inicio, tipoId: tipoId || null });
  };

  return (
    <div className="flex flex-col gap-3" data-testid="diario-abrir">
      <div className="grid grid-cols-12 gap-3">
        {pedirOperacao ? (
          <div className="col-span-12">
            <CampoSelect
              label="Operação"
              value={tipoId}
              onChange={(v) => setTipoId(v || "")}
              options={operacoes.map((t) => ({ value: String(t.id), label: String(t.nome_tipo ?? t.nome ?? "") }))}
              placeholder="— Escolha a operação —"
              required
              span={12}
              error={erros.tipo}
            />
          </div>
        ) : null}
        <div className="col-span-12">
          <CampoSelect
            label="Máquina"
            value={bemId}
            onChange={(v) => setBemId(v || "")}
            options={maquinas.map((m) => ({ value: String(m.id), label: String(m.nome ?? "") }))}
            placeholder="— Escolha a máquina —"
            required
            span={12}
            error={erros.bem}
          />
        </div>
        <div className="col-span-12">
          <CampoSelect
            label="Responsável"
            value={responsavelId}
            onChange={(v) => setResponsavelId(v || "")}
            options={responsaveis.map((r) => ({ value: String(r.id), label: String(r.nome ?? r.rotulo ?? "") }))}
            placeholder="— Escolha quem está operando —"
            required
            span={12}
            error={erros.responsavel}
          />
        </div>
        <div className="col-span-12">
          <CampoSelect
            label="Implemento"
            value={implementoId}
            onChange={(v) => setImplementoId(v || "")}
            options={implementos.map((i) => ({ value: String(i.id), label: String(i.nome ?? "") }))}
            placeholder="— Sem implemento —"
            span={12}
          />
        </div>
        <div className="col-span-12">
          <B1Field label="Hora de início" span={12} hasValue={Boolean(inicio)} error={erros.inicio} required>
            <input
              type="time"
              value={inicio}
              onChange={(e) => setInicio(e.target.value)}
              className={B1_FIELD_CTL_CLS}
              aria-label="Hora de início"
              data-testid="diario-abrir-hora"
            />
          </B1Field>
        </div>
      </div>
      <Rodape>
        <BotaoVoltar onClick={onVoltar} children={voltarRotulo} testId="diario-abrir-voltar" />
        <BotaoAcao onClick={enviar} disabled={enviando} testId="diario-abrir-gravar">
          {enviando ? "Abrindo…" : "Abrir serviço"}
        </BotaoAcao>
      </Rodape>
    </div>
  );
}

/**
 * Trocar pasto: o próximo pasto (as áreas da atividade) e o que sobrou no implemento (vai junto, volta ao depósito ou
 * perda com motivo). Horímetro de saída e de chegada são opcionais e valem com ou sem sobra (o trajeto não tem custo).
 */
export function SecaoTrocar({ opcoesDePasto, mistura, onVoltar, onTrocar, enviando }) {
  const [proximo, setProximo] = useState(opcoesDePasto[0]?.value ?? "");
  const [tipo, setTipo] = useState(/** @type {string} */ (TIPO_SOBRA.TRANSFERENCIA));
  const [motivo, setMotivo] = useState("");
  const [horimetroSaida, setHorimetroSaida] = useState("");
  const [horimetroChegada, setHorimetroChegada] = useState("");
  const [erro, setErro] = useState(/** @type {string|null} */ (null));
  const saldo = lerDecimal(mistura?.saldo) ?? 0;
  const comSobra = Boolean(mistura) && saldo > 0;
  const unidade = unidadeDoEnvio(mistura?.unidade);
  const nomeDoProximo = opcoesDePasto.find((o) => o.value === proximo)?.label ?? "próximo pasto";

  const enviar = () => {
    const msg = comSobra ? validarSobra({ tipo, paraAreaId: proximo, motivo }) : proximo ? null : "Escolha o próximo pasto.";
    setErro(msg);
    if (msg) return;
    onTrocar({ proximo, sobra: comSobra ? { tipo, motivo } : null, horimetroSaida, horimetroChegada });
  };

  return (
    <div className="flex flex-col gap-3" data-testid="diario-trocar">
      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-12">
          <CampoSelect
            label="Próximo pasto"
            value={proximo}
            onChange={(v) => setProximo(v || "")}
            options={opcoesDePasto}
            placeholder="— Escolha o pasto —"
            required
            span={12}
          />
        </div>
        {comSobra ? (
          <div className="col-span-12">
            <EscolhaSegmentada
              rotulo={`O que sobrou no implemento: ${formatarVolume(saldo)} ${rotuloUnidade(unidade)}`}
              opcoes={[...OPCOES_SOBRA_TROCAR]}
              value={tipo}
              onChange={(v) => {
                setErro(null);
                setTipo(v);
              }}
              testId="diario-sobra-tipo"
            />
          </div>
        ) : null}
        {comSobra && tipo === TIPO_SOBRA.PERDA ? (
          <div className="col-span-12">
            <CampoDeTexto label="Motivo da perda" value={motivo} onChange={setMotivo} testId="diario-motivo-perda" inputMode="text" span={12} error={erro ?? undefined} />
          </div>
        ) : null}
        <CampoDeTexto label="Horímetro de saída" value={horimetroSaida} onChange={setHorimetroSaida} testId="diario-horimetro-saida" />
        <CampoDeTexto label="Horímetro de chegada" value={horimetroChegada} onChange={setHorimetroChegada} testId="diario-horimetro-chegada" />
        {comSobra ? null : (
          <Nota testId="diario-trajeto-sem-sobra">Os horímetros são guardados mesmo sem sobra. Sem nenhuma mistura nesta atividade, não há onde guardá-los.</Nota>
        )}
        {!comSobra && erro ? <AvisoGestao testId="diario-erro-trocar">{erro}</AvisoGestao> : null}
      </div>
      <Rodape>
        <BotaoVoltar onClick={onVoltar} />
        <BotaoAcao onClick={enviar} disabled={enviando || !proximo} testId="diario-ir-para-pasto">
          {enviando ? "Salvando…" : `Ir para ${nomeDoProximo}`}
        </BotaoAcao>
      </Rodape>
    </div>
  );
}

/**
 * Encerrar o dia: o destino da sobra (fica no implemento para amanhã, volta ao depósito ou perda), o horímetro final
 * (abre a linha de máquina que já existe) e "Fez o pasto todo?" — Sim abre a conclusão da atividade, depois de fechar.
 */
export function SecaoEncerrar({ mistura, onVoltar, onEncerrar, onLancarHorimetro, enviando }) {
  const [destino, setDestino] = useState("FICA");
  const [motivo, setMotivo] = useState("");
  const [fezTodo, setFezTodo] = useState(/** @type {boolean|null} */ (null));
  const [erro, setErro] = useState(/** @type {string|null} */ (null));
  const saldo = lerDecimal(mistura?.saldo) ?? 0;
  const comSobra = Boolean(mistura) && saldo > 0;
  const unidade = unidadeDoEnvio(mistura?.unidade);

  const enviar = () => {
    if (fezTodo === null) return setErro("Diga se fez o pasto todo.");
    if (comSobra && destino !== "FICA") {
      const tipo = destino === "PERDA" ? TIPO_SOBRA.PERDA : TIPO_SOBRA.DEVOLUCAO;
      const msg = validarSobra({ tipo, motivo });
      if (msg) return setErro(msg);
      return onEncerrar({ sobra: { tipo, motivo }, fezTodo });
    }
    onEncerrar({ sobra: null, fezTodo });
  };

  return (
    <div className="flex flex-col gap-3" data-testid="diario-encerrar">
      <div className="grid grid-cols-12 gap-3">
        {comSobra ? (
          <div className="col-span-12">
            <EscolhaSegmentada
              rotulo={`Sobra no implemento: ${formatarVolume(saldo)} ${rotuloUnidade(unidade)}`}
              opcoes={[
                { value: "FICA", label: "Fica no implemento para amanhã" },
                { value: "DEVOLUCAO", label: "Volta ao depósito" },
                { value: "PERDA", label: "Perda (com motivo)" },
              ]}
              value={destino}
              onChange={(v) => {
                setErro(null);
                setDestino(v);
              }}
              testId="diario-encerrar-sobra"
            />
          </div>
        ) : null}
        {comSobra && destino === "PERDA" ? (
          <div className="col-span-12">
            <CampoDeTexto label="Motivo da perda" value={motivo} onChange={setMotivo} testId="diario-encerrar-motivo" inputMode="text" span={12} />
          </div>
        ) : null}
        <div className="col-span-12">
          <EscolhaSegmentada
            rotulo="Fez o pasto todo?"
            opcoes={[
              { value: "sim", label: "Sim, fez o pasto todo" },
              { value: "nao", label: "Não, falta um pedaço" },
            ]}
            value={fezTodo === null ? "" : fezTodo ? "sim" : "nao"}
            onChange={(v) => {
              setErro(null);
              setFezTodo(v === "sim");
            }}
            testId="diario-fez-todo"
          />
        </div>
        <div className="col-span-12">
          <button type="button" className={`${BOTAO_SECUNDARIO} w-full justify-start`} onClick={onLancarHorimetro} data-testid="diario-horimetro-final">
            Lançar horímetro final
          </button>
        </div>
        {erro ? <AvisoGestao testId="diario-erro-encerrar">{erro}</AvisoGestao> : null}
      </div>
      <Rodape>
        <BotaoVoltar onClick={onVoltar} />
        <BotaoAcao onClick={enviar} disabled={enviando} testId="diario-encerrar-dia">
          {enviando ? "Salvando…" : "Encerrar serviço"}
        </BotaoAcao>
      </Rodape>
    </div>
  );
}

/** Os volumes de uma área na unidade de cada um (L e kg à parte, nunca somados): "1.500 L · 1.000 kg". @param {unknown} lista */
const volumesDoResumo = (lista) =>
  (Array.isArray(lista) ? lista : []).map((v) => formatarVolume(v?.volume, rotuloUnidade(v?.unidade))).join(" · ");

/** Resumo do dia: por pasto, implementos cheios, volume, produtos e horas. R$ só para quem pode ver custo e só se o servidor mandar. */
export function SecaoResumo({ dados, carregando, erro, verCusto, onVoltar, nomeDaArea }) {
  const areas = Array.isArray(dados?.areas) ? dados.areas : [];
  return (
    <div className="flex flex-col gap-3" data-testid="diario-resumo">
      {carregando ? <Nota>Carregando o resumo…</Nota> : null}
      {erro ? <AvisoGestao testId="diario-resumo-erro">Não foi possível carregar o resumo. Tente de novo.</AvisoGestao> : null}
      {!carregando && !erro && !areas.length ? <Nota>Nada lançado hoje.</Nota> : null}
      {areas.map((a) => (
        <div key={String(a.area_id)} className="rounded-[10px] border border-[#ecebe6] bg-white p-3 text-[13px]" data-testid={`diario-resumo-area-${a.area_id}`}>
          <p className="text-[14px] font-semibold text-[#15803d]">{a.area_nome ?? nomeDaArea(a.area_id)}</p>
          <p>Implementos cheios: {a.implementos_cheios ?? 0}</p>
          <p data-testid={`diario-resumo-volume-${a.area_id}`}>Volume aplicado: {volumesDoResumo(a.volumes_aplicados) || "—"}</p>
          {(Array.isArray(a.produtos) ? a.produtos : []).map((p) => (
            <p key={`${p.produto_id}-${p.unidade}`} className="text-[#373733]">
              {p.produto_nome ?? p.nome}: {formatarVolume(p.quantidade, rotuloUnidade(p.unidade))}
            </p>
          ))}
          <p>Horas de máquina: {formatarVolume(a.horas_maquina)} h</p>
          {Array.isArray(a.sobra) && a.sobra.length ? (
            <p className="text-[#373733]" data-testid={`diario-resumo-sobra-${a.area_id}`}>
              Sobra no implemento: {volumesDoResumo(a.sobra)} · fica no pasto
            </p>
          ) : null}
          {verCusto && a.custo_total != null ? <p data-testid="diario-resumo-custo">Custo: {formatarMoedaAtividade(a.custo_total)}</p> : null}
        </div>
      ))}
      {verCusto && dados?.custo_total != null ? <p className="text-[14px] font-semibold">Custo total: {formatarMoedaAtividade(dados.custo_total)}</p> : null}
      <Rodape>
        <BotaoVoltar onClick={onVoltar} />
      </Rodape>
    </div>
  );
}
