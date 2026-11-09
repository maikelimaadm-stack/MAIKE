import React, { useState } from "react";
import CadastroFormShell from "@/components/cadastro/base1/CadastroFormShell";
import { notifyWarning } from "@/lib/maikeNotify";
import { AvisoGestao, CampoSelect, CampoTexto, SecaoForm } from "@/components/gestao/GestaoFormParts";
import { lerInteiro, normalizarCodigoCatalogo, textoDoInteiro } from "@/components/patrimonio/PatrimonioFormParts";
import { NATUREZAS_PATRIMONIO, ROTULO_NATUREZA, ehNatureza } from "@/lib/patrimonioDominio";
import { PADRAO_CODIGO_CATALOGO } from "@/services/patrimonioCatalogoService";

export const FORMULARIO_FAMILIA_ID = "formulario-familia-patrimonial-base1";

const OPCOES_NATUREZA = NATUREZAS_PATRIMONIO.map((n) => ({ value: n, label: ROTULO_NATUREZA[n] }));

/**
 * Formulário da Família Patrimonial (D-PROD-156).
 *  - criação: código, nome e NATUREZA escolhidos explicitamente;
 *  - edição: código e natureza só leitura (imutáveis no servidor);
 *  - sem chave Ativo: inativar/reativar é ação própria da tela.
 *
 * @param {{ onSubmit: (dados: object) => void, initialData?: any, readOnly?: boolean }} props
 */
export default function FormularioFamilia({ onSubmit, initialData = null, readOnly = false }) {
  const editando = Boolean(initialData?.id);
  const [form, setForm] = useState(() => ({
    // Duplicar começa sem código: o código é único no tenant.
    codigo: editando ? String(initialData.codigo ?? "") : "",
    nome: initialData?.nome || "",
    natureza: ehNatureza(initialData?.natureza) ? initialData.natureza : "",
    ordem: textoDoInteiro(initialData?.ordem),
    vida: textoDoInteiro(initialData?.vida_util_meses_padrao),
    descricao: initialData?.descricao || "",
  }));
  const [erros, setErros] = useState(/** @type {Record<string, string>} */ ({}));

  const set = (campo, valor) => {
    setForm((prev) => ({ ...prev, [campo]: valor }));
    setErros((e) => ({ ...e, [campo]: "" }));
  };

  const enviar = (e) => {
    e.preventDefault();
    if (readOnly) return;
    const codigo = normalizarCodigoCatalogo(form.codigo);
    const ordem = lerInteiro(form.ordem, { min: 0, max: 9999 });
    const vida = lerInteiro(form.vida, { min: 1, max: 1200 });
    /** @type {Record<string, string>} */
    const novos = {};
    if (!editando && !PADRAO_CODIGO_CATALOGO.test(codigo)) novos.codigo = "Use de 2 a 32 letras maiúsculas, números ou _";
    if (!form.nome.trim()) novos.nome = "Obrigatório";
    if (!editando && !ehNatureza(form.natureza)) novos.natureza = "Escolha a natureza";
    if (!ordem.ok) novos.ordem = "Número inteiro de 0 a 9999";
    if (!vida.ok) novos.vida = "Meses: número inteiro de 1 a 1200";
    if (Object.keys(novos).length) {
      setErros(novos);
      notifyWarning("Atenção", "Revise os campos destacados.");
      return;
    }
    const comum = {
      nome: form.nome.trim(),
      descricao: form.descricao,
      ordem: ordem.ok ? ordem.valor : null,
      vida_util_meses_padrao: vida.ok ? vida.valor : null,
    };
    onSubmit(editando ? comum : { codigo, natureza: form.natureza, ...comum });
  };

  return (
    <CadastroFormShell embedded title={editando ? "Editar família patrimonial" : "Nova família patrimonial"}>
      <div className="mg-b1-record-form">
        <form id={FORMULARIO_FAMILIA_ID} onSubmit={enviar} className="b1 mg-b1-form-grid w-full min-h-0" noValidate data-testid="b1-form">
          <SecaoForm titulo="Identificação" />
          <CampoTexto
            label="Código"
            required={!editando}
            span={4}
            value={form.codigo}
            onChange={(v) => set("codigo", v)}
            readOnly={readOnly || editando}
            maxLength={32}
            error={erros.codigo || undefined}
            placeholder="EX.: MAQUINAS"
          />
          <CampoTexto label="Nome" required span={8} value={form.nome} onChange={(v) => set("nome", v)} readOnly={readOnly} maxLength={120} error={erros.nome || undefined} placeholder="NOME DA FAMÍLIA" />
          {editando ? (
            <CampoTexto label="Natureza" span={4} value={ROTULO_NATUREZA[form.natureza] || ""} onChange={() => {}} readOnly />
          ) : (
            <CampoSelect
              label="Natureza"
              required
              span={4}
              value={form.natureza}
              onChange={(v) => set("natureza", v)}
              options={OPCOES_NATUREZA}
              readOnly={readOnly}
              placeholder="— Escolha a natureza —"
              error={erros.natureza || undefined}
            />
          )}
          <CampoTexto
            label="Vida útil padrão (meses)"
            span={4}
            value={form.vida}
            onChange={(v) => set("vida", v)}
            readOnly={readOnly}
            inputMode="numeric"
            maxLength={4}
            error={erros.vida || undefined}
          />
          <CampoTexto label="Ordem" span={4} value={form.ordem} onChange={(v) => set("ordem", v)} readOnly={readOnly} inputMode="numeric" maxLength={4} error={erros.ordem || undefined} />
          <CampoTexto label="Descrição" span={12} value={form.descricao} onChange={(v) => set("descricao", v)} readOnly={readOnly} maxLength={500} />
          <div className="col-span-12">
            <AvisoGestao tone="blue" testId="familia-nota-natureza">
              A natureza decide o que o bem tem: benfeitorias têm medidas físicas; máquinas, veículos e equipamentos têm medidor e tanques.
              Ela não muda depois de criada. A vida útil padrão é só sugestão para os bens desta família.
            </AvisoGestao>
          </div>
        </form>
      </div>
    </CadastroFormShell>
  );
}
