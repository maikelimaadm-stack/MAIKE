import React, { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Eye } from "lucide-react";
import CadastroFormShell from "@/components/cadastro/base1/CadastroFormShell";
import { AvisoGestao, CampoSelect, CampoTexto, SecaoForm } from "@/components/gestao/GestaoFormParts";
import { CampoDia, CampoNumero, EscolhaSegmentada } from "@/components/financeiroGestao/CamposLancamento";
import SeletorPaginadoGestao from "@/components/financeiroGestao/SeletorPaginadoGestao";
import { CampoTextoLongo } from "@/components/patrimonio/PatrimonioFormParts";
import { listarOpcoesAbastecimento } from "@/services/abastecimentoService";
import { mensagemErroAbastecimento } from "@/lib/patrimonioErros";
import {
  LIMITES_ABASTECIMENTO,
  LOCALE_ABASTECIMENTO,
  ROTULO_LEITURA,
  UNIDADE_MEDIDOR,
  canonicoDoDigitado,
  estimarKg,
  formatarDiaAbastecimento,
  formatarFator,
  formatarKg,
  formatarLeitura,
  formatarLitros,
  medidorDoFormulario,
  medidorExigeLeitura,
  rotuloDoBem,
} from "@/lib/abastecimentoRegras";
import { BOTAO_PRIMARIO, BOTAO_SECUNDARIO } from "@/components/patrimonio/DialogosAbastecimento";

export const FORMULARIO_ABASTECIMENTO_ID = "formulario-abastecimento";

/** Chaves das leituras do formulário (prefixo da tela: confirmar/cancelar invalida). */
export const chaveTanques = (/** @type {string|null} */ empresaId, /** @type {string|null} */ bemId) => ["patrimonio-abastecimentos", "tanques", empresaId, bemId];
export const chaveLocais = (/** @type {string|null} */ empresaId, /** @type {string|null} */ produtoId) => ["patrimonio-abastecimentos", "locais", empresaId, produtoId];

const ROTULO_NATUREZA_CURTO = /** @type {Record<string, string>} */ ({ MAQUINA: "Máquina", VEICULO: "Veículo", EQUIPAMENTO: "Equipamento" });

/**
 * Formulário do NOVO abastecimento (o estado vive na tela). Ordem: Bem → Tanque
 * → Combustível → Produto → Local → Data → Litros → Leitura (só contador) →
 * Tanque cheio → Observação → Referência. Trocar um campo limpa os que dependem
 * dele. Nada é gravado aqui: "Pré-visualizar" pede a prévia ao servidor.
 * @param {{
 *   empresaId: string,
 *   form: any,
 *   setForm: (atualizar: (f: any) => any) => void,
 *   hoje: string,
 *   erros: Record<string, string>,
 *   limparErro: (campo: string) => void,
 *   podeConfigurarFator: boolean,
 *   previando: boolean,
 *   situacaoPrevia: 'nenhuma'|'valida'|'invalidada',
 *   onPrevia: () => void,
 *   onReabrirPrevia: () => void,
 *   onConfigurarFator: (par: { tipo: { id: string, nome: string } | null, produto: { id: string, nome: string } | null }) => void,
 * }} props
 */
export default function FormularioAbastecimento({
  empresaId,
  form,
  setForm,
  hoje,
  erros,
  limparErro,
  podeConfigurarFator,
  previando,
  situacaoPrevia,
  onPrevia,
  onReabrirPrevia,
  onConfigurarFator,
}) {
  const bemId = form.bem?.id ? String(form.bem.id) : null;
  const produtoId = form.produto?.id ? String(form.produto.id) : null;

  /** @param {Record<string, any>} mudanca @param {string[]} campos */
  const mudar = (mudanca, campos) => {
    setForm((f) => ({ ...f, ...mudanca }));
    for (const c of campos) limparErro(c);
  };

  const tanquesQuery = useQuery({
    queryKey: chaveTanques(empresaId, bemId),
    queryFn: () => listarOpcoesAbastecimento("tanques", empresaId, { bemId }),
    enabled: Boolean(empresaId && bemId),
    staleTime: 15 * 1000,
  });
  const tanques = /** @type {any[]} */ (tanquesQuery.data?.itens ?? []);
  const bemLido = /** @type {any} */ (tanquesQuery.data?.bem ?? null);
  const tanque = tanques.find((t) => String(t.id) === String(form.tanque_id)) ?? null;
  const combustiveis = /** @type {any[]} */ (Array.isArray(tanque?.combustiveis) ? tanque.combustiveis : []);

  const locaisQuery = useQuery({
    queryKey: chaveLocais(empresaId, produtoId),
    queryFn: () => listarOpcoesAbastecimento("locais", empresaId, { produtoId }),
    enabled: Boolean(empresaId && produtoId),
    staleTime: 15 * 1000,
  });
  const locais = /** @type {any[]} */ (locaisQuery.data?.itens ?? []);

  // Um só tanque / um só combustível / um só local com saldo: já vem escolhido.
  useEffect(() => {
    if (bemId && !form.tanque_id && tanques.length === 1) setForm((f) => (f.bem?.id === bemId && !f.tanque_id ? { ...f, tanque_id: String(tanques[0].id) } : f));
  }, [bemId, form.tanque_id, tanques, setForm]);
  useEffect(() => {
    if (tanque && !form.tipo_combustivel_id && combustiveis.length === 1) {
      const tipo = String(combustiveis[0].id);
      setForm((f) => (String(f.tanque_id) === String(tanque.id) && !f.tipo_combustivel_id ? { ...f, tipo_combustivel_id: tipo } : f));
    }
  }, [tanque, form.tipo_combustivel_id, combustiveis, setForm]);
  useEffect(() => {
    if (produtoId && !form.local_estoque_id && locais.length === 1) {
      const local = String(locais[0].local_estoque_id);
      setForm((f) => (f.produto?.id === produtoId && !f.local_estoque_id ? { ...f, local_estoque_id: local } : f));
    }
  }, [produtoId, form.local_estoque_id, locais, setForm]);

  const tipoMedidor = medidorDoFormulario(form);
  const contador = medidorExigeLeitura(tipoMedidor);
  const unidade = UNIDADE_MEDIDOR[tipoMedidor] ?? "";
  const leituraVigente = bemLido?.leitura_vigente ?? null;
  const tipoEscolhido = combustiveis.find((c) => String(c.id) === String(form.tipo_combustivel_id)) ?? null;
  const conversao = form.produto?.conversao ?? null;
  const litrosCanonico = canonicoDoDigitado(form.quantidade_litros, LIMITES_ABASTECIMENTO.LITROS);
  const estimativa = useMemo(() => (litrosCanonico && conversao ? estimarKg(litrosCanonico, conversao.kg_por_litro) : null), [litrosCanonico, conversao]);
  const localEscolhido = locais.find((l) => String(l.local_estoque_id) === String(form.local_estoque_id)) ?? null;

  /** @param {React.FormEvent} ev */
  const enviar = (ev) => {
    ev.preventDefault();
    onPrevia();
  };

  return (
    <CadastroFormShell embedded title="Novo abastecimento">
      <div className="mg-b1-record-form">
        <form id={FORMULARIO_ABASTECIMENTO_ID} onSubmit={enviar} className="b1 mg-b1-form-grid w-full min-h-0" noValidate data-testid="abastecimento-form">
          <SecaoForm titulo="Bem e tanque" />
          <SeletorPaginadoGestao
            rotulo="Bem"
            testId="abastecimento-bem"
            chave={["patrimonio", "abastecimento", "bens", empresaId]}
            buscar={({ q, cursor, limit }) => listarOpcoesAbastecimento("bens", empresaId, { q, cursor, limit, uso: "formulario" })}
            value={form.bem ? { id: String(form.bem.id), rotulo: rotuloDoBem(form.bem) } : null}
            onChange={(opcao) =>
              mudar(
                { bem: opcao, tanque_id: null, tipo_combustivel_id: null, produto: null, local_estoque_id: null, medidor_leitura: "" },
                ["bem", "tanque_id", "tipo_combustivel_id", "produto", "local_estoque_id", "medidor_leitura"],
              )
            }
            rotuloDaOpcao={rotuloDoBem}
            detalheDaOpcao={(o) => ROTULO_NATUREZA_CURTO[String(o?.natureza ?? "")] ?? null}
            obrigatorio
            erro={erros.bem}
            textoVazio="— Escolha o bem —"
            span={12}
            maiusculas={false}
          />
          {bemId ? (
            tanquesQuery.isError ? (
              <div className="col-span-12">
                <AvisoGestao testId="abastecimento-tanques-erro">
                  {mensagemErroAbastecimento(tanquesQuery.error, "Não foi possível ler os tanques do bem.")}{" "}
                  <button type="button" className="underline" onClick={() => tanquesQuery.refetch()}>
                    Tentar novamente
                  </button>
                </AvisoGestao>
              </div>
            ) : (
              <>
                <CampoSelect
                  label="Tanque"
                  value={form.tanque_id ?? ""}
                  onChange={(v) => mudar({ tanque_id: v || null, tipo_combustivel_id: null, produto: null, local_estoque_id: null }, ["tanque_id", "tipo_combustivel_id", "produto", "local_estoque_id"])}
                  options={tanques.map((t) => ({ value: String(t.id), label: String(t.identificador ?? "") }))}
                  placeholder={tanquesQuery.isLoading ? "Carregando tanques…" : tanques.length ? "— Escolha o tanque —" : "Este bem não tem tanque ativo"}
                  required
                  span={6}
                  error={erros.tanque_id}
                />
                <div className="col-span-12 min-w-0 self-center text-[12px] text-[var(--mg-text-2,#475569)] md:col-span-6" data-testid="abastecimento-capacidade">
                  {tanque?.capacidade_litros ? `Capacidade nominal: ${formatarLitros(tanque.capacidade_litros)} L` : null}
                </div>
              </>
            )
          ) : null}
          {tanque ? (
            combustiveis.length ? (
              <EscolhaSegmentada
                rotulo="Combustível"
                testId="abastecimento-combustivel"
                value={String(form.tipo_combustivel_id ?? "")}
                onChange={(v) => mudar({ tipo_combustivel_id: v, produto: null, local_estoque_id: null }, ["tipo_combustivel_id", "produto", "local_estoque_id"])}
                opcoes={combustiveis.map((c) => ({ value: String(c.id), label: String(c.nome ?? "") }))}
              />
            ) : (
              <div className="col-span-12">
                <AvisoGestao>Este tanque não tem combustível ativo em litros.</AvisoGestao>
              </div>
            )
          ) : null}
          {erros.tipo_combustivel_id ? <p className="col-span-12 text-[12px] text-red-700">{erros.tipo_combustivel_id}</p> : null}

          <SecaoForm titulo="Produto e estoque" />
          <SeletorPaginadoGestao
            rotulo="Produto"
            testId="abastecimento-produto"
            chave={["patrimonio", "abastecimento", "produtos", empresaId, form.tipo_combustivel_id ?? null]}
            buscar={({ q, cursor, limit }) => listarOpcoesAbastecimento("produtos", empresaId, { q, cursor, limit, tipoCombustivelId: form.tipo_combustivel_id })}
            value={form.produto ? { id: String(form.produto.id), rotulo: String(form.produto.nome ?? "") } : null}
            onChange={(opcao) => mudar({ produto: opcao, local_estoque_id: null }, ["produto", "local_estoque_id"])}
            detalheDaOpcao={(o) => (o?.conversao ? `${formatarFator(o.conversao.kg_por_litro)} kg/L` : "sem fator kg/L")}
            bloqueadoMotivo={form.tipo_combustivel_id ? null : "Escolha o combustível primeiro"}
            obrigatorio
            erro={erros.produto}
            textoVazio="— Escolha o produto —"
            span={12}
            maiusculas={false}
          />
          {form.produto ? (
            <div className="col-span-12 min-w-0 text-[12px]" data-testid="abastecimento-fator">
              {form.produto.unidade_principal_estoque && form.produto.unidade_principal_estoque !== "KG" ? (
                <p className="text-red-700">Estoque em {form.produto.unidade_principal_estoque}: a baixa só é feita para produto com estoque em KG.</p>
              ) : null}
              {conversao ? (
                <p>
                  Estoque em KG · Fator: {formatarFator(conversao.kg_por_litro)} kg/L (versão {conversao.sequencia ?? conversao.versao})
                </p>
              ) : (
                <p className="text-amber-800">
                  Sem fator kg/L configurado para este produto e combustível.
                  {podeConfigurarFator ? (
                    <button
                      type="button"
                      className={`${BOTAO_SECUNDARIO} ml-2 min-h-8 px-3`}
                      data-testid="abastecimento-form-configurar-fator"
                      onClick={() =>
                        onConfigurarFator({
                          tipo: tipoEscolhido ? { id: String(tipoEscolhido.id), nome: String(tipoEscolhido.nome ?? "") } : null,
                          produto: { id: String(form.produto.id), nome: String(form.produto.nome ?? "") },
                        })
                      }
                    >
                      Configurar fator
                    </button>
                  ) : (
                    " Peça a quem configura o fator kg/L."
                  )}
                </p>
              )}
            </div>
          ) : null}
          {produtoId ? (
            locaisQuery.isError ? (
              <div className="col-span-12">
                <AvisoGestao testId="abastecimento-locais-erro">
                  {mensagemErroAbastecimento(locaisQuery.error, "Não foi possível ler o saldo. A confirmação confere de novo.")}{" "}
                  <button type="button" className="underline" onClick={() => locaisQuery.refetch()}>
                    Tentar novamente
                  </button>
                </AvisoGestao>
              </div>
            ) : !locaisQuery.isLoading && !locais.length ? (
              <div className="col-span-12">
                <AvisoGestao testId="abastecimento-sem-saldo">Sem saldo deste produto nesta fazenda.</AvisoGestao>
              </div>
            ) : (
              <CampoSelect
                label="Local de estoque"
                value={form.local_estoque_id ?? ""}
                onChange={(v) => mudar({ local_estoque_id: v || null }, ["local_estoque_id"])}
                options={locais.map((l) => ({ value: String(l.local_estoque_id), label: `${l.local_nome} — disponível: ${formatarKg(l.disponivel_kg)} kg` }))}
                placeholder={locaisQuery.isLoading ? "Carregando saldos…" : "— Escolha o local —"}
                required
                span={12}
                error={erros.local_estoque_id}
              />
            )
          ) : null}

          <SecaoForm titulo="Abastecimento" />
          <CampoDia
            label="Data do abastecimento"
            value={form.data_operacional}
            onChange={(v) => mudar({ data_operacional: v }, ["data_operacional"])}
            max={hoje}
            required
            span={4}
            error={erros.data_operacional}
            testId="abastecimento-data"
          />
          <CampoNumero
            label="Quantidade (L)"
            sufixo="L"
            value={form.quantidade_litros}
            onChange={(v) => mudar({ quantidade_litros: v }, ["quantidade_litros"])}
            locale={LOCALE_ABASTECIMENTO}
            limites={LIMITES_ABASTECIMENTO.LITROS}
            required
            span={4}
            error={erros.quantidade_litros}
            testId="abastecimento-litros"
          />
          <div className="col-span-12 min-w-0 self-center text-[12px] text-[var(--mg-text-2,#475569)] md:col-span-4" data-testid="abastecimento-estimativa">
            {estimativa ? `Estimativa: ≈ ${formatarKg(estimativa)} kg` : null}
          </div>
          {contador ? (
            <>
              <CampoNumero
                label={ROTULO_LEITURA[tipoMedidor] ?? "Leitura do medidor"}
                sufixo={unidade}
                value={form.medidor_leitura}
                onChange={(v) => mudar({ medidor_leitura: v }, ["medidor_leitura"])}
                locale={LOCALE_ABASTECIMENTO}
                limites={LIMITES_ABASTECIMENTO.LEITURA}
                required
                span={4}
                error={erros.medidor_leitura}
                testId="abastecimento-leitura"
              />
              <div className="col-span-12 min-w-0 self-center text-[12px] text-[var(--mg-text-2,#475569)] md:col-span-8" data-testid="abastecimento-ultima-leitura">
                {leituraVigente?.leitura
                  ? `Última leitura: ${formatarLeitura(leituraVigente.leitura)} ${unidade} em ${formatarDiaAbastecimento(leituraVigente.data)}${
                      leituraVigente.origem === "CADASTRO" ? " (cadastro do bem)" : leituraVigente.numero ? ` (abastecimento nº ${leituraVigente.numero})` : ""
                    }`
                  : null}
              </div>
            </>
          ) : null}
          <label className="col-span-12 flex min-w-0 items-start gap-2 text-[13px]">
            <input
              type="checkbox"
              className="mt-0.5 shrink-0 accent-emerald-600"
              style={{ width: 20, height: 20 }}
              checked={form.tanque_cheio === true}
              onChange={(e) => mudar({ tanque_cheio: e.target.checked }, [])}
              data-testid="abastecimento-tanque-cheio"
            />
            <span className="min-w-0 break-words">
              Completei o tanque (tanque cheio)
              <span className="block text-[11px] text-[var(--mg-text-2,#475569)]">
                Marque só quando completar o tanque: o consumo (km/L ou L/h) é calculado entre dois tanques cheios. Nenhum saldo de tanque é presumido.
              </span>
            </span>
          </label>
          <CampoTextoLongo label="Observação" value={form.observacao} onChange={(v) => mudar({ observacao: v }, ["observacao"])} maxLength={500} />
          <CampoTexto
            label="Referência externa"
            value={form.referencia_externa}
            onChange={(v) => mudar({ referencia_externa: v }, ["referencia_externa"])}
            maxLength={64}
            span={6}
            keepCase
            error={erros.referencia_externa}
          />
          {localEscolhido && estimativa ? (
            <p className="col-span-12 text-[12px] text-[var(--mg-text-2,#475569)]">
              Saldo em {localEscolhido.local_nome}: {formatarKg(localEscolhido.disponivel_kg)} kg. A prévia confere lotes, custo e medidor no servidor.
            </p>
          ) : null}
          {situacaoPrevia === "invalidada" ? (
            <p role="status" className="col-span-12 rounded-md border border-amber-300 bg-amber-50 p-2 text-[12px] text-amber-900" data-testid="abastecimento-previa-invalidada">
              Os dados mudaram desde a prévia: pré-visualize de novo antes de confirmar.
            </p>
          ) : null}
          <div className="col-span-12 flex flex-wrap gap-2 pt-1">
            <button type="submit" className={BOTAO_PRIMARIO} disabled={previando} data-testid="abastecimento-previa">
              <Eye size={16} aria-hidden /> {previando ? "Calculando prévia…" : "Pré-visualizar"}
            </button>
            {situacaoPrevia === "valida" ? (
              <button type="button" className={BOTAO_SECUNDARIO} onClick={onReabrirPrevia} data-testid="abastecimento-reabrir-previa">
                Voltar à prévia
              </button>
            ) : null}
          </div>
        </form>
      </div>
    </CadastroFormShell>
  );
}
