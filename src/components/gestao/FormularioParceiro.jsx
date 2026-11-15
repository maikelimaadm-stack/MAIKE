import React, { useState } from "react";
import B1Field, { DENSIDADE_BASE1 } from "@/components/cadastro/base1/B1Field";
import B1MultiSelecao from "@/components/cadastro/base1/B1MultiSelecao";
import { B1ChaveRow } from "@/components/cadastro/base1/Base1Ui";
import CadastroFormShell from "@/components/cadastro/base1/CadastroFormShell";
import { notifyWarning } from "@/lib/maikeNotify";
import { LIMITES, lerNumeroLocal, paraTextoDeEdicao } from "@/lib/dinheiroDecimal";
import { CAMPOS_FUNCIONARIO_PARCEIRO, PAPEIS_PARCEIRO, PAPEL_FUNCIONARIO, TIPOS_FUNCIONARIO } from "@/services/parceiroService";
import { CampoSelect, CampoTexto, SecaoForm } from "@/components/gestao/GestaoFormParts";
import { CampoNumero } from "@/components/financeiroGestao/CamposLancamento";

export const FORMULARIO_PARCEIRO_ID = "formulario-parceiro-base1";

const TIPOS_PESSOA = [
  { value: "Física", label: "Pessoa física" },
  { value: "Jurídica", label: "Pessoa jurídica" },
];

const LOCALE = "pt-BR";
/** O decimal da API (custo do funcionário): até 10 inteiros e 4 casas, não negativo. */
const LIMITES_CUSTO = LIMITES.QUANTIDADE;

/**
 * Custo digitado no formato local → texto canônico (`null` = vazio).
 * @param {string} texto
 * @returns {{ valor: string|null, erro: string|null }}
 */
const lerCusto = (texto) => {
  const digitado = String(texto ?? "").trim();
  if (!digitado) return { valor: null, erro: null };
  const lida = lerNumeroLocal(digitado, LOCALE, LIMITES_CUSTO);
  if (lida.ok) return { valor: /** @type {string} */ (lida.valor), erro: null };
  if (lida.motivo === "casas") return { valor: null, erro: `Use no máximo ${LIMITES_CUSTO.casas} casas decimais.` };
  if (lida.motivo === "limite") return { valor: null, erro: "Valor acima do limite permitido." };
  return { valor: null, erro: "Valor inválido: use o formato 1.234,56 (sem sinal)." };
};

const formInicial = (d) => ({
  tipo_pessoa: d?.tipo_pessoa || "Jurídica",
  nome: d?.nome || "",
  razao_social: d?.razao_social || "",
  cpf: d?.cpf || "",
  cnpj: d?.cnpj || "",
  rg: d?.rg || "",
  data_nascimento: d?.data_nascimento || "",
  inscricao_estadual: d?.inscricao_estadual || "",
  nome_responsavel: d?.nome_responsavel || "",
  telefone: d?.telefone || "",
  email: d?.email || "",
  endereco: d?.endereco || "",
  cidade: d?.cidade || "",
  estado: d?.estado || "",
  cep: d?.cep || "",
  observacoes: d?.observacoes || "",
  papeis: Array.isArray(d?.papeis) ? [...d.papeis] : [],
  ativo: d?.ativo !== false,
  // D-PROD-208: dados do papel funcionário (só aparecem e só vão com o papel marcado).
  funcionario_tipo: d?.funcionario_tipo || "",
  funcionario_cargo: d?.funcionario_cargo || "",
  funcionario_custo_hora: paraTextoDeEdicao(d?.funcionario_custo_hora, LOCALE, { casasMax: LIMITES_CUSTO.casas }),
  funcionario_custo_diaria: paraTextoDeEdicao(d?.funcionario_custo_diaria, LOCALE, { casasMax: LIMITES_CUSTO.casas }),
});

/**
 * Formulário de Parceiro (D-PROD-146): seções Identificação, Papéis, Contato,
 * Endereço, Observações e Situação. Entrega o formulário inteiro; quem grava
 * calcula só o que mudou (PATCH mínimo). Com o papel Funcionário (D-PROD-208),
 * a seção Funcionário: tipo (obrigatório), cargo, custo por hora e por diária.
 *
 * @param {{ onSubmit: (dados: object) => void, initialData?: any, readOnly?: boolean, variant?: string }} props
 */
export default function FormularioParceiro({ onSubmit, initialData = null, readOnly = false, variant = "embedded" }) {
  const [form, setForm] = useState(() => formInicial(initialData));
  const [invalidos, setInvalidos] = useState(/** @type {string[]} */ ([]));
  const fisica = form.tipo_pessoa === "Física";
  const funcionario = form.papeis.includes(PAPEL_FUNCIONARIO);
  const [errosCusto, setErrosCusto] = useState(/** @type {Record<string, string>} */ ({}));
  const legados = Array.isArray(initialData?.tipos_legados) ? initialData.tipos_legados : [];

  const set = (campo, valor) => {
    setForm((prev) => ({ ...prev, [campo]: valor }));
    setInvalidos((prev) => prev.filter((c) => c !== campo));
    setErrosCusto((prev) => (prev[campo] ? Object.fromEntries(Object.entries(prev).filter(([k]) => k !== campo)) : prev));
  };

  /** @param {string[]} proximos papéis marcados, na ordem da lista */
  const definirPapeis = (proximos) => {
    if (readOnly) return;
    setForm((prev) => ({ ...prev, papeis: proximos }));
    setInvalidos((prev) => prev.filter((c) => c !== "papeis"));
  };

  const enviar = (e) => {
    e.preventDefault();
    if (readOnly) return;
    const faltando = [];
    if (!form.nome.trim()) faltando.push("nome");
    if (!form.tipo_pessoa) faltando.push("tipo_pessoa");
    // B4/R2: parceiro novo precisa de ao menos um papel (a API exige). Legado
    // sem papel (`tipos=[]`) segue editável enquanto ninguém mexe nos papéis.
    const papeisOriginais = Array.isArray(initialData?.papeis) ? initialData.papeis : [];
    const exigePapel = !initialData?.id || papeisOriginais.length > 0;
    if (exigePapel && !form.papeis.length) faltando.push("papeis");
    if (funcionario && !form.funcionario_tipo) faltando.push("funcionario_tipo");
    if (faltando.length) {
      setInvalidos(faltando);
      /** @type {Record<string, string>} */
      const rotulos = { papeis: "Papéis (ao menos um)", nome: "Nome", tipo_pessoa: "Tipo de pessoa", funcionario_tipo: "Tipo do funcionário" };
      notifyWarning("Atenção", `Preencha o campo obrigatório: ${faltando.map((c) => rotulos[c]).join(", ")}.`);
      return;
    }
    const hora = lerCusto(funcionario ? form.funcionario_custo_hora : "");
    const diaria = lerCusto(funcionario ? form.funcionario_custo_diaria : "");
    if (hora.erro || diaria.erro) {
      setErrosCusto({ ...(hora.erro ? { funcionario_custo_hora: hora.erro } : {}), ...(diaria.erro ? { funcionario_custo_diaria: diaria.erro } : {}) });
      notifyWarning("Atenção", "Confira os custos do funcionário.");
      return;
    }
    const papeisOrdenados = PAPEIS_PARCEIRO.map((p) => p.id).filter((id) => form.papeis.includes(id));
    /** @type {Record<string, any>} */
    const dados = { ...form, nome: form.nome.trim().toUpperCase(), papeis: papeisOrdenados };
    // Campos que não pertencem ao tipo de pessoa não são enviados (nem apagados).
    if (fisica) {
      delete dados.razao_social;
      delete dados.cnpj;
      delete dados.inscricao_estadual;
    } else {
      delete dados.cpf;
      delete dados.rg;
      delete dados.data_nascimento;
    }
    if (dados.estado) dados.estado = String(dados.estado).trim().toUpperCase();
    // Sem o papel Funcionário os dados dele não vão (o servidor os limpa ao desmarcar o papel).
    if (funcionario) {
      dados.funcionario_cargo = form.funcionario_cargo.trim().toUpperCase() || null;
      dados.funcionario_custo_hora = hora.valor;
      dados.funcionario_custo_diaria = diaria.valor;
    } else {
      for (const campo of CAMPOS_FUNCIONARIO_PARCEIRO) delete dados[campo];
    }
    onSubmit(dados);
  };

  return (
    <CadastroFormShell embedded={variant === "embedded"} title={initialData?.id ? "Editar parceiro" : "Novo parceiro"}>
      <div className="mg-b1-record-form">
        <form id={FORMULARIO_PARCEIRO_ID} onSubmit={enviar} className="b1 mg-b1-form-grid w-full min-h-0" noValidate data-testid="b1-form" data-densidade={DENSIDADE_BASE1}>
          <SecaoForm titulo="Identificação" />
          <CampoSelect label="Tipo de pessoa" required span={4} value={form.tipo_pessoa} onChange={(v) => set("tipo_pessoa", v)} options={TIPOS_PESSOA} readOnly={readOnly} />
          <CampoTexto label="Nome" required span={8} value={form.nome} onChange={(v) => set("nome", v)} readOnly={readOnly} maxLength={255} error={invalidos.includes("nome") ? "Obrigatório" : undefined} placeholder="NOME DO PARCEIRO" />
          {fisica ? (
            <>
              <CampoTexto label="CPF" span={4} value={form.cpf} onChange={(v) => set("cpf", v)} readOnly={readOnly} inputMode="numeric" maxLength={32} />
              <CampoTexto label="RG" span={4} value={form.rg} onChange={(v) => set("rg", v)} readOnly={readOnly} maxLength={32} />
              <CampoTexto label="Data de nascimento" span={4} type="date" value={form.data_nascimento} onChange={(v) => set("data_nascimento", v)} readOnly={readOnly} />
            </>
          ) : (
            <>
              <CampoTexto label="Razão social" span={8} value={form.razao_social} onChange={(v) => set("razao_social", v)} readOnly={readOnly} maxLength={255} />
              <CampoTexto label="CNPJ" span={4} value={form.cnpj} onChange={(v) => set("cnpj", v)} readOnly={readOnly} inputMode="numeric" maxLength={32} />
              <CampoTexto label="Inscrição estadual" span={4} value={form.inscricao_estadual} onChange={(v) => set("inscricao_estadual", v)} readOnly={readOnly} maxLength={64} />
            </>
          )}

          <SecaoForm titulo="Papéis" />
          {/* Marcar vários (D-PROD-168): a mesma lista do Sistema Produtivo, com a caixa de marcar à direita. */}
          <B1Field label="Papéis do parceiro" span={12} hasValue={form.papeis.length > 0} disabled={readOnly} required={!initialData?.id || (Array.isArray(initialData?.papeis) && initialData.papeis.length > 0)}>
            <B1MultiSelecao
              rotulo="Papéis do parceiro"
              opcoes={PAPEIS_PARCEIRO.map((p) => ({ value: p.id, label: p.label }))}
              valor={form.papeis}
              onChange={definirPapeis}
              disabled={readOnly}
            />
          </B1Field>
          <div className="col-span-12">
            {invalidos.includes("papeis") ? (
              <p className="mt-1 text-[11px] text-red-700" role="alert" data-testid="parceiro-papeis-obrigatorio">
                Escolha ao menos um papel (fornecedor, cliente, prestador de serviço, transportador, funcionário ou outros).
              </p>
            ) : null}
            {legados.length ? (
              <p className="mt-1 text-[11px] text-[var(--mg-text-2,#475569)]" data-testid="parceiro-papeis-legados">
                Papéis antigos preservados: {legados.join(", ")}
              </p>
            ) : null}
          </div>

          {funcionario ? (
            <>
              <SecaoForm titulo="Funcionário" />
              <CampoSelect
                label="Tipo do funcionário"
                required
                span={4}
                value={form.funcionario_tipo}
                onChange={(v) => set("funcionario_tipo", v)}
                options={[...TIPOS_FUNCIONARIO]}
                readOnly={readOnly}
                error={invalidos.includes("funcionario_tipo") ? "Obrigatório" : undefined}
              />
              <CampoTexto label="Cargo" span={8} value={form.funcionario_cargo} onChange={(v) => set("funcionario_cargo", v)} readOnly={readOnly} maxLength={120} placeholder="EX.: TRATORISTA" />
              <CampoNumero
                label="Custo por hora (R$)"
                value={form.funcionario_custo_hora}
                onChange={(v) => set("funcionario_custo_hora", v)}
                locale={LOCALE}
                limites={LIMITES_CUSTO}
                readOnly={readOnly}
                span={4}
                error={errosCusto.funcionario_custo_hora}
                testId="parceiro-funcionario-custo-hora"
              />
              <CampoNumero
                label="Custo por diária (R$)"
                value={form.funcionario_custo_diaria}
                onChange={(v) => set("funcionario_custo_diaria", v)}
                locale={LOCALE}
                limites={LIMITES_CUSTO}
                readOnly={readOnly}
                span={4}
                error={errosCusto.funcionario_custo_diaria}
                testId="parceiro-funcionario-custo-diaria"
              />
            </>
          ) : null}

          <SecaoForm titulo="Contato" />
          <CampoTexto label="Telefone" span={4} value={form.telefone} onChange={(v) => set("telefone", v)} readOnly={readOnly} inputMode="tel" maxLength={64} />
          <CampoTexto label="E-mail" span={4} type="email" keepCase value={form.email} onChange={(v) => set("email", v)} readOnly={readOnly} maxLength={255} />
          <CampoTexto label="Responsável" span={4} value={form.nome_responsavel} onChange={(v) => set("nome_responsavel", v)} readOnly={readOnly} maxLength={255} />

          <SecaoForm titulo="Endereço" />
          <CampoTexto label="Endereço" span={5} value={form.endereco} onChange={(v) => set("endereco", v)} readOnly={readOnly} maxLength={255} />
          <CampoTexto label="Cidade" span={3} value={form.cidade} onChange={(v) => set("cidade", v)} readOnly={readOnly} maxLength={128} />
          <CampoTexto label="Estado" span={2} value={form.estado} onChange={(v) => set("estado", v)} readOnly={readOnly} maxLength={2} />
          <CampoTexto label="CEP" span={2} value={form.cep} onChange={(v) => set("cep", v)} readOnly={readOnly} inputMode="numeric" maxLength={16} />

          <SecaoForm titulo="Observações" />
          <CampoTexto label="Observações" span={12} value={form.observacoes} onChange={(v) => set("observacoes", v)} readOnly={readOnly} maxLength={2000} />

          {initialData?.id ? (
            <>
              <SecaoForm titulo="Situação" />
              <B1ChaveRow label="Ativo" span={6} checked={form.ativo} onChange={readOnly ? undefined : (v) => set("ativo", v)} disabled={readOnly} ariaLabel="Parceiro ativo" />
            </>
          ) : null}
        </form>
      </div>
    </CadastroFormShell>
  );
}
