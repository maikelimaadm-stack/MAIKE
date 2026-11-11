import React, { useState } from "react";
import CadastroFormShell from "@/components/cadastro/base1/CadastroFormShell";
import { notifyWarning } from "@/lib/maikeNotify";
import { AvisoGestao, CampoTexto, SecaoForm } from "@/components/gestao/GestaoFormParts";
import SeletorPaginadoGestao from "@/components/financeiroGestao/SeletorPaginadoGestao";
import { lerInteiro, normalizarCodigoCatalogo, textoDoInteiro } from "@/components/patrimonio/PatrimonioFormParts";
import { nomeDaFamiliaDoTipo, naturezaDaFamiliaDoTipo } from "@/components/patrimonio/TabelaTipos";
import { ROTULO_NATUREZA } from "@/lib/patrimonioDominio";
import { PADRAO_CODIGO_CATALOGO, RECURSOS_CATALOGO, listarOpcoesCatalogo } from "@/services/patrimonioCatalogoService";

export const FORMULARIO_TIPO_ID = "formulario-tipo-patrimonial-base1";

/** @typedef {{ id: string, rotulo: string, natureza: string|null }} FamiliaDoTipo */

/** @param {any} item @returns {FamiliaDoTipo|null} */
const familiaDoRegistro = (item) => {
  const id = item?.familia_id ?? item?.familia?.id;
  if (typeof id !== "string" || !id) return null;
  return { id, rotulo: nomeDaFamiliaDoTipo(item) || "Família atual", natureza: naturezaDaFamiliaDoTipo(item) };
};

/**
 * Formulário do Tipo Patrimonial (D-PROD-157; D-PROD-162: vive dentro do
 * cadastro de Bens e não tem mais perfis de medição).
 *  - criação: família escolhida por seletor paginado (só ativas) e nome; o
 *    código é opcional (P-05: vazio, o servidor o gera a partir do nome);
 *  - `familiaFixa`: a família vem travada, só leitura (o "+ Novo tipo" do
 *    formulário do Bem cria o tipo na família escolhida no bem);
 *  - `rapido`: só Nome (com a família travada);
 *  - edição: família e código só leitura (imutáveis no servidor).
 *
 * @param {{
 *   onSubmit: (dados: object) => void,
 *   initialData?: any,
 *   readOnly?: boolean,
 *   rapido?: boolean,
 *   familiaFixa?: FamiliaDoTipo|null,
 *   formId?: string,
 * }} props
 */
export default function FormularioTipo({ onSubmit, initialData = null, readOnly = false, rapido = false, familiaFixa = null, formId = FORMULARIO_TIPO_ID }) {
  const editando = Boolean(initialData?.id);
  const travada = !editando && Boolean(familiaFixa?.id);
  const [form, setForm] = useState(() => ({
    familia: travada ? familiaFixa : familiaDoRegistro(initialData),
    codigo: editando ? String(initialData.codigo ?? "") : "",
    nome: initialData?.nome || "",
    vida: textoDoInteiro(initialData?.vida_util_meses_sugerida),
    descricao: initialData?.descricao || "",
  }));
  const [erros, setErros] = useState(/** @type {Record<string, string>} */ ({}));

  const natureza = form.familia?.natureza ?? null;

  const set = (campo, valor) => {
    setForm((prev) => ({ ...prev, [campo]: valor }));
    setErros((e) => ({ ...e, [campo]: "" }));
  };

  const escolherFamilia = (opcao) => {
    const familia = opcao ? { id: String(opcao.id), rotulo: String(opcao.nome ?? ""), natureza: typeof opcao.natureza === "string" ? opcao.natureza : null } : null;
    set("familia", familia);
  };

  const enviar = (e) => {
    e.preventDefault();
    // O formulário pode abrir por cima de outro (cadastro rápido): o envio não sobe.
    e.stopPropagation();
    if (readOnly) return;
    const codigo = normalizarCodigoCatalogo(form.codigo);
    const vida = lerInteiro(form.vida, { min: 1, max: 1200 });
    /** @type {Record<string, string>} */
    const novos = {};
    if (!editando && !form.familia?.id) novos.familia = "Escolha a família";
    if (!editando && codigo && !PADRAO_CODIGO_CATALOGO.test(codigo)) novos.codigo = "Use de 2 a 32 letras maiúsculas, números ou _ (ou deixe vazio)";
    if (!form.nome.trim()) novos.nome = "Obrigatório";
    if (!vida.ok) novos.vida = "Meses: número inteiro de 1 a 1200";
    if (Object.keys(novos).length) {
      setErros(novos);
      notifyWarning("Atenção", "Revise os campos destacados.");
      return;
    }
    if (rapido) {
      onSubmit({ familia_id: form.familia?.id, nome: form.nome.trim() });
      return;
    }
    const comum = { nome: form.nome.trim(), descricao: form.descricao, vida_util_meses_sugerida: vida.ok ? vida.valor : null };
    onSubmit(editando ? comum : { familia_id: form.familia?.id, ...(codigo ? { codigo } : {}), ...comum });
  };

  const rotuloNatureza = natureza ? /** @type {Record<string, string>} */ (ROTULO_NATUREZA)[natureza] ?? "" : "";

  return (
    <CadastroFormShell embedded title={editando ? "Editar tipo patrimonial" : "Novo tipo patrimonial"}>
      <div className="mg-b1-record-form">
        <form id={formId} onSubmit={enviar} className="b1 mg-b1-form-grid w-full min-h-0" noValidate data-testid="tipo-form">
          <SecaoForm titulo="Identificação" />
          {editando || travada ? (
            <CampoTexto label="Família" span={rapido ? 8 : 8} value={form.familia?.rotulo ?? ""} onChange={() => {}} readOnly />
          ) : (
            <SeletorPaginadoGestao
              rotulo="Família"
              testId="tipo-seletor-familia"
              chave={["patrimonio", RECURSOS_CATALOGO.FAMILIAS]}
              buscar={({ q, cursor, limit }) => listarOpcoesCatalogo(RECURSOS_CATALOGO.FAMILIAS, { q, cursor, limit })}
              value={form.familia ? { id: form.familia.id, rotulo: form.familia.rotulo } : null}
              onChange={escolherFamilia}
              detalheDaOpcao={(o) => /** @type {Record<string, string>} */ (ROTULO_NATUREZA)[o?.natureza] ?? null}
              readOnly={readOnly}
              obrigatorio
              textoVazio="— Escolha a família —"
              erro={erros.familia || undefined}
              span={8}
            />
          )}
          <CampoTexto label="Natureza" span={4} value={rotuloNatureza} onChange={() => {}} readOnly />
          {!rapido ? (
            <CampoTexto
              label="Código"
              span={4}
              value={form.codigo}
              onChange={(v) => set("codigo", v)}
              readOnly={readOnly || editando}
              maxLength={32}
              error={erros.codigo || undefined}
              placeholder={editando ? undefined : "GERADO PELO NOME"}
            />
          ) : null}
          <CampoTexto
            label="Nome"
            required
            span={rapido ? 12 : 8}
            value={form.nome}
            onChange={(v) => set("nome", v)}
            readOnly={readOnly}
            maxLength={120}
            error={erros.nome || undefined}
            placeholder="NOME DO TIPO"
          />
          {!rapido ? (
            <>
              <CampoTexto
                label="Vida útil sugerida (meses)"
                span={4}
                value={form.vida}
                onChange={(v) => set("vida", v)}
                readOnly={readOnly}
                inputMode="numeric"
                maxLength={4}
                error={erros.vida || undefined}
              />
              <CampoTexto label="Descrição" span={8} value={form.descricao} onChange={(v) => set("descricao", v)} readOnly={readOnly} maxLength={500} />
            </>
          ) : null}
          <div className="col-span-12">
            <AvisoGestao tone="blue" testId="tipo-nota-familia">
              A família do tipo não muda depois de criada.{!rapido && !editando ? " Sem código, ele é gerado a partir do nome." : ""}
            </AvisoGestao>
          </div>
        </form>
      </div>
    </CadastroFormShell>
  );
}
