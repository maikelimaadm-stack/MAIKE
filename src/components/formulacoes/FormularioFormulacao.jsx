import React, { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import B1Field, { B1_FIELD_CTL_CLS, DENSIDADE_BASE1 } from "@/components/cadastro/base1/B1Field";
import B1Select from "@/components/cadastro/base1/B1Select";
import { B1ChaveRow } from "@/components/cadastro/base1/Base1Ui";
import CadastroFormShell from "@/components/cadastro/base1/CadastroFormShell";
import CadastroFormActions from "@/components/cadastro/base1/CadastroFormActions";
import { notifyWarning } from "@/lib/maikeNotify";
import {
  BASES_CONSUMO,
  FAIXA_PADRAO,
  PV_MAXIMO,
  equivalenteEmKg,
  rotuloDaBase,
  TIPOS_FORMULACAO,
  formatarNumero,
  resumoDaBatida,
  rotuloDoTipo,
  validarFormulacao,
} from "@/services/formulacaoCadastroService";

export const FORMULARIO_FORMULACAO_ID = "formulario-formulacao-base1";

const CTL_NUMERO = B1_FIELD_CTL_CLS.replace(" uppercase", " normal-case tabular-nums");

/**
 * @typedef {{ id: string, nome_produto?: string, tipo_uso?: string | null, ativo?: boolean }} ProdutoOpcao
 * @typedef {{ id: string, nome?: string, ativo?: boolean }} CategoriaOpcao
 * @typedef {import("@/services/formulacaoCadastroService").FormulacaoForm} FormulacaoForm
 */

/** Número da API → texto do campo ("0,15"). */
const textoDe = (/** @type {unknown} */ v) => (typeof v === "number" ? formatarNumero(v, { casasMax: 4 }).replace(/\./g, "") : "");

/** Registro da API (ou nada) → estado do formulário. @param {any} r @returns {FormulacaoForm} */
export const formularioDoRegistro = (r) => ({
  nome: r?.nome || "",
  tipo: r?.tipo || "PRONTO",
  produto_id: r?.produto_id || "",
  base_consumo: r?.base_consumo === "G_CAB_DIA" ? "G_CAB_DIA" : "PV",
  percentual_pv_padrao: textoDe(r?.percentual_pv_padrao),
  consumo_objetivo_g_cab_dia: textoDe(r?.consumo_objetivo_g_cab_dia),
  faixa_tolerancia_percentual: textoDe(r?.faixa_tolerancia_percentual),
  // D-PROD-288: consumo mínimo e máximo (%PV), que saíram do cadastro do produto.
  consumo_minimo_pv: textoDe(r?.consumo_minimo_pv),
  consumo_maximo_pv: textoDe(r?.consumo_maximo_pv),
  observacoes: r?.observacoes || "",
  ativo: r?.ativo ?? true,
  ingredientes: (r?.ingredientes || []).map((/** @type {any} */ i) => ({ produto_id: i.produto_id, quantidade_kg: textoDe(i.quantidade_kg) })),
  regras: (r?.regras || []).map((/** @type {any} */ x) => ({
    categoria_manejo_id: x.categoria_manejo_id,
    consome: x.consome !== false,
    percentual_pv: textoDe(x.percentual_pv),
    g_cab_dia: textoDe(x.g_cab_dia),
  })),
});

/**
 * D-PROD-210 — trocar a base do consumo LIMPA o padrão e os valores das regras (as categorias e o "consome" ficam):
 * nada da base antiga sobra escondido na conta.
 * @param {FormulacaoForm} prev
 * @param {string} base
 * @returns {FormulacaoForm}
 */
export const trocarBaseDoConsumo = (prev, base) =>
  prev.base_consumo === base
    ? prev
    : {
        ...prev,
        base_consumo: base,
        percentual_pv_padrao: "",
        consumo_objetivo_g_cab_dia: "",
        regras: prev.regras.map((r) => ({ ...r, percentual_pv: "", g_cab_dia: "" })),
      };

/**
 * Opções de um select de cadastro: os ATIVOS, em ordem de nome, e o já gravado
 * (mesmo inativo, marcado "(INATIVO)") para não sumir da tela.
 * @param {Array<{ id: string, ativo?: boolean }>} lista
 * @param {(item: any) => string} nomeDe
 * @param {string[]} gravados
 */
const opcoesDe = (lista, nomeDe, gravados) =>
  (lista || [])
    .filter((x) => x.ativo !== false || gravados.includes(x.id))
    .map((x) => ({ value: x.id, label: `${nomeDe(x)}${x.ativo === false ? " (INATIVO)" : ""}` }))
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));

/**
 * Formulário do cadastro de Formulações de suplemento (D-PROD-203).
 *
 * Campos: Nome, Tipo (Produto pronto / Batelada), Produto (o que vai ao cocho:
 * o produto pronto, ou o produto misturado cadastrado antes em Produtos), %PV
 * padrão, Consumo objetivo (g/cab/dia, opcional), Ativo e Observações; a seção
 * "Regras por categoria" (Categoria de Manejo + Consome? + %PV quando consome)
 * e, só na BATELADA, "Ingredientes (kg por batida)" com o total da batida e o %
 * de cada um. A fazenda não é campo: é a selecionada no topo da tela.
 *
 * @param {{
 *   initialData?: any,
 *   isEditing?: boolean,
 *   produtos?: ProdutoOpcao[],
 *   categorias?: CategoriaOpcao[],
 *   onSubmit: (dados: Record<string, unknown>) => void,
 *   onCancel?: () => void,
 *   variant?: "card" | "embedded",
 *   toolbarActions?: boolean,
 *   isSubmitting?: boolean,
 *   readOnly?: boolean,
 * }} props
 */
export default function FormularioFormulacao({
  initialData,
  isEditing,
  produtos = [],
  categorias = [],
  onSubmit,
  onCancel,
  variant = "card",
  toolbarActions = false,
  isSubmitting = false,
  readOnly = false,
}) {
  const embedded = variant === "embedded";
  const isExistingRecord = Boolean(initialData?.id);
  const [formData, setFormData] = useState(() => formularioDoRegistro(initialData));
  const [erros, setErros] = useState(/** @type {Record<string, string>} */ ({}));
  const travado = readOnly || isSubmitting;
  const batelada = formData.tipo === "BATELADA";
  const emGramas = formData.base_consumo === "G_CAB_DIA";

  const gravadosProduto = useMemo(
    () => [initialData?.produto_id, ...(initialData?.ingredientes || []).map((/** @type {any} */ i) => i.produto_id)].filter(Boolean),
    [initialData],
  );
  const gravadasCategoria = useMemo(() => (initialData?.regras || []).map((/** @type {any} */ r) => r.categoria_manejo_id), [initialData]);
  const opcoesProduto = useMemo(() => opcoesDe(produtos, (p) => p.nome_produto || "", gravadosProduto), [produtos, gravadosProduto]);
  const opcoesCategoria = useMemo(() => opcoesDe(categorias, (c) => c.nome || "", gravadasCategoria), [categorias, gravadasCategoria]);
  const nomeDoProduto = (/** @type {string} */ id) => opcoesProduto.find((o) => o.value === id)?.label || "";
  const nomeDaCategoria = (/** @type {string} */ id) => opcoesCategoria.find((o) => o.value === id)?.label || "";
  const batida = resumoDaBatida(formData.ingredientes);

  /** @param {(prev: FormulacaoForm) => FormulacaoForm} mudar @param {string[]} [limpar] */
  const atualizar = (mudar, limpar = []) => {
    setErros((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => !limpar.some((c) => k === c || k.startsWith(`${c}.`)))));
    setFormData(mudar);
  };
  /** @param {keyof FormulacaoForm} campo @param {any} valor */
  const mudarCampo = (campo, valor) => atualizar((prev) => ({ ...prev, [campo]: valor }), [campo]);

  /** @param {number} n @param {Partial<import("@/services/formulacaoCadastroService").IngredienteForm>} parte */
  const mudarIngrediente = (n, parte) =>
    atualizar((prev) => ({ ...prev, ingredientes: prev.ingredientes.map((i, k) => (k === n ? { ...i, ...parte } : i)) }), ["ingredientes"]);
  /** @param {number} n @param {Partial<import("@/services/formulacaoCadastroService").RegraForm>} parte */
  const mudarRegra = (n, parte) =>
    atualizar((prev) => ({ ...prev, regras: prev.regras.map((r, k) => (k === n ? { ...r, ...parte } : r)) }), ["regras"]);

  /** @param {React.FormEvent<HTMLFormElement>} e */
  const handleSubmit = (e) => {
    e.preventDefault();
    if (readOnly) return;
    const r = validarFormulacao(formData);
    if (!r.corpo) {
      setErros(r.erros);
      notifyWarning(
        "Atenção",
        r.erros.ingredientes ||
          (emGramas
            ? "Confira os campos marcados: g/cab/dia maior que 0 (padrão e regras que consomem), kg por batida maior que 0 e nada repetido."
            : `Confira os campos marcados: %PV de 0 a ${formatarNumero(PV_MAXIMO)}%, kg por batida maior que 0 e nada repetido.`),
      );
      return;
    }
    onSubmit(r.corpo);
  };

  const formBody = (
    <form
      id={FORMULARIO_FORMULACAO_ID}
      onSubmit={handleSubmit}
      className="b1 mg-b1-form-grid w-full min-h-0"
      noValidate
      data-testid="b1-form-formulacao"
      data-densidade={DENSIDADE_BASE1}
    >
      <B1Field label="Nome" required span={8} hasValue={Boolean(formData.nome.trim())} locked={readOnly} disabled={travado} error={erros.nome}>
        <input
          type="text"
          value={formData.nome}
          onChange={(e) => mudarCampo("nome", e.target.value.toUpperCase())}
          placeholder="EX.: SAL MINERAL 80 / PROTEINADO DA SECA"
          maxLength={120}
          className={`${B1_FIELD_CTL_CLS} uppercase`}
          readOnly={readOnly}
        />
      </B1Field>

      <B1Field label="Tipo" required span={4} hasValue locked={readOnly} disabled={travado} error={erros.tipo}>
        {readOnly ? (
          <input type="text" readOnly value={rotuloDoTipo(formData.tipo)} className={B1_FIELD_CTL_CLS} />
        ) : (
          <B1Select value={formData.tipo} onChange={(e) => mudarCampo("tipo", e.target.value)} className={B1_FIELD_CTL_CLS} semOpcaoVazia>
            {TIPOS_FORMULACAO.map((t) => (
              <option key={t.valor} value={t.valor}>
                {t.rotulo}
              </option>
            ))}
          </B1Select>
        )}
      </B1Field>

      <B1Field
        label={batelada ? "Produto misturado (vai ao cocho)" : "Produto (vai ao cocho)"}
        required
        span={6}
        hasValue={Boolean(formData.produto_id)}
        locked={readOnly}
        disabled={travado}
        error={erros.produto_id}
        dica={
          readOnly ? undefined : (
            <p className="b1-campo-dica text-[11px]">
              {batelada ? "Cadastre antes em Produtos o produto da mistura; é ele que o lançamento baixa do estoque." : "O produto comprado pronto que vai ao cocho."}
            </p>
          )
        }
      >
        {readOnly ? (
          <input type="text" readOnly value={nomeDoProduto(formData.produto_id) || initialData?.produto_nome || ""} className={B1_FIELD_CTL_CLS} />
        ) : (
          <B1Select value={formData.produto_id} onChange={(e) => mudarCampo("produto_id", e.target.value)} className={B1_FIELD_CTL_CLS} pesquisa="sempre" maiusculas>
            <option value="">SELECIONE</option>
            {opcoesProduto.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </B1Select>
        )}
      </B1Field>

      {/* D-PROD-210: UMA base do consumo por formulação; trocar limpa os valores da base antiga. */}
      <B1Field label="Base do consumo" required span={3} hasValue locked={readOnly} disabled={travado}>
        {readOnly ? (
          <input type="text" readOnly value={rotuloDaBase(formData.base_consumo)} className={B1_FIELD_CTL_CLS} />
        ) : (
          <B1Select
            value={formData.base_consumo}
            onChange={(e) => atualizar((prev) => trocarBaseDoConsumo(prev, e.target.value), ["percentual_pv_padrao", "consumo_objetivo_g_cab_dia", "regras"])}
            className={B1_FIELD_CTL_CLS}
            semOpcaoVazia
            aria-label="Base do consumo"
          >
            {BASES_CONSUMO.map((b) => (
              <option key={b.valor} value={b.valor}>
                {b.rotulo}
              </option>
            ))}
          </B1Select>
        )}
      </B1Field>

      {emGramas ? (
        <B1Field
          label="Consumo padrão (g/cab/dia)"
          required
          span={3}
          hasValue={Boolean(formData.consumo_objetivo_g_cab_dia.trim())}
          locked={readOnly}
          disabled={travado}
          error={erros.consumo_objetivo_g_cab_dia}
          dica={
            <p className="b1-campo-dica text-[11px]" data-testid="formulacao-g-padrao-kg">
              {equivalenteEmKg(formData.consumo_objetivo_g_cab_dia) || "Gramas por cabeça por dia (ex.: 80; 1500 = 1,5 kg)"}
            </p>
          }
        >
          <input
            type="text"
            inputMode="decimal"
            value={formData.consumo_objetivo_g_cab_dia}
            onChange={(e) => mudarCampo("consumo_objetivo_g_cab_dia", e.target.value)}
            placeholder="80"
            maxLength={10}
            className={CTL_NUMERO}
            readOnly={readOnly}
            aria-label="Consumo padrão em gramas por cabeça por dia"
          />
        </B1Field>
      ) : (
        <B1Field
          label="% PV padrão"
          required
          span={3}
          hasValue={Boolean(formData.percentual_pv_padrao.trim())}
          locked={readOnly}
          disabled={travado}
          error={erros.percentual_pv_padrao}
          dica={
            readOnly ? undefined : (
              <p className="b1-campo-dica text-[11px]">
                % do peso vivo por cabeça/dia (ex.: 0,1)
                {formData.consumo_objetivo_g_cab_dia.trim() ? (
                  <span className="block" data-testid="formulacao-g-referencia">
                    Referência: {formData.consumo_objetivo_g_cab_dia} g/cab/dia (não entra na conta)
                  </span>
                ) : null}
              </p>
            )
          }
        >
          <input
            type="text"
            inputMode="decimal"
            value={formData.percentual_pv_padrao}
            onChange={(e) => mudarCampo("percentual_pv_padrao", e.target.value)}
            placeholder="0,1"
            maxLength={8}
            className={CTL_NUMERO}
            readOnly={readOnly}
            aria-label="Percentual do peso vivo padrão"
          />
        </B1Field>
      )}

      {/* D-PROD-206: faixa do farol de consumo no fechamento do período (vazio = 15%). */}
      <B1Field
        label="Faixa de tolerância (%)"
        span={3}
        hasValue={Boolean(String(formData.faixa_tolerancia_percentual ?? "").trim())}
        locked={readOnly}
        disabled={travado}
        error={erros.faixa_tolerancia_percentual}
      >
        <input
          type="text"
          inputMode="decimal"
          value={formData.faixa_tolerancia_percentual ?? ""}
          onChange={(e) => mudarCampo("faixa_tolerancia_percentual", e.target.value)}
          placeholder={String(FAIXA_PADRAO)}
          maxLength={6}
          className={CTL_NUMERO}
          readOnly={readOnly}
          aria-label="Faixa de tolerância do consumo, em porcentagem do esperado"
        />
      </B1Field>

      {/* D-PROD-288: consumo mínimo e máximo do cocho (%PV); vieram do cadastro do produto. */}
      {/** @type {Array<["consumo_minimo_pv" | "consumo_maximo_pv", string]>} */ ([["consumo_minimo_pv", "%PV mínimo"], ["consumo_maximo_pv", "%PV máximo"]]).map(([campo, rotulo]) => (
        <B1Field
          key={campo}
          label={rotulo}
          span={3}
          hasValue={Boolean(String(formData[campo] ?? "").trim())}
          locked={readOnly}
          disabled={travado}
          error={erros[campo]}
        >
          <input
            type="text"
            inputMode="decimal"
            value={formData[campo] ?? ""}
            onChange={(e) => mudarCampo(campo, e.target.value)}
            maxLength={8}
            className={CTL_NUMERO}
            readOnly={readOnly}
            aria-label={`${rotulo} do consumo, em porcentagem do peso vivo`}
            data-testid={`formulacao-${campo}`}
          />
        </B1Field>
      ))}

      <section className="col-span-12" aria-labelledby="formulacao-regras-titulo" data-testid="formulacao-regras">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p id="formulacao-regras-titulo" className="text-[13px] font-medium text-[#3D3D3A]">
            Regras por categoria <span className="text-[11px] font-normal text-[#73726C]">{emGramas ? "(exceções ao g/cab/dia padrão)" : "(exceções ao % PV padrão)"}</span>
          </p>
          {readOnly ? null : (
            <button
              type="button"
              className="tb-btn tb-btn-gray h-7 text-xs"
              onClick={() => atualizar((prev) => ({ ...prev, regras: [...prev.regras, { categoria_manejo_id: "", consome: false, percentual_pv: "", g_cab_dia: "" }] }), ["regras"])}
              disabled={travado}
              data-testid="formulacao-regra-adicionar"
            >
              <Plus aria-hidden className="h-3.5 w-3.5" /> Adicionar regra
            </button>
          )}
        </div>
        {formData.regras.length === 0 ? (
          <p className="text-[12px] text-[#73726C]" data-testid="formulacao-sem-regras">
            {emGramas ? "Sem exceção: todas as categorias consomem o g/cab/dia padrão." : "Sem exceção: todas as categorias consomem o % PV padrão."}
          </p>
        ) : (
          <div className="space-y-2">
            {formData.regras.map((regra, n) => (
              <div key={n} className="grid grid-cols-12 gap-3 items-start" data-testid={`formulacao-regra-${n}`}>
                <B1Field
                  label="Categoria de Manejo"
                  required
                  span={6}
                  hasValue={Boolean(regra.categoria_manejo_id)}
                  locked={readOnly}
                  disabled={travado}
                  error={erros[`regras.${n}.categoria_manejo_id`]}
                >
                  {readOnly ? (
                    <input type="text" readOnly value={nomeDaCategoria(regra.categoria_manejo_id)} className={B1_FIELD_CTL_CLS} />
                  ) : (
                    <B1Select
                      value={regra.categoria_manejo_id}
                      onChange={(e) => mudarRegra(n, { categoria_manejo_id: e.target.value })}
                      className={B1_FIELD_CTL_CLS}
                      aria-label={`Categoria da regra ${n + 1}`}
                      maiusculas
                    >
                      <option value="">SELECIONE</option>
                      {opcoesCategoria.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </B1Select>
                  )}
                </B1Field>
                <B1ChaveRow
                  label="Consome?"
                  span={2}
                  checked={regra.consome}
                  onChange={readOnly ? undefined : (/** @type {boolean} */ v) => mudarRegra(n, { consome: v, percentual_pv: v ? regra.percentual_pv : "", g_cab_dia: v ? regra.g_cab_dia ?? "" : "" })}
                  disabled={travado}
                  ariaLabel={`Consome (regra ${n + 1})`}
                />
                {regra.consome && emGramas ? (
                  <B1Field
                    label="g/cab/dia"
                    required
                    span={3}
                    hasValue={Boolean(String(regra.g_cab_dia ?? "").trim())}
                    locked={readOnly}
                    disabled={travado}
                    error={erros[`regras.${n}.g_cab_dia`]}
                    dica={
                      <p className="b1-campo-dica text-[11px]" data-testid={`formulacao-regra-${n}-kg`}>
                        {equivalenteEmKg(regra.g_cab_dia)}
                      </p>
                    }
                  >
                    <input
                      type="text"
                      inputMode="decimal"
                      value={regra.g_cab_dia ?? ""}
                      onChange={(e) => mudarRegra(n, { g_cab_dia: e.target.value })}
                      placeholder="1500"
                      maxLength={10}
                      className={CTL_NUMERO}
                      readOnly={readOnly}
                      aria-label={`Gramas por cabeça por dia da regra ${n + 1}`}
                    />
                  </B1Field>
                ) : regra.consome ? (
                  <B1Field
                    label="% PV"
                    required
                    span={3}
                    hasValue={Boolean(regra.percentual_pv.trim())}
                    locked={readOnly}
                    disabled={travado}
                    error={erros[`regras.${n}.percentual_pv`]}
                  >
                    <input
                      type="text"
                      inputMode="decimal"
                      value={regra.percentual_pv}
                      onChange={(e) => mudarRegra(n, { percentual_pv: e.target.value })}
                      placeholder="0,15"
                      maxLength={8}
                      className={CTL_NUMERO}
                      readOnly={readOnly}
                      aria-label={`Percentual do peso vivo da regra ${n + 1}`}
                    />
                  </B1Field>
                ) : (
                  <p className="col-span-12 md:col-span-3 self-center text-[12px] text-[#73726C]">Não consome esta formulação.</p>
                )}
                {readOnly ? null : (
                  <div className="col-span-12 md:col-span-1 self-center">
                    <button
                      type="button"
                      className="tb-btn tb-btn-icon"
                      onClick={() => atualizar((prev) => ({ ...prev, regras: prev.regras.filter((_, k) => k !== n) }), ["regras"])}
                      disabled={travado}
                      aria-label={`Remover regra ${n + 1}`}
                      title="Remover regra"
                    >
                      <Trash2 aria-hidden className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {batelada ? (
        <section className="col-span-12" aria-labelledby="formulacao-ingredientes-titulo" data-testid="formulacao-ingredientes">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p id="formulacao-ingredientes-titulo" className="text-[13px] font-medium text-[#3D3D3A]">
              Ingredientes (kg por batida)
            </p>
            {readOnly ? null : (
              <button
                type="button"
                className="tb-btn tb-btn-gray h-7 text-xs"
                onClick={() => atualizar((prev) => ({ ...prev, ingredientes: [...prev.ingredientes, { produto_id: "", quantidade_kg: "" }] }), ["ingredientes"])}
                disabled={travado}
                data-testid="formulacao-ingrediente-adicionar"
              >
                <Plus aria-hidden className="h-3.5 w-3.5" /> Adicionar ingrediente
              </button>
            )}
          </div>
          {erros.ingredientes ? (
            <p className="mg-b1-field-msg" role="alert" data-testid="formulacao-ingredientes-erro">
              {erros.ingredientes}
            </p>
          ) : null}
          <div className="space-y-2">
            {formData.ingredientes.map((ing, n) => (
              <div key={n} className="grid grid-cols-12 gap-3 items-start" data-testid={`formulacao-ingrediente-${n}`}>
                <B1Field
                  label="Produto"
                  required
                  span={6}
                  hasValue={Boolean(ing.produto_id)}
                  locked={readOnly}
                  disabled={travado}
                  error={erros[`ingredientes.${n}.produto_id`]}
                >
                  {readOnly ? (
                    <input type="text" readOnly value={nomeDoProduto(ing.produto_id)} className={B1_FIELD_CTL_CLS} />
                  ) : (
                    <B1Select
                      value={ing.produto_id}
                      onChange={(e) => mudarIngrediente(n, { produto_id: e.target.value })}
                      className={B1_FIELD_CTL_CLS}
                      aria-label={`Produto do ingrediente ${n + 1}`}
                      pesquisa="sempre"
                      maiusculas
                    >
                      <option value="">SELECIONE</option>
                      {opcoesProduto.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </B1Select>
                  )}
                </B1Field>
                <B1Field
                  label="kg"
                  required
                  span={3}
                  hasValue={Boolean(ing.quantidade_kg.trim())}
                  locked={readOnly}
                  disabled={travado}
                  error={erros[`ingredientes.${n}.quantidade_kg`]}
                >
                  <input
                    type="text"
                    inputMode="decimal"
                    value={ing.quantidade_kg}
                    onChange={(e) => mudarIngrediente(n, { quantidade_kg: e.target.value })}
                    placeholder="0"
                    maxLength={12}
                    className={CTL_NUMERO}
                    readOnly={readOnly}
                    aria-label={`kg do ingrediente ${n + 1}`}
                  />
                </B1Field>
                <p className="col-span-6 md:col-span-2 self-center text-[12px] tabular-nums text-[#3D3D3A]" data-testid={`formulacao-ingrediente-${n}-percentual`}>
                  {batida.percentuais[n] === null ? "–" : `${formatarNumero(batida.percentuais[n], { casasMax: 2 })}%`}
                </p>
                {readOnly ? null : (
                  <div className="col-span-6 md:col-span-1 self-center">
                    <button
                      type="button"
                      className="tb-btn tb-btn-icon"
                      onClick={() => atualizar((prev) => ({ ...prev, ingredientes: prev.ingredientes.filter((_, k) => k !== n) }), ["ingredientes"])}
                      disabled={travado}
                      aria-label={`Remover ingrediente ${n + 1}`}
                      title="Remover ingrediente"
                    >
                      <Trash2 aria-hidden className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
          <p className="mt-2 text-[13px] text-[#3D3D3A]">
            Total da batida:{" "}
            <span className="font-medium tabular-nums" data-testid="formulacao-total-batida">
              {formatarNumero(batida.totalKg, { casasMax: 3 })} kg
            </span>
          </p>
        </section>
      ) : null}

      <B1ChaveRow
        label="Ativo"
        span={4}
        checked={formData.ativo}
        onChange={readOnly ? undefined : (/** @type {boolean} */ v) => mudarCampo("ativo", v)}
        disabled={travado}
        ariaLabel="Formulação ativa"
      />

      <B1Field label="Observações" span={12} hasValue={Boolean(formData.observacoes.trim())} locked={readOnly} disabled={travado}>
        <textarea
          value={formData.observacoes}
          onChange={(e) => mudarCampo("observacoes", e.target.value.toUpperCase())}
          placeholder="OBSERVAÇÕES DA FORMULAÇÃO"
          maxLength={2000}
          className={`${B1_FIELD_CTL_CLS} uppercase min-h-[3rem] resize-y`}
          rows={2}
          readOnly={readOnly}
        />
      </B1Field>

      {!toolbarActions ? (
        <div className="col-span-12">
          <CadastroFormActions onCancel={onCancel} submitLabel={isExistingRecord ? "Atualizar" : "Salvar"} isSubmitting={isSubmitting} />
        </div>
      ) : null}
    </form>
  );

  return (
    <CadastroFormShell embedded={embedded} title={isEditing ? "Editar Formulação" : "Nova Formulação"}>
      {formBody}
    </CadastroFormShell>
  );
}
