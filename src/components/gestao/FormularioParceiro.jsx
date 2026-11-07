import React, { useState } from "react";
import { B1ChaveRow } from "@/components/cadastro/base1/Base1Ui";
import CadastroFormShell from "@/components/cadastro/base1/CadastroFormShell";
import { notifyWarning } from "@/lib/maikeNotify";
import { PAPEIS_PARCEIRO } from "@/services/parceiroService";
import { CampoSelect, CampoTexto, SecaoForm } from "@/components/gestao/GestaoFormParts";

export const FORMULARIO_PARCEIRO_ID = "formulario-parceiro-base1";

const TIPOS_PESSOA = [
  { value: "Física", label: "Pessoa física" },
  { value: "Jurídica", label: "Pessoa jurídica" },
];

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
});

/**
 * Formulário de Parceiro (D-PROD-145): seções Identificação, Papéis, Contato,
 * Endereço, Observações e Situação. Entrega o formulário inteiro; quem grava
 * calcula só o que mudou (PATCH mínimo).
 *
 * @param {{ onSubmit: (dados: object) => void, initialData?: any, readOnly?: boolean, variant?: string }} props
 */
export default function FormularioParceiro({ onSubmit, initialData = null, readOnly = false, variant = "embedded" }) {
  const [form, setForm] = useState(() => formInicial(initialData));
  const [invalidos, setInvalidos] = useState(/** @type {string[]} */ ([]));
  const fisica = form.tipo_pessoa === "Física";
  const legados = Array.isArray(initialData?.tipos_legados) ? initialData.tipos_legados : [];

  const set = (campo, valor) => {
    setForm((prev) => ({ ...prev, [campo]: valor }));
    setInvalidos((prev) => prev.filter((c) => c !== campo));
  };

  const alternarPapel = (id) => {
    if (readOnly) return;
    setForm((prev) => ({
      ...prev,
      papeis: prev.papeis.includes(id) ? prev.papeis.filter((p) => p !== id) : [...prev.papeis, id],
    }));
  };

  const enviar = (e) => {
    e.preventDefault();
    if (readOnly) return;
    const faltando = [];
    if (!form.nome.trim()) faltando.push("nome");
    if (!form.tipo_pessoa) faltando.push("tipo_pessoa");
    if (faltando.length) {
      setInvalidos(faltando);
      notifyWarning("Atenção", "Preencha o campo obrigatório: Nome.");
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
    onSubmit(dados);
  };

  return (
    <CadastroFormShell embedded={variant === "embedded"} title={initialData?.id ? "Editar parceiro" : "Novo parceiro"}>
      <div className="mg-b1-record-form">
        <form id={FORMULARIO_PARCEIRO_ID} onSubmit={enviar} className="b1 mg-b1-form-grid w-full min-h-0" noValidate data-testid="b1-form">
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
          <div className="col-span-12">
            <div className="b1-multi" role="group" aria-label="Papéis do parceiro">
              {PAPEIS_PARCEIRO.map((p) => {
                const on = form.papeis.includes(p.id);
                return (
                  <button key={p.id} type="button" role="checkbox" aria-checked={on} disabled={readOnly} onClick={() => alternarPapel(p.id)} className={`b1-multi__op${on ? " is-on" : ""}`}>
                    {on ? (
                      <svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
                        <path d="M2 6l3 3 5-6" />
                      </svg>
                    ) : null}
                    {p.label}
                  </button>
                );
              })}
            </div>
            {legados.length ? (
              <p className="mt-1 text-[11px] text-[var(--mg-text-2,#475569)]" data-testid="parceiro-papeis-legados">
                Papéis antigos preservados: {legados.join(", ")}
              </p>
            ) : null}
          </div>

          <SecaoForm titulo="Contato" />
          <CampoTexto label="Telefone" span={4} value={form.telefone} onChange={(v) => set("telefone", v)} readOnly={readOnly} inputMode="tel" maxLength={64} />
          <CampoTexto label="E-mail" span={4} type="email" keepCase value={form.email} onChange={(v) => set("email", v)} readOnly={readOnly} maxLength={255} />
          <CampoTexto label="Responsável" span={4} value={form.nome_responsavel} onChange={(v) => set("nome_responsavel", v)} readOnly={readOnly} maxLength={255} />

          <SecaoForm titulo="Endereço" />
          <CampoTexto label="Endereço" span={6} value={form.endereco} onChange={(v) => set("endereco", v)} readOnly={readOnly} maxLength={255} />
          <CampoTexto label="Cidade" span={3} value={form.cidade} onChange={(v) => set("cidade", v)} readOnly={readOnly} maxLength={128} />
          <CampoTexto label="Estado" span={1} value={form.estado} onChange={(v) => set("estado", v)} readOnly={readOnly} maxLength={2} />
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
