import React, { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import CadastroFormShell from "@/components/cadastro/base1/CadastroFormShell";
import Base1PanelTabs from "@/components/cadastro/base1/Base1PanelTabs";
import { notifyWarning } from "@/lib/maikeNotify";
import { hojeNoFuso } from "@/lib/diaCivil";
import { AvisoGestao, CampoSelect, CampoTexto, SecaoForm } from "@/components/gestao/GestaoFormParts";
import { CampoNumero } from "@/components/financeiroGestao/CamposLancamento";
import SeletorPaginadoGestao from "@/components/financeiroGestao/SeletorPaginadoGestao";
import { CampoTextoLongo } from "@/components/patrimonio/PatrimonioFormParts";
import MedicoesBem from "@/components/patrimonio/MedicoesBem";
import MedidorBem from "@/components/patrimonio/MedidorBem";
import TanquesBem from "@/components/patrimonio/TanquesBem";
import AquisicaoDepreciacaoBem from "@/components/patrimonio/AquisicaoDepreciacaoBem";
import { listarOpcoesBem, listarOpcoesCompletasBem } from "@/services/bemPatrimonialService";
import { perfisDoTipo } from "@/services/patrimonioCatalogoService";
import { PROPRIEDADES, ROTULO_NATUREZA, ROTULO_PROPRIEDADE, UFS, campoAplicavel, capacidadesDaNatureza, ehMedidorContador } from "@/lib/patrimonioDominio";
import {
  ABAS_BEM,
  CHAVE_OPCOES_PATRIMONIO,
  LIMITES_BEM,
  LOCALE_BEM,
  abaDoCampo,
  estadoInicialDoBem,
  formaDoEstado,
  medicaoDoPerfil,
  medidorCorrigivel,
  mostraLeituraAtual,
  rotuloDoCentro,
  validarBem,
} from "@/components/patrimonio/bemFormulario";

export const FORMULARIO_BEM_ID = "formulario-bem-patrimonial-base1";

/** @typedef {import('./bemFormulario').EstadoBem} EstadoBem */

const CHAVE_PERFIS_COMPLETOS = [...CHAVE_OPCOES_PATRIMONIO, "perfis-medicao-completo"];
const buscarPerfisCompletos = () => listarOpcoesCompletasBem("perfis-medicao", null);

/** @param {any} o */
const referenciaDaOpcao = (o) => (o ? { id: String(o.id), rotulo: String(o.nome ?? "") } : null);

/**
 * Formulário do Bem Patrimonial (D-PROD-156), com abas Base1:
 *  - Identificação: propriedade, responsáveis, localização e características
 *    (os campos de placa, chassi, série, potência, construção e
 *    compatibilidade aparecem só para a natureza que os admite — §2);
 *  - Medições (só benfeitorias); Operação (medidor e, para máquinas, veículos
 *    e equipamentos, os tanques); Aquisição e depreciação (com a prévia).
 *
 * A família define a NATUREZA, que não muda depois de gravada: na edição só
 * entram famílias da mesma natureza. Trocar a família limpa o tipo. Ao
 * escolher o tipo de uma benfeitoria sem medições, os perfis sugeridos dele
 * viram as primeiras medições (só os perfis ativos).
 *
 * Sem chave "Ativo": inativar/reativar é ação própria da tela. O envio entrega
 * a FORMA do corpo (`formaDeEdicaoDoBem`); a tela decide POST ou PATCH mínimo.
 *
 * @param {{
 *   detalhe?: any,
 *   duplicarDe?: any,
 *   empresaId: string|null,
 *   readOnly?: boolean,
 *   onSubmit: (forma: Record<string, any>) => void,
 * }} props
 */
export default function FormularioBem({ detalhe = null, duplicarDe = null, empresaId, readOnly = false, onSubmit }) {
  const queryClient = useQueryClient();
  const editando = Boolean(detalhe?.id);
  const [form, setForm] = useState(() => estadoInicialDoBem(editando ? detalhe : duplicarDe, { duplicar: !editando && Boolean(duplicarDe) }));
  const [aba, setAba] = useState(/** @type {string} */ (ABAS_BEM.IDENTIFICACAO));
  const [erros, setErros] = useState(/** @type {Record<string, string>} */ ({}));
  const pedidoDoTipo = useRef(0);

  const natureza = form.familia?.natureza ?? null;
  const cap = capacidadesDaNatureza(natureza);
  const aplica = (/** @type {string} */ campo) => campoAplicavel(natureza, campo);
  const hoje = hojeNoFuso(null);
  const medidorOriginal = editando ? (detalhe.medidor ?? null) : null;
  const contexto = { editando, medidorOriginal, hoje };
  const tipoDoMedidorFixo = editando && ehMedidorContador(medidorOriginal?.tipo) && !medidorCorrigivel(medidorOriginal);

  const perfisQuery = useQuery({
    queryKey: CHAVE_PERFIS_COMPLETOS,
    queryFn: buscarPerfisCompletos,
    enabled: !readOnly && cap?.medicoes === true,
    staleTime: 60 * 1000,
  });
  const perfisAtivos = useMemo(
    () => (perfisQuery.data ? new Map(perfisQuery.data.itens.map((/** @type {any} */ p) => [String(p.id), p])) : null),
    [perfisQuery.data],
  );

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

  const escolherTipo = (opcao) => {
    set("tipo", referenciaDaOpcao(opcao));
    const sugeridos = perfisDoTipo(opcao) ?? [];
    if (readOnly || natureza !== "BENFEITORIA" || !sugeridos.length || form.medicoes.length) return;
    // Perfis sugeridos do tipo viram as primeiras medições (só os ATIVOS; o
    // inativo não pode ser adicionado). A escolha mais recente do tipo vence.
    const pedido = ++pedidoDoTipo.current;
    queryClient
      .fetchQuery({ queryKey: CHAVE_PERFIS_COMPLETOS, queryFn: buscarPerfisCompletos, staleTime: 60 * 1000 })
      .then(({ itens }) => {
        if (pedido !== pedidoDoTipo.current) return;
        const porId = new Map(itens.map((/** @type {any} */ p) => [String(p.id), p]));
        const novas = sugeridos.filter((s) => porId.has(s.perfil_id)).map((s) => medicaoDoPerfil(porId.get(s.perfil_id), s.principal));
        if (novas.length) setForm((prev) => (prev.medicoes.length ? prev : { ...prev, medicoes: novas }));
      })
      .catch(() => {
        // Sem a lista de perfis não há pré-preenchimento: as medições continuam
        // sendo adicionadas à mão pelo seletor da aba Medições.
      });
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
  /** @param {(atual: EstadoBem['medicoes']) => EstadoBem['medicoes']} atualizar */
  const alterarMedicoes = (atualizar) => setForm((prev) => ({ ...prev, medicoes: atualizar(prev.medicoes) }));
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
  if (cap?.medicoes) abas.push({ id: ABAS_BEM.MEDICOES, label: "Medições" });
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
      />
      {cap?.tanques ? (
        <>
          <SecaoForm titulo="Tanques de combustível" />
          <TanquesBem tanques={form.tanques} onChange={alterarTanques} readOnly={readOnly} erros={erros} limparErro={limparErro} />
        </>
      ) : null}
    </div>
  );

  const renderAba = (/** @type {string} */ id) => {
    if (id === ABAS_BEM.MEDICOES) {
      return <MedicoesBem medicoes={form.medicoes} onChange={alterarMedicoes} perfisAtivos={perfisAtivos} readOnly={readOnly} erros={erros} limparErro={limparErro} />;
    }
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
          />
          {!natureza && !readOnly ? (
            <div className="col-span-12">
              <AvisoGestao tone="blue" testId="bem-escolha-familia">
                Escolha a família: a natureza dela (benfeitoria, máquina, veículo…) define as abas e os campos do bem e não muda depois.
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
    </CadastroFormShell>
  );
}
