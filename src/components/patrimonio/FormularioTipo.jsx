import React, { useState } from "react";
import CadastroFormShell from "@/components/cadastro/base1/CadastroFormShell";
import { notifyWarning } from "@/lib/maikeNotify";
import { AvisoGestao, CampoSelect, CampoTexto } from "@/components/gestao/GestaoFormParts";
import { NATUREZAS_PATRIMONIO, ROTULO_NATUREZA, ehNatureza } from "@/lib/patrimonioDominio";

export const FORMULARIO_TIPO_ID = "formulario-tipo-patrimonial-base1";

/** Opções do "Tipo de bem" (a lista FIXA de natureza, D-PROD-163). */
export const OPCOES_TIPO_DE_BEM = NATUREZAS_PATRIMONIO.map((n) => ({ value: n, label: ROTULO_NATUREZA[n] }));

/**
 * Formulário do NOVO tipo (D-PROD-163): "Tipo de bem" (a natureza, lista fixa)
 * e Nome. O servidor põe o tipo na família padrão do Tipo de bem e gera o
 * código a partir do nome (P-05): ninguém cadastra família.
 *  - `naturezaFixa`: o Tipo de bem vem travado, só leitura (o "+ Novo tipo" do
 *    formulário do Bem cria o tipo no Tipo de bem escolhido no bem);
 *  - sem ela, o Tipo de bem é escolhido aqui (o "+ Novo tipo" do "Gerenciar
 *    tipos"), começando por `naturezaInicial`.
 * Renomear é na própria lista do "Gerenciar tipos" (PATCH com `versao`).
 *
 * @param {{
 *   onSubmit: (dados: { natureza: string, nome: string }) => void,
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
    if (Object.keys(novos).length) {
      setErros(novos);
      notifyWarning("Atenção", "Revise os campos destacados.");
      return;
    }
    onSubmit({ natureza, nome: nome.trim() });
  };

  const rotuloNatureza = /** @type {Record<string, string>} */ (ROTULO_NATUREZA)[natureza] ?? "";

  return (
    <CadastroFormShell embedded title="Novo tipo">
      <div className="mg-b1-record-form">
        <form id={formId} onSubmit={enviar} className="b1 mg-b1-form-grid w-full min-h-0" noValidate data-testid="tipo-form">
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
