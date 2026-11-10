import React, { useEffect, useState } from "react";
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
import FormularioFamilia from "@/components/patrimonio/FormularioFamilia";
import FormularioTipo from "@/components/patrimonio/FormularioTipo";
import { listarOpcoesBem } from "@/services/bemPatrimonialService";
import { RECURSOS_CATALOGO, buscarCatalogoPorNome, criarCatalogo } from "@/services/patrimonioCatalogoService";
import { PROPRIEDADES, ROTULO_NATUREZA, ROTULO_PROPRIEDADE, UFS, campoAplicavel, capacidadesDaNatureza, ehMedidorContador } from "@/lib/patrimonioDominio";
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
  validarBem,
} from "@/components/patrimonio/bemFormulario";

export const FORMULARIO_BEM_ID = "formulario-bem-patrimonial-base1";
const FORMULARIO_FAMILIA_RAPIDA_ID = "formulario-familia-rapida-bem";
const FORMULARIO_TIPO_RAPIDO_ID = "formulario-tipo-rapido-bem";

/** @typedef {import('./bemFormulario').EstadoBem} EstadoBem */
/** @typedef {import('./TanquesBem').ProdutoRecusado} ProdutoRecusado */

/**
 * Ações de catálogo dentro do Bem (`acoesDeCatalogoNoBem`, D-PROD-161).
 * @typedef {{ criarCatalogo: boolean, produtosDoTanque: boolean }} AcoesCatalogoDoBem
 */

/** @param {any} o */
const referenciaDaOpcao = (o) => (o ? { id: String(o.id), rotulo: String(o.nome ?? "") } : null);

/** Texto digitado na busca → nome inicial do cadastro rápido (como digitado; o campo só exibe em maiúsculas). @param {string} busca */
const nomeInicial = (busca) => String(busca ?? "").trim();

/**
 * "+ Nova família" / "+ Novo tipo" do formulário do Bem (D-PROD-161, D-PROD-95):
 * o cadastro rápido abre por cima, com Nome (+ Natureza na família). O código é
 * gerado no servidor (P-05). Criou → o item fica escolhido no bem. 409 de nome
 * repetido → "Já existe…" com "Usar a existente" (procura o homônimo ATIVO).
 *
 * Fica FORA do `<form>` do bem: o evento de envio do formulário rápido (num
 * portal) não pode chegar ao `onSubmit` do bem.
 *
 * @param {{
 *   pedido: { recurso: 'familias'|'tipos', nome: string, naturezaFixa: string|null, familia: { id: string, rotulo: string, natureza: string|null }|null } | null,
 *   onFechar: () => void,
 *   onEscolher: (recurso: 'familias'|'tipos', opcao: any) => void,
 * }} props
 */
function CadastroRapidoCatalogoBem({ pedido, onFechar, onEscolher }) {
  const queryClient = useQueryClient();
  const [salvando, setSalvando] = useState(false);
  const [duplicado, setDuplicado] = useState(/** @type {{ nome: string } | null} */ (null));
  const [procurando, setProcurando] = useState(false);
  const recurso = pedido?.recurso ?? "familias";
  const ehFamilia = recurso === RECURSOS_CATALOGO.FAMILIAS;

  const fechar = () => {
    if (salvando || procurando) return;
    setDuplicado(null);
    onFechar();
  };

  /** @param {Record<string, any>} dados */
  const salvar = async (dados) => {
    if (!pedido || salvando) return;
    setSalvando(true);
    setDuplicado(null);
    try {
      const criado = await criarCatalogo(recurso, dados);
      await queryClient.invalidateQueries({ queryKey: CHAVE_OPCOES_PATRIMONIO });
      notifySuccess("Sucesso", ehFamilia ? "Família patrimonial criada" : "Tipo patrimonial criado");
      onEscolher(recurso, criado);
      onFechar();
    } catch (erro) {
      if (lerErroGestao(erro).code === "PATRIMONIO_NOME_DUPLICADO") setDuplicado({ nome: String(dados.nome ?? "") });
      else notifyWarning("Atenção", mensagemErroPatrimonio(erro, ehFamilia ? "Não foi possível salvar a família." : "Não foi possível salvar o tipo."));
    } finally {
      setSalvando(false);
    }
  };

  const usarExistente = async () => {
    if (!pedido || !duplicado || procurando) return;
    setProcurando(true);
    try {
      const existente = await buscarCatalogoPorNome(recurso, duplicado.nome, { familiaId: ehFamilia ? null : (pedido.familia?.id ?? null) });
      if (!existente) {
        notifyWarning(
          "Atenção",
          `${ehFamilia ? "A família com este nome está inativa" : "O tipo com este nome está inativo"} (ou não está disponível): reative em “⋯ › Gerenciar famílias e tipos” ou use outro nome.`,
        );
        return;
      }
      if (ehFamilia && pedido.naturezaFixa && existente.natureza !== pedido.naturezaFixa) {
        const natureza = /** @type {Record<string, string>} */ (ROTULO_NATUREZA)[existente.natureza] ?? "outra natureza";
        notifyWarning("Atenção", `A família existente é de ${natureza}: a natureza do bem não muda. Use outro nome.`);
        return;
      }
      setDuplicado(null);
      onEscolher(recurso, existente);
      onFechar();
    } catch (erro) {
      notifyWarning("Atenção", mensagemErroPatrimonio(erro, "Não foi possível procurar o cadastro existente."));
    } finally {
      setProcurando(false);
    }
  };

  const formId = ehFamilia ? FORMULARIO_FAMILIA_RAPIDA_ID : FORMULARIO_TIPO_RAPIDO_ID;
  return (
    <CadastroRapidoSheet open={Boolean(pedido)} onClose={fechar} title={ehFamilia ? "Nova família" : "Novo tipo"} formId={formId} saving={salvando || procurando}>
      {pedido ? (
        <div data-testid={ehFamilia ? "bem-familia-rapida" : "bem-tipo-rapido"}>
          {ehFamilia ? (
            <FormularioFamilia rapido formId={formId} naturezaFixa={pedido.naturezaFixa} initialData={{ nome: pedido.nome }} onSubmit={salvar} />
          ) : (
            <FormularioTipo rapido formId={formId} familiaFixa={pedido.familia} initialData={{ nome: pedido.nome }} onSubmit={salvar} />
          )}
          {duplicado ? (
            <div className="px-3 pb-3">
              <AvisoGestao testId="bem-catalogo-duplicado">
                <p>{ehFamilia ? "Já existe uma família com este nome." : "Já existe um tipo com este nome nesta família."} Nada foi gravado.</p>
                <button type="button" className="mt-1 min-h-8 rounded-full border border-amber-300 bg-white px-3 font-medium" onClick={usarExistente} disabled={procurando}>
                  {procurando ? "Procurando…" : "Usar a existente"}
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
 * Formulário do Bem Patrimonial (D-PROD-157; D-PROD-161), com abas Base1:
 *  - Identificação: propriedade, responsáveis, localização e características
 *    (os campos de placa, chassi, série, potência, construção e
 *    compatibilidade aparecem só para a natureza que os admite — §2);
 *  - Operação (medidor e, para máquinas, veículos e equipamentos, os tanques
 *    com os Produtos aceitos); Aquisição e depreciação (com a prévia).
 *
 * Família e Tipo têm "+ Nova família"/"+ Novo tipo" (quem cadastra OU edita
 * bem: `criarCatalogo`): o item criado fica escolhido. A família define a
 * NATUREZA, que não muda depois de gravada: na edição só entram famílias da
 * mesma natureza (e a família nova nasce com a natureza do bem, achado D6).
 * Trocar a família limpa o tipo.
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
  const [cadastroRapido, setCadastroRapido] = useState(
    /** @type {{ recurso: 'familias'|'tipos', nome: string, naturezaFixa: string|null, familia: { id: string, rotulo: string, natureza: string|null }|null } | null} */ (null),
  );
  const podeCriarCatalogo = !readOnly && acoesCatalogo.criarCatalogo === true;

  // O servidor recusou um Produto aceito (422): a aba dos tanques mostra qual.
  useEffect(() => {
    if (produtoRecusado) setAba(ABAS_BEM.OPERACAO);
  }, [produtoRecusado]);

  const natureza = form.familia?.natureza ?? null;
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

  const escolherFamilia = (opcao) => {
    if (!opcao) return;
    const familia = { id: String(opcao.id), rotulo: String(opcao.nome ?? ""), natureza: typeof opcao.natureza === "string" ? opcao.natureza : null };
    if (editando && familia.natureza !== detalhe.natureza) {
      const rotulo = /** @type {Record<string, string>} */ (ROTULO_NATUREZA)[detalhe.natureza] ?? "a mesma natureza";
      setErros((e) => ({ ...e, familia: `A natureza do bem não muda: escolha uma família de ${rotulo}.` }));
      return;
    }
    setForm((prev) => (prev.familia?.id === familia.id ? prev : { ...prev, familia, tipo: null }));
    limparErro("familia");
  };

  const escolherTipo = (opcao) => set("tipo", referenciaDaOpcao(opcao));

  /** "+ Nova família": na edição, a natureza fica a do bem (achado D6). @param {string} busca */
  const pedirNovaFamilia = (busca) =>
    setCadastroRapido({ recurso: "familias", nome: nomeInicial(busca), naturezaFixa: editando ? (detalhe.natureza ?? null) : null, familia: null });
  /** "+ Novo tipo": na família escolhida no bem. @param {string} busca */
  const pedirNovoTipo = (busca) => {
    if (!form.familia) return;
    setCadastroRapido({ recurso: "tipos", nome: nomeInicial(busca), naturezaFixa: null, familia: { id: form.familia.id, rotulo: form.familia.rotulo, natureza: form.familia.natureza } });
  };
  /** O item criado (ou o existente escolhido) fica escolhido no bem. @param {'familias'|'tipos'} recurso @param {any} opcao */
  const escolherDoCadastroRapido = (recurso, opcao) => {
    if (!opcao || typeof opcao !== "object" || !opcao.id) return;
    if (recurso === RECURSOS_CATALOGO.FAMILIAS) escolherFamilia(opcao);
    else escolherTipo(opcao);
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
  const abas = [{ id: ABAS_BEM.IDENTIFICACAO, label: "Identificação" }];
  if (cap && cap.medidor !== "PROIBIDO") abas.push({ id: ABAS_BEM.OPERACAO, label: "Operação" });
  abas.push({ id: ABAS_BEM.AQUISICAO, label: "Aquisição e depreciação" });

  /** Seletor de opções da EMPRESA (responsável, parceiro, centro de custo, área). */
  const seletorDaEmpresa = (/** @type {{ rotulo: string, testId: string, recurso: 'responsaveis'|'parceiros'|'centros-custo'|'areas', campo: 'responsavel'|'proprietario'|'centro_custo'|'area', span: number }} */ s) => (
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
      <SecaoForm titulo="Propriedade e responsáveis" />
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
      {seletorDaEmpresa({ rotulo: "Responsável", testId: "bem-seletor-responsavel", recurso: "responsaveis", campo: "responsavel", span: 4 })}
      {seletorDaEmpresa({ rotulo: "Centro de custo", testId: "bem-seletor-centro-custo", recurso: "centros-custo", campo: "centro_custo", span: 4 })}
      {seletorDaEmpresa({ rotulo: "Área", testId: "bem-seletor-area", recurso: "areas", campo: "area", span: 4 })}
      <CampoTexto
        label="Localização"
        span={12}
        value={form.localizacao_descricao}
        onChange={(v) => set("localizacao_descricao", v)}
        readOnly={readOnly}
        maxLength={255}
        placeholder="EX.: GALPÃO DE MÁQUINAS"
      />

      <SecaoForm titulo="Características" />
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
            ? `Há leitura registrada por abastecimento: o tipo e a leitura inicial não mudam, e um ajuste não pode ser menor que ${formatarNumero(
                String(medidorOperacional.leitura ?? ""),
                { locale: LOCALE_BEM, casasMin: 0, casasMax: 4 },
              )} nem anterior a ${formatarDia(medidorOperacional.data, LOCALE_BEM)}.`
            : null
        }
      />
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

  const rotuloNatureza = natureza ? (/** @type {Record<string, string>} */ (ROTULO_NATUREZA)[natureza] ?? natureza) : "";

  return (
    <CadastroFormShell embedded title={editando ? "Editar bem patrimonial" : "Novo bem patrimonial"}>
      <div className="mg-b1-record-form">
        <form id={FORMULARIO_BEM_ID} onSubmit={enviar} className="b1 mg-b1-form-grid w-full min-h-0" noValidate data-testid="b1-form">
          <CampoTexto
            label="Nº patrimonial"
            span={2}
            value={editando ? String(detalhe.numero ?? "") : ""}
            onChange={() => {}}
            readOnly
            placeholder="GERADO AO SALVAR"
          />
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
          <SeletorPaginadoGestao
            rotulo="Família"
            testId="bem-seletor-familia"
            chave={["patrimonio", "familias"]}
            buscar={({ q, cursor, limit }) => listarOpcoesBem("familias", null, { q, cursor, limit })}
            value={form.familia ? { id: form.familia.id, rotulo: form.familia.rotulo } : null}
            onChange={escolherFamilia}
            detalheDaOpcao={(o) => /** @type {Record<string, string>} */ (ROTULO_NATUREZA)[o?.natureza] ?? null}
            readOnly={readOnly}
            obrigatorio
            textoVazio="— Escolha a família —"
            erro={erros.familia || undefined}
            span={4}
            onCriarNovo={podeCriarCatalogo ? pedirNovaFamilia : undefined}
            rotuloCriarNovo="Nova família"
          />
          <CampoTexto label="Natureza" span={2} value={rotuloNatureza} onChange={() => {}} readOnly />
          <SeletorPaginadoGestao
            rotulo="Tipo"
            testId="bem-seletor-tipo"
            chave={["patrimonio", "tipos", form.familia?.id ?? null]}
            buscar={({ q, cursor, limit }) => listarOpcoesBem("tipos", null, { q, cursor, limit, familiaId: form.familia?.id ?? null })}
            value={form.tipo}
            onChange={escolherTipo}
            readOnly={readOnly}
            bloqueadoMotivo={form.familia ? null : "Escolha a família primeiro"}
            obrigatorio
            textoVazio="— Escolha o tipo —"
            erro={erros.tipo || undefined}
            span={6}
            onCriarNovo={podeCriarCatalogo && form.familia ? pedirNovoTipo : undefined}
            rotuloCriarNovo="Novo tipo"
          />
          {!natureza && !readOnly ? (
            <div className="col-span-12">
              <AvisoGestao tone="blue" testId="bem-escolha-familia">
                Escolha a família (ou crie uma em “+ Nova família”): a natureza dela (benfeitoria, máquina, veículo…) define as abas e os campos do bem e não muda depois.
              </AvisoGestao>
            </div>
          ) : null}
          <div className="col-span-12">
            <Base1PanelTabs
              tabs={abas}
              value={aba}
              onChange={setAba}
              preferenceKey="bem_patrimonial_form_panels_v1"
              animationKey={detalhe?.id ?? "novo"}
              renderPanel={renderAba}
            />
          </div>
        </form>
      </div>
      <CadastroRapidoCatalogoBem pedido={cadastroRapido} onFechar={() => setCadastroRapido(null)} onEscolher={escolherDoCadastroRapido} />
    </CadastroFormShell>
  );
}
