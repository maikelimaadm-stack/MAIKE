import React, { useEffect, useRef, useState } from "react";
import { DENSIDADE_BASE1 } from "@/components/cadastro/base1/B1Field";
import { useQueryClient } from "@tanstack/react-query";
import CadastroFormShell from "@/components/cadastro/base1/CadastroFormShell";
import CadastroRapidoSheet from "@/components/common/CadastroRapidoSheet";
import Base1PanelTabs from "@/components/cadastro/base1/Base1PanelTabs";
import { notifySuccess, notifyWarning } from "@/lib/maikeNotify";
import { formatarDia, hojeNoFuso } from "@/lib/diaCivil";
import { formatarNumero } from "@/lib/dinheiroDecimal";
import { lerErroGestao } from "@/lib/gestaoErros";
import { mensagemErroPatrimonio } from "@/lib/patrimonioErros";
import { AvisoGestao, CampoSelect, CampoTexto, SecaoForm } from "@/components/gestao/GestaoFormParts";
import { CampoNumero } from "@/components/financeiroGestao/CamposLancamento";
import SeletorPaginadoGestao from "@/components/financeiroGestao/SeletorPaginadoGestao";
import { CampoTextoLongo } from "@/components/patrimonio/PatrimonioFormParts";
import MedidorBem from "@/components/patrimonio/MedidorBem";
import TanquesBem from "@/components/patrimonio/TanquesBem";
import AquisicaoDepreciacaoBem from "@/components/patrimonio/AquisicaoDepreciacaoBem";
import FormularioTipo, { OPCOES_TIPO_DE_BEM } from "@/components/patrimonio/FormularioTipo";
import { listarOpcoesBem } from "@/services/bemPatrimonialService";
import { RECURSOS_CATALOGO, buscarCatalogoPorNome, criarCatalogo } from "@/services/patrimonioCatalogoService";
import { PROPRIEDADES, ROTULO_PROPRIEDADE, UFS, campoAplicavel, capacidadesDaNatureza, ehMedidorContador, ehNatureza } from "@/lib/patrimonioDominio";
import {
  ABAS_BEM,
  CHAVE_OPCOES_PATRIMONIO,
  LIMITES_BEM,
  LOCALE_BEM,
  abaDoCampo,
  estadoInicialDoBem,
  formaDoEstado,
  medidorCorrigivel,
  mostraLeituraAtual,
  rotuloDoCentro,
  usaCustoDeUso,
  validarBem,
} from "@/components/patrimonio/bemFormulario";

export const FORMULARIO_BEM_ID = "formulario-bem-patrimonial-base1";
const FORMULARIO_TIPO_RAPIDO_ID = "formulario-tipo-rapido-bem";

/** D-PROD-202: unidade do "Custo por hora/km" pelo medidor do bem (snapshot na linha de máquina da atividade). */
const SUFIXO_DO_CUSTO = /** @type {Record<string, string>} */ ({ HORIMETRO: "R$/h", ODOMETRO: "R$/km", CICLOS: "R$/ciclo" });

/** @typedef {import('./bemFormulario').EstadoBem} EstadoBem */
/** @typedef {import('./TanquesBem').ProdutoRecusado} ProdutoRecusado */

/**
 * Ações de catálogo dentro do Bem (`acoesDeCatalogoNoBem`, D-PROD-162).
 * @typedef {{ criarCatalogo: boolean, produtosDoTanque: boolean }} AcoesCatalogoDoBem
 */

/** @param {any} o */
const referenciaDaOpcao = (o) => (o ? { id: String(o.id), rotulo: String(o.nome ?? "") } : null);

/** Texto digitado na busca → nome inicial do cadastro rápido (como digitado; o campo só exibe em maiúsculas). @param {string} busca */
const nomeInicial = (busca) => String(busca ?? "").trim();

/**
 * "+ Novo tipo" do formulário do Bem (D-PROD-169, D-PROD-95): o cadastro
 * rápido abre por cima, com o Tipo de bem do bem (travado) e o Nome. O POST vai
 * com `{natureza, nome}`: o servidor põe o tipo na família padrão do Tipo de
 * bem e gera o código (P-05). Criou → o tipo fica escolhido no bem. 409 de nome
 * repetido → "Já existe…" com "Usar o existente" (procura o homônimo ATIVO do
 * mesmo Tipo de bem).
 *
 * Fica FORA do `<form>` do bem: o evento de envio do formulário rápido (num
 * portal) não pode chegar ao `onSubmit` do bem.
 *
 * @param {{
 *   pedido: { nome: string, natureza: string } | null,
 *   onFechar: () => void,
 *   onEscolher: (opcao: any) => void,
 * }} props
 */
function CadastroRapidoTipoBem({ pedido, onFechar, onEscolher }) {
  const queryClient = useQueryClient();
  const [salvando, setSalvando] = useState(false);
  const [duplicado, setDuplicado] = useState(/** @type {{ nome: string } | null} */ (null));
  const [procurando, setProcurando] = useState(false);

  const fechar = () => {
    if (salvando || procurando) return;
    setDuplicado(null);
    onFechar();
  };

  /** @param {{ natureza: string, nome: string, salto_maximo_medidor?: string|null }} dados */
  const salvar = async (dados) => {
    if (!pedido || salvando) return;
    setSalvando(true);
    setDuplicado(null);
    try {
      const criado = await criarCatalogo(RECURSOS_CATALOGO.TIPOS, {
        natureza: pedido.natureza,
        nome: dados.nome,
        salto_maximo_medidor: dados.salto_maximo_medidor ?? null,
      });
      await queryClient.invalidateQueries({ queryKey: CHAVE_OPCOES_PATRIMONIO });
      notifySuccess("Sucesso", "Tipo criado");
      onEscolher(criado);
      onFechar();
    } catch (erro) {
      if (lerErroGestao(erro).code === "PATRIMONIO_NOME_DUPLICADO") setDuplicado({ nome: String(dados.nome ?? "") });
      else notifyWarning("Atenção", mensagemErroPatrimonio(erro, "Não foi possível salvar o tipo."));
    } finally {
      setSalvando(false);
    }
  };

  const usarExistente = async () => {
    if (!pedido || !duplicado || procurando) return;
    setProcurando(true);
    try {
      const existente = await buscarCatalogoPorNome(RECURSOS_CATALOGO.TIPOS, duplicado.nome, { natureza: pedido.natureza });
      if (!existente) {
        notifyWarning("Atenção", "O tipo com este nome está inativo (ou não está disponível): reative em “⋯ › Gerenciar tipos” ou use outro nome.");
        return;
      }
      setDuplicado(null);
      onEscolher(existente);
      onFechar();
    } catch (erro) {
      notifyWarning("Atenção", mensagemErroPatrimonio(erro, "Não foi possível procurar o tipo existente."));
    } finally {
      setProcurando(false);
    }
  };

  return (
    <CadastroRapidoSheet open={Boolean(pedido)} onClose={fechar} title="Novo tipo" formId={FORMULARIO_TIPO_RAPIDO_ID} saving={salvando || procurando}>
      {pedido ? (
        <div data-testid="bem-tipo-rapido">
          <FormularioTipo formId={FORMULARIO_TIPO_RAPIDO_ID} naturezaFixa={pedido.natureza} initialData={{ nome: pedido.nome }} onSubmit={salvar} />
          {duplicado ? (
            <div className="px-3 pb-3">
              <AvisoGestao testId="bem-catalogo-duplicado">
                <p>Já existe um tipo com este nome neste Tipo de bem. Nada foi gravado.</p>
                <button type="button" className="mt-1 min-h-8 rounded-full border border-amber-300 bg-white px-3 font-medium" onClick={usarExistente} disabled={procurando}>
                  {procurando ? "Procurando…" : "Usar o existente"}
                </button>
              </AvisoGestao>
            </div>
          ) : null}
        </div>
      ) : null}
    </CadastroRapidoSheet>
  );
}

/**
 * Formulário do Bem Patrimonial (D-PROD-157; D-PROD-162; D-PROD-169), com abas Base1:
 *  - Identificação: propriedade, responsáveis e características (os campos de
 *    placa, chassi, série, potência, construção e compatibilidade aparecem só
 *    para o Tipo de bem que os admite — §2). D-PROD-169: Área e Localização
 *    saíram da tela (o que já estiver gravado nelas fica como está);
 *  - Operação (medidor e, para máquinas, veículos e equipamentos, os tanques
 *    com os Produtos aceitos); Aquisição e depreciação (com a prévia).
 *
 * D-PROD-169: o bem tem duas escolhas — o "Tipo de bem" (a natureza, lista
 * fixa) e o "Tipo" (cadastro do usuário, só os tipos ativos do Tipo de bem).
 * Sem família na tela. O "+ Novo tipo" (quem cadastra OU edita bem:
 * `criarCatalogo`) cria no Tipo de bem do bem e o tipo criado fica escolhido.
 * O Tipo de bem não muda depois de gravado (na edição fica travado); trocar o
 * Tipo de bem de um bem novo limpa o tipo.
 *
 * Sem chave "Ativo": inativar/reativar é ação própria da tela. O envio entrega
 * a FORMA do corpo (`formaDeEdicaoDoBem`); a tela decide POST ou PATCH mínimo.
 * `produtoRecusado` = o Produto aceito que o servidor recusou no último envio
 * (422 `TANQUE_PRODUTO_INVALIDO`): a aba Operação o mostra marcado.
 *
 * @param {{
 *   detalhe?: any,
 *   duplicarDe?: any,
 *   empresaId: string|null,
 *   fuso?: string|null,
 *   readOnly?: boolean,
 *   onSubmit: (forma: Record<string, any>) => void,
 *   acoesCatalogo?: AcoesCatalogoDoBem,
 *   produtoRecusado?: ProdutoRecusado|null,
 *   onRetirarRecusado?: () => void,
 * }} props
 */
export default function FormularioBem({
  detalhe = null,
  duplicarDe = null,
  empresaId,
  fuso = null,
  readOnly = false,
  onSubmit,
  acoesCatalogo = { criarCatalogo: false, produtosDoTanque: false },
  produtoRecusado = null,
  onRetirarRecusado = undefined,
}) {
  const editando = Boolean(detalhe?.id);
  const [form, setForm] = useState(() => estadoInicialDoBem(editando ? detalhe : duplicarDe, { duplicar: !editando && Boolean(duplicarDe) }));
  const [aba, setAba] = useState(/** @type {string} */ (produtoRecusado ? ABAS_BEM.OPERACAO : ABAS_BEM.IDENTIFICACAO));
  const [erros, setErros] = useState(/** @type {Record<string, string>} */ ({}));
  const [cadastroRapido, setCadastroRapido] = useState(/** @type {{ nome: string, natureza: string } | null} */ (null));
  const podeCriarCatalogo = !readOnly && acoesCatalogo.criarCatalogo === true;

  // O servidor recusou um Produto aceito (422): a aba dos tanques mostra qual.
  useEffect(() => {
    if (produtoRecusado) setAba(ABAS_BEM.OPERACAO);
  }, [produtoRecusado]);

  // Consulta (somente leitura): o formulário espelha o detalhe. Um detalhe relido
  // sem versão nova do bem (ex.: o tipo dele renomeado em "⋯ › Gerenciar tipos",
  // D-PROD-169) atualiza a tela sem remontar — a aba aberta continua. Na edição
  // o digitado nunca é trocado.
  const detalheMostrado = useRef(detalhe);
  useEffect(() => {
    if (!readOnly || !editando || detalhe === detalheMostrado.current) return;
    detalheMostrado.current = detalhe;
    setForm(estadoInicialDoBem(detalhe, { duplicar: false }));
  }, [detalhe, readOnly, editando]);

  const natureza = ehNatureza(form.natureza) ? form.natureza : null;
  const cap = capacidadesDaNatureza(natureza);
  const aplica = (/** @type {string} */ campo) => campoAplicavel(natureza, campo);
  // "Hoje" da leitura do medidor = dia da FAZENDA (o servidor valida no fuso da empresa); sem fuso, o do navegador.
  const hoje = hojeNoFuso(fuso);
  const medidorOriginal = editando ? (detalhe.medidor ?? null) : null;
  // D-PROD-159 (X2): leitura registrada por abastecimento confirmado = piso do medidor.
  const medidorOperacional = editando ? (detalhe.medidor_operacional ?? null) : null;
  const contexto = { editando, medidorOriginal, hoje, medidorOperacional };
  const tipoDoMedidorFixo = editando && ehMedidorContador(medidorOriginal?.tipo) && !medidorCorrigivel(medidorOriginal, medidorOperacional);

  /** Tira o erro da chave e das chaves de dentro dela (`medidor` → `medidor.tipo`). @param {string} chave */
  const limparErro = (chave) =>
    setErros((atual) => {
      const restantes = Object.keys(atual).filter((k) => k !== chave && !k.startsWith(`${chave}.`));
      if (restantes.length === Object.keys(atual).length) return atual;
      return Object.fromEntries(restantes.map((k) => [k, atual[k]]));
    });

  /** @template {keyof EstadoBem} K @param {K} campo @param {EstadoBem[K]} valor */
  const set = (campo, valor) => {
    setForm((prev) => ({ ...prev, [campo]: valor }));
    limparErro(String(campo));
  };

  /** Tipo de bem: só num bem novo (gravado, ele não muda); trocar limpa o tipo. @param {string} valor */
  const escolherNatureza = (valor) => {
    if (editando || readOnly) return;
    setForm((prev) => (prev.natureza === valor ? prev : { ...prev, natureza: valor, tipo: null }));
    limparErro("natureza");
    limparErro("tipo");
  };

  const escolherTipo = (opcao) => set("tipo", referenciaDaOpcao(opcao));

  /** "+ Novo tipo": no Tipo de bem escolhido no bem. @param {string} busca */
  const pedirNovoTipo = (busca) => {
    if (!natureza) return;
    setCadastroRapido({ nome: nomeInicial(busca), natureza });
  };
  /** O tipo criado (ou o existente escolhido) fica escolhido no bem. @param {any} opcao */
  const escolherDoCadastroRapido = (opcao) => {
    if (!opcao || typeof opcao !== "object" || !opcao.id) return;
    escolherTipo(opcao);
  };

  const escolherPropriedade = (valor) => {
    setForm((prev) => ({ ...prev, propriedade: valor, proprietario: valor === "PROPRIO" ? null : prev.proprietario }));
    limparErro("propriedade");
    limparErro("depreciacao.depreciavel");
  };

  /** @param {Partial<EstadoBem['medidor']>} mudanca */
  const alterarMedidor = (mudanca) => {
    setForm((prev) => ({ ...prev, medidor: { ...prev.medidor, ...mudanca } }));
    limparErro("medidor");
  };
  /** @param {(atual: EstadoBem['tanques']) => EstadoBem['tanques']} atualizar */
  const alterarTanques = (atualizar) => setForm((prev) => ({ ...prev, tanques: atualizar(prev.tanques) }));
  /** @param {Partial<EstadoBem['aquisicao']>} mudanca */
  const alterarAquisicao = (mudanca) => {
    setForm((prev) => ({ ...prev, aquisicao: { ...prev.aquisicao, ...mudanca } }));
    for (const campo of Object.keys(mudanca)) limparErro(`aquisicao.${campo}`);
    limparErro("depreciacao.data_inicio_depreciacao");
    limparErro("depreciacao.valor_residual");
  };
  /** @param {Partial<EstadoBem['depreciacao']>} mudanca */
  const alterarDepreciacao = (mudanca) => {
    setForm((prev) => ({ ...prev, depreciacao: { ...prev.depreciacao, ...mudanca } }));
    for (const campo of Object.keys(mudanca)) limparErro(`depreciacao.${campo}`);
    if ("vidaUnidade" in mudanca) limparErro("depreciacao.vida");
    if ("depreciavel" in mudanca && !mudanca.depreciavel) limparErro("depreciacao");
  };
  /** @param {Record<string, string>} novos */
  const marcarErros = (novos) => setErros((atual) => ({ ...atual, ...novos }));

  const enviar = (ev) => {
    ev.preventDefault();
    if (readOnly) return;
    const novos = validarBem(form, contexto);
    const chaves = Object.keys(novos);
    if (chaves.length) {
      setErros(novos);
      setAba(abaDoCampo(chaves[0]));
      notifyWarning("Atenção", "Revise os campos destacados.");
      return;
    }
    onSubmit(formaDoEstado(form, contexto));
  };

  /** @type {Array<{ id: string, label: string }>} */
  const abas = [
    { id: ABAS_BEM.IDENTIFICACAO, label: "Identificação" },
    { id: ABAS_BEM.PROPRIEDADE, label: "Propriedade e responsáveis" },
    { id: ABAS_BEM.CARACTERISTICAS, label: "Características" },
  ];
  if (cap && cap.medidor !== "PROIBIDO") abas.push({ id: ABAS_BEM.OPERACAO, label: "Operação" });
  abas.push({ id: ABAS_BEM.AQUISICAO, label: "Aquisição e depreciação" });

  /** Seletor de opções da EMPRESA (responsável, parceiro, centro de custo). */
  const seletorDaEmpresa = (/** @type {{ rotulo: string, testId: string, recurso: 'responsaveis'|'parceiros'|'centros-custo', campo: 'responsavel'|'proprietario'|'centro_custo', span: number }} */ s) => (
    <SeletorPaginadoGestao
      rotulo={s.rotulo}
      testId={s.testId}
      chave={["patrimonio", s.recurso, empresaId]}
      buscar={({ q, cursor, limit }) => listarOpcoesBem(s.recurso, empresaId, { q, cursor, limit })}
      value={form[s.campo]}
      onChange={(o) => set(s.campo, s.recurso === "centros-custo" && o ? { id: String(o.id), rotulo: rotuloDoCentro(o) } : referenciaDaOpcao(o))}
      readOnly={readOnly}
      permitirLimpar
      textoVazio="— Nenhum —"
      span={s.span}
    />
  );

  const identificacao = () => (
    <div className="mg-b1-form-grid col-span-12 grid grid-cols-12 gap-x-3 gap-y-2" data-testid="bem-identificacao">
      {readOnly && editando ? (
        <CampoTexto
          label="Nº patrimonial"
          span={2}
          value={String(detalhe.numero ?? "")}
          onChange={() => {}}
          readOnly
          placeholder="GERADO AO SALVAR"
        />
      ) : null}
      <CampoTexto label="Nome" required span={6} value={form.nome} onChange={(v) => set("nome", v)} readOnly={readOnly} maxLength={120} error={erros.nome} placeholder="EX.: TRATOR TP-02" />
      <CampoTexto
        label="Código de frota"
        span={editando ? 2 : 4}
        value={form.codigo_frota}
        onChange={(v) => set("codigo_frota", v)}
        readOnly={readOnly}
        maxLength={16}
        error={erros.codigo_frota}
        placeholder="EX.: TP-02"
      />
      {editando ? <CampoTexto label="Situação" span={2} value={detalhe.ativo === false ? "Inativo" : "Ativo"} onChange={() => {}} readOnly /> : null}
      <CampoSelect
        label="Tipo de bem"
        value={form.natureza}
        onChange={escolherNatureza}
        options={OPCOES_TIPO_DE_BEM}
        placeholder="— Escolha o tipo de bem —"
        readOnly={readOnly || editando}
        required
        error={erros.natureza || undefined}
        span={4}
      />
      <SeletorPaginadoGestao
        rotulo="Tipo"
        testId="bem-seletor-tipo"
        chave={["patrimonio", "tipos", natureza]}
        buscar={({ q, cursor, limit }) => listarOpcoesBem("tipos", null, { q, cursor, limit, natureza })}
        value={form.tipo}
        onChange={escolherTipo}
        readOnly={readOnly}
        bloqueadoMotivo={natureza ? null : "Escolha o tipo de bem primeiro"}
        obrigatorio
        textoVazio="— Escolha o tipo —"
        erro={erros.tipo || undefined}
        span={8}
        onCriarNovo={podeCriarCatalogo && natureza ? pedirNovoTipo : undefined}
        rotuloCriarNovo="Novo tipo"
      />
    </div>
  );

  const propriedade = () => (
    <div className="mg-b1-form-grid col-span-12 grid grid-cols-12 gap-x-3 gap-y-2" data-testid="bem-propriedade">
      <CampoSelect
        label="Propriedade"
        value={form.propriedade}
        onChange={escolherPropriedade}
        options={PROPRIEDADES.map((p) => ({ value: p, label: ROTULO_PROPRIEDADE[p] }))}
        readOnly={readOnly}
        required
        span={4}
      />
      {form.propriedade !== "PROPRIO"
        ? seletorDaEmpresa({ rotulo: "Proprietário", testId: "bem-seletor-proprietario", recurso: "parceiros", campo: "proprietario", span: 8 })
        : null}
      {seletorDaEmpresa({ rotulo: "Responsável", testId: "bem-seletor-responsavel", recurso: "responsaveis", campo: "responsavel", span: form.propriedade !== "PROPRIO" ? 6 : 4 })}
      {seletorDaEmpresa({ rotulo: "Centro de custo", testId: "bem-seletor-centro-custo", recurso: "centros-custo", campo: "centro_custo", span: form.propriedade !== "PROPRIO" ? 6 : 4 })}
    </div>
  );

  const caracteristicas = () => (
    <div className="mg-b1-form-grid col-span-12 grid grid-cols-12 gap-x-3 gap-y-2" data-testid="bem-caracteristicas">
      <CampoTexto label="Marca" span={4} value={form.marca} onChange={(v) => set("marca", v)} readOnly={readOnly} maxLength={80} />
      <CampoTexto label="Modelo" span={4} value={form.modelo} onChange={(v) => set("modelo", v)} readOnly={readOnly} maxLength={80} />
      <CampoTexto
        label="Ano de fabricação"
        span={2}
        value={form.ano_fabricacao}
        onChange={(v) => set("ano_fabricacao", v)}
        readOnly={readOnly}
        inputMode="numeric"
        maxLength={4}
        error={erros.ano_fabricacao}
      />
      <CampoTexto
        label="Ano do modelo"
        span={2}
        value={form.ano_modelo}
        onChange={(v) => set("ano_modelo", v)}
        readOnly={readOnly}
        inputMode="numeric"
        maxLength={4}
        error={erros.ano_modelo}
      />
      {aplica("numero_serie") ? (
        <CampoTexto label="Número de série" span={4} value={form.numero_serie} onChange={(v) => set("numero_serie", v)} readOnly={readOnly} maxLength={40} />
      ) : null}
      {aplica("chassi") ? (
        <CampoTexto label="Chassi" span={4} value={form.chassi} onChange={(v) => set("chassi", v)} readOnly={readOnly} maxLength={17} error={erros.chassi} />
      ) : null}
      {aplica("potencia_cv") ? (
        <CampoNumero
          label="Potência"
          sufixo="cv"
          value={form.potencia_cv}
          onChange={(v) => set("potencia_cv", v)}
          locale={LOCALE_BEM}
          limites={LIMITES_BEM.MEDIDA}
          readOnly={readOnly}
          span={4}
          error={erros.potencia_cv || null}
          testId="bem-potencia"
        />
      ) : null}
      {aplica("placa") ? (
        <>
          <CampoTexto label="Placa" span={4} value={form.placa} onChange={(v) => set("placa", v)} readOnly={readOnly} maxLength={8} error={erros.placa} placeholder="ABC1D23" />
          <CampoSelect
            label="UF da placa"
            value={form.placa_uf}
            onChange={(v) => set("placa_uf", v)}
            options={UFS.map((uf) => ({ value: uf, label: uf }))}
            placeholder="—"
            readOnly={readOnly}
            span={2}
          />
          <CampoTexto
            label="Renavam"
            span={4}
            value={form.renavam}
            onChange={(v) => set("renavam", v)}
            readOnly={readOnly}
            inputMode="numeric"
            maxLength={11}
            error={erros.renavam}
          />
        </>
      ) : null}
      {aplica("material") ? (
        <>
          <CampoTexto label="Material" span={8} value={form.material} onChange={(v) => set("material", v)} readOnly={readOnly} maxLength={80} placeholder="EX.: MADEIRA, ALVENARIA" />
          <CampoTexto
            label="Ano de conclusão"
            span={4}
            value={form.ano_conclusao}
            onChange={(v) => set("ano_conclusao", v)}
            readOnly={readOnly}
            inputMode="numeric"
            maxLength={4}
            error={erros.ano_conclusao}
          />
        </>
      ) : null}
      {aplica("compatibilidade") ? (
        <CampoTexto
          label="Compatibilidade"
          span={12}
          value={form.compatibilidade}
          onChange={(v) => set("compatibilidade", v)}
          readOnly={readOnly}
          maxLength={255}
          placeholder="EX.: TRATORES ACIMA DE 75 CV"
        />
      ) : null}
      <CampoTextoLongo label="Especificações" value={form.especificacoes} onChange={(v) => set("especificacoes", v)} readOnly={readOnly} maxLength={1000} />
      <CampoTextoLongo label="Observações" value={form.observacoes} onChange={(v) => set("observacoes", v)} readOnly={readOnly} maxLength={2000} />
    </div>
  );

  const operacao = () => (
    <div className="mg-b1-form-grid col-span-12 grid grid-cols-12 gap-x-3 gap-y-2">
      <SecaoForm titulo="Medidor" />
      <MedidorBem
        medidor={form.medidor}
        onChange={alterarMedidor}
        regra={cap?.medidor === "OBRIGATORIO" ? "OBRIGATORIO" : "OPCIONAL"}
        comLeituraAtual={mostraLeituraAtual(form, contexto)}
        tipoFixo={tipoDoMedidorFixo}
        readOnly={readOnly}
        erros={erros}
        hoje={hoje}
        motivoFixo={
          medidorOperacional
            ? `Há leitura registrada por ${medidorOperacional.origem === "ATIVIDADE" ? "lançamento de atividade" : "abastecimento"}: o tipo e a leitura inicial não mudam, e um ajuste não pode ser menor que ${formatarNumero(
                String(medidorOperacional.leitura ?? ""),
                { locale: LOCALE_BEM, casasMin: 0, casasMax: 4 },
              )} nem anterior a ${formatarDia(medidorOperacional.data, LOCALE_BEM)}.`
            : null
        }
      />
      {usaCustoDeUso(natureza) ? (
        <CampoNumero
          label="Custo por hora/km"
          sufixo={SUFIXO_DO_CUSTO[form.medidor.tipo] ?? "R$"}
          value={form.custo_uso_unitario}
          onChange={(v) => set("custo_uso_unitario", v)}
          locale={LOCALE_BEM}
          limites={LIMITES_BEM.MEDIDA}
          readOnly={readOnly}
          span={4}
          error={erros.custo_uso_unitario || null}
          testId="bem-custo-uso"
        />
      ) : null}
      {cap?.tanques ? (
        <>
          <SecaoForm titulo="Tanques" />
          <TanquesBem
            tanques={form.tanques}
            onChange={alterarTanques}
            readOnly={readOnly}
            erros={erros}
            limparErro={limparErro}
            empresaId={empresaId}
            podeListarProdutos={acoesCatalogo.produtosDoTanque === true}
            recusa={produtoRecusado}
            onRetirarRecusado={onRetirarRecusado}
          />
        </>
      ) : null}
    </div>
  );

  const renderAba = (/** @type {string} */ id) => {
    if (id === ABAS_BEM.PROPRIEDADE) return propriedade();
    if (id === ABAS_BEM.CARACTERISTICAS) return caracteristicas();
    if (id === ABAS_BEM.OPERACAO) return operacao();
    if (id === ABAS_BEM.AQUISICAO) {
      return (
        <AquisicaoDepreciacaoBem
          estado={form}
          alterarAquisicao={alterarAquisicao}
          alterarDepreciacao={alterarDepreciacao}
          marcarErros={marcarErros}
          readOnly={readOnly}
          erros={erros}
          empresaId={empresaId}
          previaGravada={editando ? (detalhe.depreciacao?.previa ?? null) : null}
        />
      );
    }
    return identificacao();
  };

  return (
    <CadastroFormShell embedded title={editando ? "Editar bem patrimonial" : "Novo bem patrimonial"}>
      <div className="mg-b1-record-form">
        <form id={FORMULARIO_BEM_ID} onSubmit={enviar} className="b1 w-full min-h-0" noValidate data-testid="b1-form" data-densidade={DENSIDADE_BASE1}>
          <Base1PanelTabs
            tabs={abas}
            value={aba}
            onChange={setAba}
            preferenceKey="bem_patrimonial_form_panels_v1"
            animationKey={detalhe?.id ?? "novo"}
            renderPanel={renderAba}
          />
        </form>
      </div>
      <CadastroRapidoTipoBem pedido={cadastroRapido} onFechar={() => setCadastroRapido(null)} onEscolher={escolherDoCadastroRapido} />
    </CadastroFormShell>
  );
}
