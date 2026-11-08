import React, { useState } from "react";
import { B1ChaveRow } from "@/components/cadastro/base1/Base1Ui";
import CadastroFormShell from "@/components/cadastro/base1/CadastroFormShell";
import { notifyWarning } from "@/lib/maikeNotify";
import { AvisoGestao, CampoSelect, CampoTexto, SecaoForm } from "@/components/gestao/GestaoFormParts";
import SeletorPaiNatureza from "@/components/gestao/SeletorPaiNatureza";
import { ROTULO_TIPO_NATUREZA, caminhoDoPai, ehTipoNatureza } from "@/services/naturezaFinanceiraService";

export const FORMULARIO_NATUREZA_ID = "formulario-natureza-financeira-base1";

const OPCOES_TIPO = [
  { value: "DESPESA", label: ROTULO_TIPO_NATUREZA.DESPESA },
  { value: "RECEITA", label: ROTULO_TIPO_NATUREZA.RECEITA },
];

/**
 * Formulário da Natureza Financeira gerencial (D-PROD-152).
 *  - criação: Receita ou Despesa escolhido EXPLICITAMENTE (sem padrão);
 *    trocar o tipo limpa o pai escolhido;
 *  - edição: tipo fixo (só leitura; o servidor não aceita mudar), pai editável;
 *  - pai por seletor paginado no servidor, só do mesmo tipo.
 *
 * @param {{
 *   empresaId: string|null,
 *   onSubmit: (dados: object) => void,
 *   initialData?: any,
 *   readOnly?: boolean,
 * }} props
 */
export default function FormularioNatureza({ empresaId, onSubmit, initialData = null, readOnly = false }) {
  const editando = Boolean(initialData?.id);
  const [form, setForm] = useState(() => ({
    tipo: ehTipoNatureza(initialData?.tipo) ? initialData.tipo : "",
    nome: initialData?.nome || "",
    descricao: initialData?.descricao || "",
    pai: initialData?.pai_id ? { id: String(initialData.pai_id), rotulo: caminhoDoPai(initialData) || "Pai atual" } : null,
    ativo: initialData?.ativo !== false,
  }));
  const [erros, setErros] = useState(/** @type {{ tipo?: boolean, nome?: boolean }} */ ({}));

  const set = (campo, valor) => setForm((prev) => ({ ...prev, [campo]: valor }));

  const trocarTipo = (tipo) => {
    // Pai precisa ser do mesmo tipo: trocar o tipo apaga a escolha anterior.
    setForm((prev) => (prev.tipo === tipo ? prev : { ...prev, tipo, pai: null }));
    setErros((e) => ({ ...e, tipo: false }));
  };

  const enviar = (e) => {
    e.preventDefault();
    if (readOnly) return;
    const faltando = { tipo: !editando && !ehTipoNatureza(form.tipo), nome: !form.nome.trim() };
    if (faltando.tipo || faltando.nome) {
      setErros(faltando);
      const nomes = [faltando.tipo ? "Tipo (Receita ou Despesa)" : null, faltando.nome ? "Nome" : null].filter(Boolean).join(", ");
      notifyWarning("Atenção", `Preencha o campo obrigatório: ${nomes}.`);
      return;
    }
    const comum = { nome: form.nome.trim().toUpperCase(), descricao: form.descricao, pai_id: form.pai?.id ?? null };
    onSubmit(editando ? { ...comum, ativo: form.ativo } : { tipo: form.tipo, ...comum });
  };

  return (
    <CadastroFormShell embedded title={editando ? "Editar natureza financeira" : "Nova natureza financeira"}>
      <div className="mg-b1-record-form">
        <form id={FORMULARIO_NATUREZA_ID} onSubmit={enviar} className="b1 mg-b1-form-grid w-full min-h-0" noValidate data-testid="b1-form">
          <SecaoForm titulo="Identificação" />
          {editando ? (
            <CampoTexto label="Tipo" span={6} value={ROTULO_TIPO_NATUREZA[form.tipo] || ""} onChange={() => {}} readOnly />
          ) : (
            <CampoSelect
              label="Tipo"
              required
              span={6}
              value={form.tipo}
              onChange={trocarTipo}
              options={OPCOES_TIPO}
              readOnly={readOnly}
              placeholder="— Escolha Receita ou Despesa —"
              error={erros.tipo ? "Obrigatório: escolha Receita ou Despesa" : undefined}
            />
          )}
          <CampoTexto
            label="Nome"
            required
            span={6}
            value={form.nome}
            onChange={(v) => {
              set("nome", v);
              setErros((x) => ({ ...x, nome: false }));
            }}
            readOnly={readOnly}
            maxLength={120}
            error={erros.nome ? "Obrigatório" : undefined}
            placeholder="NOME"
          />
          <SeletorPaiNatureza
            empresaId={empresaId}
            tipo={ehTipoNatureza(form.tipo) ? form.tipo : null}
            excluirId={editando ? String(initialData.id) : null}
            value={form.pai}
            onChange={(pai) => set("pai", pai)}
            readOnly={readOnly}
            span={12}
          />
          <CampoTexto label="Descrição" span={12} value={form.descricao} onChange={(v) => set("descricao", v)} readOnly={readOnly} maxLength={500} />
          {editando ? (
            <>
              <SecaoForm titulo="Situação" />
              <B1ChaveRow
                label="Ativo"
                span={6}
                checked={form.ativo}
                onChange={readOnly ? undefined : (v) => set("ativo", v)}
                disabled={readOnly}
                ariaLabel="Natureza financeira ativa"
              />
            </>
          ) : null}
          <div className="col-span-12">
            <AvisoGestao tone="blue" testId="natureza-nota-etapas">
              Natureza financeira é um catálogo gerencial (não é plano de contas e não gera lançamento). A associação com Parceiros,
              Centros e operações será feita nas próximas etapas.
            </AvisoGestao>
          </div>
        </form>
      </div>
    </CadastroFormShell>
  );
}
