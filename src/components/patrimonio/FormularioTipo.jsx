import React, { useState } from "react";
import { DENSIDADE_BASE1 } from "@/components/cadastro/base1/B1Field";
import CadastroFormShell from "@/components/cadastro/base1/CadastroFormShell";
import { notifyWarning } from "@/lib/maikeNotify";
import { AvisoGestao, CampoSelect, CampoTexto } from "@/components/gestao/GestaoFormParts";
import { CampoNumero, EscolhaSegmentada } from "@/components/financeiroGestao/CamposLancamento";
import { LIMITES_BEM, LOCALE_BEM, lerDecimal, usaCustoDeUso } from "@/components/patrimonio/bemFormulario";
import { NATUREZAS_PATRIMONIO, ROTULO_NATUREZA, ehNatureza } from "@/lib/patrimonioDominio";
import { comparar } from "@/lib/dinheiroDecimal";

export const FORMULARIO_TIPO_ID = "formulario-tipo-patrimonial-base1";

/** Opções do "Tipo de bem" (a lista FIXA de natureza, D-PROD-169). */
export const OPCOES_TIPO_DE_BEM = NATUREZAS_PATRIMONIO.map((n) => ({ value: n, label: ROTULO_NATUREZA[n] }));

/** D-PROD-279 — o produto do implemento: opções e limites (o servidor confere de novo). */
export const OPCOES_USA_PRODUTO = [{ value: "SIM", label: "Sim" }, { value: "NAO", label: "Não" }];
export const OPCOES_FORMA_PRODUTO = [{ value: "JATO", label: "Por jato (tanque)" }];
export const OPCOES_UNIDADE_CAPACIDADE = [{ value: "L", label: "L" }, { value: "KG", label: "kg" }];
const LIMITES_CAPACIDADE = Object.freeze({ casas: 4, inteiros: 6 });
const CAPACIDADE_MAXIMA = "100000";

/**
 * Formulário do NOVO tipo (D-PROD-169): "Tipo de bem" (a natureza, lista fixa)
 * e Nome. O servidor põe o tipo na família padrão do Tipo de bem e gera o
 * código a partir do nome (P-05): ninguém cadastra família.
 *  - `naturezaFixa`: o Tipo de bem vem travado, só leitura (o "+ Novo tipo" do
 *    formulário do Bem cria o tipo no Tipo de bem escolhido no bem);
 *  - sem ela, o Tipo de bem é escolhido aqui (o "+ Novo tipo" do "Gerenciar
 *    tipos"), começando por `naturezaInicial`.
 * Renomear é na própria lista do "Gerenciar tipos" (PATCH com `versao`).
 * D-PROD-202: tipo de máquina, veículo ou equipamento leva o "Teto de salto do
 * medidor" (opcional): acima dele, a linha de máquina do Lançamento de
 * Atividades pede justificativa. Vai como texto decimal canônico, ou `null`.
 * D-PROD-279: tipo de IMPLEMENTO diz se usa produto ("a máquina sozinha não
 * leva produto; quem leva é o implemento"). Com Sim: como conta (por jato), a
 * capacidade do jato (> 0, até 100.000, até 4 casas) e a unidade (L | kg).
 * Outro Tipo de bem não manda esses campos.
 *
 * @param {{
 *   onSubmit: (dados: { natureza: string, nome: string, salto_maximo_medidor: string|null, usa_produto?: boolean,
 *     forma_produto?: string|null, capacidade?: string|null, capacidade_unidade?: string|null }) => void,
 *   initialData?: { nome?: string } | null,
 *   naturezaFixa?: string|null,
 *   naturezaInicial?: string|null,
 *   formId?: string,
 * }} props
 */
export default function FormularioTipo({ onSubmit, initialData = null, naturezaFixa = null, naturezaInicial = null, formId = FORMULARIO_TIPO_ID }) {
  const travada = ehNatureza(naturezaFixa);
  const [natureza, setNatureza] = useState(() => (travada ? String(naturezaFixa) : ehNatureza(naturezaInicial) ? String(naturezaInicial) : ""));
  const [nome, setNome] = useState(() => String(initialData?.nome ?? ""));
  const [salto, setSalto] = useState("");
  const [usaProduto, setUsaProduto] = useState("NAO");
  const [forma, setForma] = useState("JATO");
  const [capacidade, setCapacidade] = useState("");
  const [unidade, setUnidade] = useState("L");
  const ehImplemento = natureza === "IMPLEMENTO";
  const comProduto = ehImplemento && usaProduto === "SIM";
  const [erros, setErros] = useState(/** @type {Record<string, string>} */ ({}));

  /** @param {React.FormEvent} e */
  const enviar = (e) => {
    e.preventDefault();
    // O formulário pode abrir por cima de outro (cadastro rápido): o envio não sobe.
    e.stopPropagation();
    /** @type {Record<string, string>} */
    const novos = {};
    if (!ehNatureza(natureza)) novos.natureza = "Escolha o tipo de bem";
    if (!nome.trim()) novos.nome = "Obrigatório";
    const teto = usaCustoDeUso(natureza) ? lerDecimal(salto, LIMITES_BEM.MEDIDA) : { ok: true, valor: null };
    if (!teto.ok) novos.salto_maximo_medidor = "Zero ou mais, até 4 casas decimais";
    const cap = /** @type {{ ok: boolean, valor?: string|null }} */ (comProduto ? lerDecimal(capacidade, LIMITES_CAPACIDADE) : { ok: true, valor: null });
    if (comProduto) {
      if (!forma) novos.forma_produto = "Obrigatório";
      if (!cap.ok || cap.valor === null || comparar(cap.valor, "0") <= 0 || comparar(cap.valor, CAPACIDADE_MAXIMA) > 0) {
        novos.capacidade = "Maior que zero, até 100.000, até 4 casas decimais";
      }
      if (!unidade) novos.capacidade_unidade = "Obrigatório";
    }
    if (Object.keys(novos).length) {
      setErros(novos);
      notifyWarning("Atenção", "Revise os campos destacados.");
      return;
    }
    const produto = !ehImplemento
      ? {}
      : comProduto
        ? { usa_produto: true, forma_produto: forma, capacidade: cap.valor, capacidade_unidade: unidade }
        : { usa_produto: false };
    onSubmit({ natureza, nome: nome.trim(), salto_maximo_medidor: teto.ok ? teto.valor : null, ...produto });
  };

  const rotuloNatureza = /** @type {Record<string, string>} */ (ROTULO_NATUREZA)[natureza] ?? "";

  return (
    <CadastroFormShell embedded title="Novo tipo">
      <div className="mg-b1-record-form">
        <form id={formId} onSubmit={enviar} className="b1 mg-b1-form-grid w-full min-h-0" noValidate data-testid="tipo-form" data-densidade={DENSIDADE_BASE1}>
          {travada ? (
            <CampoTexto label="Tipo de bem" span={12} value={rotuloNatureza} onChange={() => {}} readOnly />
          ) : (
            <CampoSelect
              label="Tipo de bem"
              required
              span={12}
              value={natureza}
              onChange={(v) => {
                setNatureza(v);
                setErros((x) => ({ ...x, natureza: "" }));
              }}
              options={OPCOES_TIPO_DE_BEM}
              placeholder="— Escolha o tipo de bem —"
              error={erros.natureza || undefined}
            />
          )}
          <CampoTexto
            label="Nome"
            required
            span={12}
            value={nome}
            onChange={(v) => {
              setNome(v);
              setErros((x) => ({ ...x, nome: "" }));
            }}
            maxLength={120}
            error={erros.nome || undefined}
            placeholder="EX.: TRATOR DE PNEUS"
          />
          {usaCustoDeUso(natureza) ? (
            <CampoNumero
              label="Teto de salto do medidor"
              value={salto}
              onChange={(v) => {
                setSalto(v);
                setErros((x) => ({ ...x, salto_maximo_medidor: "" }));
              }}
              locale={LOCALE_BEM}
              limites={LIMITES_BEM.MEDIDA}
              span={12}
              error={erros.salto_maximo_medidor || null}
              testId="tipo-salto-maximo"
            />
          ) : null}
          {ehImplemento ? (
            <>
              <EscolhaSegmentada rotulo="Usa produto?" opcoes={OPCOES_USA_PRODUTO} value={usaProduto} onChange={setUsaProduto} testId="tipo-usa-produto" />
              {comProduto ? (
                <>
                  <CampoSelect
                    label="Como conta"
                    required
                    span={12}
                    value={forma}
                    onChange={(v) => {
                      setForma(v);
                      setErros((x) => ({ ...x, forma_produto: "" }));
                    }}
                    options={OPCOES_FORMA_PRODUTO}
                    error={erros.forma_produto || undefined}
                  />
                  <CampoNumero
                    label="Capacidade do jato"
                    required
                    value={capacidade}
                    onChange={(v) => {
                      setCapacidade(v);
                      setErros((x) => ({ ...x, capacidade: "" }));
                    }}
                    locale={LOCALE_BEM}
                    limites={LIMITES_CAPACIDADE}
                    span={6}
                    error={erros.capacidade || null}
                    testId="tipo-capacidade"
                  />
                  <EscolhaSegmentada rotulo="Unidade" opcoes={OPCOES_UNIDADE_CAPACIDADE} value={unidade} onChange={setUnidade} span={6} testId="tipo-capacidade-unidade" />
                </>
              ) : null}
              <p className="col-span-12 text-[12px] text-[var(--mg-text-2,#475569)]" data-testid="tipo-produto-dica">
                Ex.: pulverizador 2.000 L. A grade não usa produto.
              </p>
            </>
          ) : null}
          <div className="col-span-12">
            <AvisoGestao tone="blue" testId="tipo-nota-tipo-de-bem">
              O tipo fica no Tipo de bem escolhido{travada ? " (o deste bem)" : ""} e não muda de Tipo de bem depois de criado. O nome pode ser trocado em “⋯ › Gerenciar tipos”.
            </AvisoGestao>
          </div>
        </form>
      </div>
    </CadastroFormShell>
  );
}
