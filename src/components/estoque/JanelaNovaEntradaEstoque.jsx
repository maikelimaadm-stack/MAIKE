import React, { useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import B1Janela from "@/components/cadastro/base1/B1Janela";
import { AvisoGestao, CampoSelect, CampoTexto, SecaoForm } from "@/components/gestao/GestaoFormParts";
import { CampoDia, CampoNumero, EscolhaSegmentada } from "@/components/financeiroGestao/CamposLancamento";
import SeletorPaginadoGestao from "@/components/financeiroGestao/SeletorPaginadoGestao";
import { useCelular } from "@/components/common/MobileSheet";
import B1Field from "@/components/cadastro/base1/B1Field";
import {
  JUSTIFICATIVA_MINIMA_OUTRA,
  LIMITES_ENTRADA,
  LOCALE_ENTRADA,
  MOTIVO_OUTRA,
  MOTIVOS_ENTRADA,
  chaveDeOperacao,
  comProduto,
  formularioVazioEntrada,
  justificativaExigida,
  mensagemErroEntrada,
  montarCorpoEntrada,
  unidadesDoProduto,
  validarFormularioEntrada,
} from "@/lib/estoqueEntradasRegras";
import { criarEntradaEstoque, listarDepositosDaEntrada, listarProdutosDaEntrada } from "@/services/estoqueEntradasService";

export const FORMULARIO_ENTRADA_ID = "formulario-entrada-estoque";

/** Área de texto Base1 (observação e justificativa). @param {{ label: string, value: string, onChange: (v: string) => void, error?: string, required?: boolean, maxLength?: number, testId?: string }} props */
function CampoTextoLongo({ label, value, onChange, error = undefined, required = false, maxLength = 500, testId = undefined }) {
  return (
    <B1Field label={label} required={required} span={12} hasValue={Boolean(String(value ?? "").trim())} error={error}>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={maxLength}
        rows={2}
        data-testid={testId}
        className="mg-input min-w-0 w-full normal-case"
      />
    </B1Field>
  );
}

/**
 * Nova entrada de estoque (D-PROD-257): UM formulário numa janela só (680px no desktop; tela cheia no celular), sem
 * assistente. Produto, depósito, quantidade, unidade, custo (zero só marcando "Custo zero"), motivo (os três
 * fechados), documento, observação e justificativa (obrigatória em "Outra" e no custo zero fora da doação). Enviar
 * grava de uma vez (o servidor confere tudo e é quem bloqueia). Um reenvio sem resposta reaproveita a mesma
 * `operation_id` (o servidor devolve o gravado, nunca duplica); mudar o conteúdo gera outra.
 * @param {{ aberto: boolean, empresaId: string, hoje: string, onFechar: () => void, onCriada: (entrada: any) => void }} props
 */
export default function JanelaNovaEntradaEstoque({ aberto, empresaId, hoje, onFechar, onCriada }) {
  const celular = useCelular();
  const [form, setForm] = useState(() => formularioVazioEntrada(hoje));
  const [erros, setErros] = useState(/** @type {Record<string, string>} */ ({}));
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState(/** @type {string|null} */ (null));
  const operacao = useRef(/** @type {{ conteudo: string, id: string } | null} */ (null));

  /** @param {Record<string, any>} mudanca @param {string[]} [limpar] */
  const mudar = (mudanca, limpar = []) => {
    setForm((f) => ({ ...f, ...mudanca }));
    if (limpar.length) setErros((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !limpar.includes(k))));
    setErroEnvio(null);
  };

  const enviar = async (/** @type {React.FormEvent} */ evento) => {
    evento.preventDefault();
    if (enviando) return;
    const { erros: achados, ok } = validarFormularioEntrada(form, hoje);
    setErros(achados);
    if (!ok) return;
    const conteudo = JSON.stringify(montarCorpoEntrada(empresaId, form, ""));
    if (!operacao.current || operacao.current.conteudo !== conteudo) operacao.current = { conteudo, id: chaveDeOperacao() };
    setEnviando(true);
    setErroEnvio(null);
    try {
      const entrada = await criarEntradaEstoque(montarCorpoEntrada(empresaId, form, operacao.current.id));
      onCriada(entrada);
    } catch (erro) {
      setErroEnvio(mensagemErroEntrada(erro, "Não foi possível lançar a entrada. Verifique a conexão e tente de novo."));
    } finally {
      setEnviando(false);
    }
  };

  const unidades = unidadesDoProduto(form.produto);
  const minimoJustificativa = justificativaExigida(form);
  const rotuloQuantidade = form.unidade === "SACO" ? "Quantidade (sacos)" : form.unidade === "L" ? "Quantidade (litros)" : "Quantidade";
  const rotuloCusto = form.unidade === "SACO" ? "Custo por saco (R$)" : form.unidade === "L" ? "Custo por litro (R$)" : "Custo por kg (R$)";
  const ajudaDoMotivo = MOTIVOS_ENTRADA.find((m) => m.value === form.motivo)?.ajuda;

  const rodape = (
    <>
      <button type="button" className="tb-btn" onClick={onFechar} disabled={enviando} data-testid="entrada-cancelar">
        Cancelar
      </button>
      <button type="submit" form={FORMULARIO_ENTRADA_ID} className="tb-btn tb-btn-green" disabled={enviando} data-testid="entrada-lancar">
        {enviando ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
        {enviando ? "Lançando…" : "Lançar entrada"}
      </button>
    </>
  );

  return (
    <B1Janela
      aberto={aberto}
      onFechar={onFechar}
      podeFechar={!enviando}
      titulo="Nova entrada de estoque"
      testId="janela-nova-entrada-estoque"
      className={celular ? "b1-janela--tela-cheia" : ""}
      contentProps={{ className: celular ? "b1-janela__camada--tela-cheia" : "" }}
      rodape={rodape}
    >
      <form id={FORMULARIO_ENTRADA_ID} onSubmit={enviar} noValidate className="mg-b1-form-grid grid grid-cols-12 gap-x-3 gap-y-2" data-testid="formulario-entrada-estoque">
        <EscolhaSegmentada
          rotulo="Motivo da entrada"
          testId="entrada-motivo"
          opcoes={MOTIVOS_ENTRADA.map((m) => ({ value: m.value, label: m.label }))}
          value={form.motivo}
          onChange={(v) => mudar({ motivo: v }, ["justificativa", "custo"])}
        />
        {ajudaDoMotivo ? <p className="col-span-12 -mt-1 text-[12px] text-[var(--mg-text-2,#475569)]">{ajudaDoMotivo}</p> : null}

        <SecaoForm titulo="Mercadoria" />
        <SeletorPaginadoGestao
          rotulo="Produto"
          testId="entrada-produto"
          chave={["estoque", "entrada-produtos", empresaId]}
          buscar={({ q, cursor, limit }) => listarProdutosDaEntrada(empresaId, { q, cursor, limit })}
          value={form.produto ? { id: form.produto.id, rotulo: form.produto.rotulo } : null}
          onChange={(o) => {
            setForm((f) => comProduto(f, o ? { id: String(o.id), rotulo: String(o.nome ?? ""), unidade_estoque: o.unidade_estoque, peso_por_saco_kg: o.peso_por_saco_kg ?? null } : null));
            setErros((e) => ({ ...e, produto: "", unidade: "" }));
          }}
          detalheDaOpcao={(o) => (o?.codigo ? String(o.codigo) : null)}
          obrigatorio
          erro={erros.produto || undefined}
          span={6}
        />
        <SeletorPaginadoGestao
          rotulo="Depósito"
          testId="entrada-deposito"
          chave={["estoque", "entrada-depositos"]}
          buscar={({ q, cursor, limit }) => listarDepositosDaEntrada({ q, cursor, limit })}
          value={form.deposito}
          onChange={(o) => mudar({ deposito: o ? { id: String(o.id), rotulo: String(o.nome ?? "") } : null }, ["deposito"])}
          obrigatorio
          erro={erros.deposito || undefined}
          span={6}
        />
        <CampoNumero
          label={rotuloQuantidade}
          value={form.quantidade}
          onChange={(v) => mudar({ quantidade: v }, ["quantidade"])}
          locale={LOCALE_ENTRADA}
          limites={LIMITES_ENTRADA}
          required
          error={erros.quantidade}
          span={4}
          testId="entrada-quantidade"
        />
        <CampoSelect
          label="Unidade"
          value={form.unidade}
          onChange={(v) => mudar({ unidade: v }, ["unidade"])}
          options={unidades}
          readOnly={unidades.length <= 1}
          required
          error={erros.unidade}
          span={4}
          placeholder={form.produto ? undefined : "Escolha o produto"}
        />
        <CampoDia label="Data da entrada" value={form.data_entrada} onChange={(v) => mudar({ data_entrada: v }, ["data_entrada"])} max={hoje} required error={erros.data_entrada} span={4} testId="entrada-data" />

        <SecaoForm titulo="Custo" />
        <CampoNumero
          label={rotuloCusto}
          value={form.custo_zero ? "" : form.custo}
          onChange={(v) => mudar({ custo: v }, ["custo"])}
          locale={LOCALE_ENTRADA}
          limites={LIMITES_ENTRADA}
          casasMin={2}
          readOnly={form.custo_zero}
          required={!form.custo_zero}
          error={erros.custo}
          span={6}
          testId="entrada-custo"
        />
        <label className="col-span-12 flex items-center gap-2 text-[13px] md:col-span-6" data-testid="entrada-custo-zero-rotulo">
          <input
            type="checkbox"
            checked={form.custo_zero}
            onChange={(e) => mudar({ custo_zero: e.target.checked, custo: "" }, ["custo", "justificativa"])}
            data-testid="entrada-custo-zero"
          />
          Custo zero (sem valor conhecido)
        </label>

        <SecaoForm titulo="Documento e motivo" />
        <CampoTexto label="Documento (opcional)" value={form.documento_numero} onChange={(v) => mudar({ documento_numero: v })} maxLength={64} span={6} keepCase />
        <CampoTextoLongo
          label={minimoJustificativa ? `Justificativa (ao menos ${minimoJustificativa} caracteres)` : "Justificativa"}
          value={form.justificativa}
          onChange={(v) => mudar({ justificativa: v }, ["justificativa"])}
          required={minimoJustificativa > 0}
          error={erros.justificativa}
          testId="entrada-justificativa"
        />
        <CampoTextoLongo label="Observação" value={form.observacao} onChange={(v) => mudar({ observacao: v })} testId="entrada-observacao" />

        {form.motivo === MOTIVO_OUTRA ? (
          <p className="col-span-12 text-[12px] text-[var(--mg-text-2,#475569)]">
            "Outra" não serve para compra, devolução, mudança de depósito nem saldo antigo (use "Saldo de implantação"); a justificativa de {JUSTIFICATIVA_MINIMA_OUTRA}+ caracteres fica registrada.
          </p>
        ) : null}
        {erroEnvio ? (
          <div className="col-span-12" role="alert" data-testid="entrada-erro">
            <AvisoGestao>{erroEnvio}</AvisoGestao>
          </div>
        ) : null}
      </form>
    </B1Janela>
  );
}
