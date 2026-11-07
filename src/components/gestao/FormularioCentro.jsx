import React, { useMemo, useState } from "react";
import { B1ChaveRow } from "@/components/cadastro/base1/Base1Ui";
import CadastroFormShell from "@/components/cadastro/base1/CadastroFormShell";
import { notifyWarning } from "@/lib/maikeNotify";
import { CampoSelect, CampoTexto, SecaoForm } from "@/components/gestao/GestaoFormParts";

/**
 * Formulário de Centro de Custo / Centro de Resultado (D-PROD-145): nome,
 * descrição, pai (hierarquia opcional) e situação. As opções de pai já chegam
 * sem o próprio nó e sem os descendentes; o servidor também barra ciclo.
 *
 * @param {{
 *   formId: string,
 *   rotulo: string,
 *   onSubmit: (dados: object) => void,
 *   initialData?: any,
 *   readOnly?: boolean,
 *   opcoesPai: Array<{ id: string, caminho?: string, nome: string }>,
 *   carregandoPais?: boolean,
 * }} props
 */
export default function FormularioCentro({ formId, rotulo, onSubmit, initialData = null, readOnly = false, opcoesPai, carregandoPais = false }) {
  const [form, setForm] = useState(() => ({
    nome: initialData?.nome || "",
    descricao: initialData?.descricao || "",
    pai_id: initialData?.pai_id || "",
    ativo: initialData?.ativo !== false,
  }));
  const [erroNome, setErroNome] = useState(false);

  const opcoes = useMemo(() => {
    const lista = (opcoesPai ?? []).map((o) => ({ value: o.id, label: o.caminho || o.nome }));
    // Pai atual fora das opções (ex.: inativo): continua exibido; só não é oferecido a outros.
    if (initialData?.pai_id && !lista.some((o) => o.value === initialData.pai_id)) {
      lista.unshift({ value: initialData.pai_id, label: `${initialData.pai_nome || "Pai atual"} (atual)` });
    }
    return lista;
  }, [opcoesPai, initialData]);

  const set = (campo, valor) => setForm((prev) => ({ ...prev, [campo]: valor }));

  const enviar = (e) => {
    e.preventDefault();
    if (readOnly) return;
    if (!form.nome.trim()) {
      setErroNome(true);
      notifyWarning("Atenção", "Preencha o campo obrigatório: Nome.");
      return;
    }
    onSubmit({
      nome: form.nome.trim().toUpperCase(),
      descricao: form.descricao,
      pai_id: form.pai_id || null,
      ...(initialData?.id ? { ativo: form.ativo } : {}),
    });
  };

  return (
    <CadastroFormShell embedded title={initialData?.id ? `Editar ${rotulo}` : `Novo ${rotulo}`}>
      <div className="mg-b1-record-form">
        <form id={formId} onSubmit={enviar} className="b1 mg-b1-form-grid w-full min-h-0" noValidate data-testid="b1-form">
          <SecaoForm titulo="Identificação" />
          <CampoTexto
            label="Nome"
            required
            span={6}
            value={form.nome}
            onChange={(v) => {
              set("nome", v);
              setErroNome(false);
            }}
            readOnly={readOnly}
            maxLength={120}
            error={erroNome ? "Obrigatório" : undefined}
            placeholder="NOME"
          />
          <CampoSelect
            label={carregandoPais ? "Centro pai (carregando…)" : "Centro pai"}
            span={6}
            value={form.pai_id}
            onChange={(v) => set("pai_id", v)}
            options={opcoes}
            readOnly={readOnly}
            placeholder="— Nenhum (raiz) —"
          />
          <CampoTexto label="Descrição" span={12} value={form.descricao} onChange={(v) => set("descricao", v)} readOnly={readOnly} maxLength={500} />
          {initialData?.id ? (
            <>
              <SecaoForm titulo="Situação" />
              <B1ChaveRow label="Ativo" span={6} checked={form.ativo} onChange={readOnly ? undefined : (v) => set("ativo", v)} disabled={readOnly} ariaLabel={`${rotulo} ativo`} />
            </>
          ) : null}
        </form>
      </div>
    </CadastroFormShell>
  );
}
