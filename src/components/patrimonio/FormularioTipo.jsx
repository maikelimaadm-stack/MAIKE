import React, { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import CadastroFormShell from "@/components/cadastro/base1/CadastroFormShell";
import { notifyWarning } from "@/lib/maikeNotify";
import { AvisoGestao, CampoTexto, SecaoForm } from "@/components/gestao/GestaoFormParts";
import SeletorPaginadoGestao from "@/components/financeiroGestao/SeletorPaginadoGestao";
import { lerInteiro, normalizarCodigoCatalogo, textoDoInteiro } from "@/components/patrimonio/PatrimonioFormParts";
import { nomeDaFamiliaDoTipo, naturezaDaFamiliaDoTipo } from "@/components/patrimonio/TabelaTipos";
import { ROTULO_DIMENSAO, ROTULO_NATUREZA } from "@/lib/patrimonioDominio";
import { mensagemErroPatrimonio } from "@/lib/patrimonioErros";
import {
  LIMITE_PERFIS_DO_TIPO,
  PADRAO_CODIGO_CATALOGO,
  RECURSOS_CATALOGO,
  detalharCatalogo,
  listarOpcoesCatalogo,
  perfisDoTipo,
} from "@/services/patrimonioCatalogoService";

export const FORMULARIO_TIPO_ID = "formulario-tipo-patrimonial-base1";

/** @typedef {{ perfil_id: string, principal: boolean, nome: string, codigo: string, dimensao: string|null, ativo: boolean }} PerfilSugerido */

/** @param {any} item */
const familiaDoRegistro = (item) => {
  const id = item?.familia_id ?? item?.familia?.id;
  if (typeof id !== "string" || !id) return null;
  return { id, rotulo: nomeDaFamiliaDoTipo(item) || "Família atual", natureza: naturezaDaFamiliaDoTipo(item) };
};

/** @param {{ nome?: string, codigo?: string }} p */
const nomeDoPerfil = (p) => p.nome || p.codigo || "Perfil";

/**
 * Formulário do Tipo Patrimonial (D-PROD-157).
 *  - criação: família escolhida por seletor paginado (só ativas), código e nome;
 *  - edição: família e código só leitura (imutáveis no servidor);
 *  - perfis de medição sugeridos SÓ para família de natureza Benfeitoria:
 *    até 10, sem repetição, no máximo um principal; perfil novo só entre os
 *    ativos (seletor); perfil já vinculado e depois inativado pode ficar.
 *
 * @param {{ onSubmit: (dados: object) => void, initialData?: any, readOnly?: boolean }} props
 */
export default function FormularioTipo({ onSubmit, initialData = null, readOnly = false }) {
  const editando = Boolean(initialData?.id);
  const [form, setForm] = useState(() => ({
    familia: familiaDoRegistro(initialData),
    codigo: editando ? String(initialData.codigo ?? "") : "",
    nome: initialData?.nome || "",
    vida: textoDoInteiro(initialData?.vida_util_meses_sugerida),
    descricao: initialData?.descricao || "",
  }));
  /** `null` = a lista ainda não foi lida (o registro da lista não a trouxe). */
  const [perfis, setPerfis] = useState(() => /** @type {PerfilSugerido[]|null} */ (perfisDoTipo(initialData) ?? (editando ? null : [])));
  const [erros, setErros] = useState(/** @type {Record<string, string>} */ ({}));

  // Registro da lista sem perfis ou sem a natureza da família: lê o detalhe.
  const precisaDetalhe = editando && (perfis === null || !form.familia?.natureza);
  const detalhe = useQuery({
    queryKey: ["patrimonio-catalogo", RECURSOS_CATALOGO.TIPOS, "detalhe", initialData?.id ?? null],
    queryFn: () => detalharCatalogo(RECURSOS_CATALOGO.TIPOS, String(initialData.id)),
    enabled: precisaDetalhe,
  });
  useEffect(() => {
    const d = /** @type {any} */ (detalhe.data);
    if (!d) return;
    setPerfis((atual) => atual ?? perfisDoTipo(d) ?? []);
    setForm((prev) => {
      const natureza = naturezaDaFamiliaDoTipo(d);
      if (prev.familia?.natureza || !natureza) return prev;
      return { ...prev, familia: { ...(prev.familia ?? { id: String(d.familia_id ?? d.familia?.id ?? ""), rotulo: nomeDaFamiliaDoTipo(d) }), natureza } };
    });
  }, [detalhe.data]);

  const natureza = form.familia?.natureza ?? null;
  const aceitaPerfis = natureza === "BENFEITORIA" || (natureza === null && (perfis?.length ?? 0) > 0);

  const set = (campo, valor) => {
    setForm((prev) => ({ ...prev, [campo]: valor }));
    setErros((e) => ({ ...e, [campo]: "" }));
  };

  const escolherFamilia = (opcao) => {
    const familia = opcao ? { id: String(opcao.id), rotulo: String(opcao.nome ?? ""), natureza: typeof opcao.natureza === "string" ? opcao.natureza : null } : null;
    set("familia", familia);
    // Perfis só valem para Benfeitorias: outra natureza limpa a escolha.
    if (familia?.natureza !== "BENFEITORIA") setPerfis([]);
  };

  const adicionarPerfil = (opcao) => {
    if (!opcao || readOnly) return;
    setPerfis((atual) => {
      const lista = atual ?? [];
      if (lista.some((p) => p.perfil_id === String(opcao.id))) return lista;
      if (lista.length >= LIMITE_PERFIS_DO_TIPO) {
        notifyWarning("Atenção", `Um tipo pode ter no máximo ${LIMITE_PERFIS_DO_TIPO} perfis sugeridos.`);
        return lista;
      }
      const novo = {
        perfil_id: String(opcao.id),
        principal: !lista.some((p) => p.principal),
        nome: String(opcao.nome ?? ""),
        codigo: String(opcao.codigo ?? ""),
        dimensao: typeof opcao.dimensao === "string" ? opcao.dimensao : null,
        ativo: true,
      };
      return [...lista, novo];
    });
  };

  const alternarPrincipal = (perfilId) =>
    setPerfis((atual) => (atual ?? []).map((p) => ({ ...p, principal: p.perfil_id === perfilId ? !p.principal : false })));

  const tirarPerfil = (perfilId) => setPerfis((atual) => (atual ?? []).filter((p) => p.perfil_id !== perfilId));

  const enviar = (e) => {
    e.preventDefault();
    if (readOnly) return;
    const codigo = normalizarCodigoCatalogo(form.codigo);
    const vida = lerInteiro(form.vida, { min: 1, max: 1200 });
    /** @type {Record<string, string>} */
    const novos = {};
    if (!editando && !form.familia?.id) novos.familia = "Escolha a família";
    if (!editando && !PADRAO_CODIGO_CATALOGO.test(codigo)) novos.codigo = "Use de 2 a 32 letras maiúsculas, números ou _";
    if (!form.nome.trim()) novos.nome = "Obrigatório";
    if (!vida.ok) novos.vida = "Meses: número inteiro de 1 a 1200";
    if (Object.keys(novos).length) {
      setErros(novos);
      notifyWarning("Atenção", "Revise os campos destacados.");
      return;
    }
    /** @type {Record<string, any>} */
    const comum = { nome: form.nome.trim(), descricao: form.descricao, vida_util_meses_sugerida: vida.ok ? vida.valor : null };
    // Lista não lida (falha no detalhe) não vai: o servidor mantém a atual.
    if (perfis !== null) comum.perfis = aceitaPerfis ? perfis.map((p) => ({ perfil_id: p.perfil_id, principal: p.principal })) : [];
    onSubmit(editando ? comum : { familia_id: form.familia?.id, codigo, ...comum });
  };

  const listaPerfis = perfis ?? [];

  return (
    <CadastroFormShell embedded title={editando ? "Editar tipo patrimonial" : "Novo tipo patrimonial"}>
      <div className="mg-b1-record-form">
        <form id={FORMULARIO_TIPO_ID} onSubmit={enviar} className="b1 mg-b1-form-grid w-full min-h-0" noValidate data-testid="b1-form">
          <SecaoForm titulo="Identificação" />
          {editando ? (
            <CampoTexto label="Família" span={8} value={form.familia?.rotulo ?? ""} onChange={() => {}} readOnly />
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
          <CampoTexto label="Natureza" span={4} value={natureza ? ROTULO_NATUREZA[natureza] ?? "" : ""} onChange={() => {}} readOnly />
          <CampoTexto
            label="Código"
            required={!editando}
            span={4}
            value={form.codigo}
            onChange={(v) => set("codigo", v)}
            readOnly={readOnly || editando}
            maxLength={32}
            error={erros.codigo || undefined}
            placeholder="EX.: TRATOR_PNEUS"
          />
          <CampoTexto label="Nome" required span={8} value={form.nome} onChange={(v) => set("nome", v)} readOnly={readOnly} maxLength={120} error={erros.nome || undefined} placeholder="NOME DO TIPO" />
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

          {aceitaPerfis ? (
            <>
              <SecaoForm titulo="Perfis de medição sugeridos" />
              {perfis === null ? (
                <div className="col-span-12 text-xs text-[var(--mg-text-2,#475569)]" role="status">
                  {detalhe.isError ? mensagemErroPatrimonio(detalhe.error, "Não foi possível carregar os perfis sugeridos.") : "Carregando perfis sugeridos…"}
                </div>
              ) : (
                <div className="col-span-12 min-w-0" data-testid="tipo-perfis-sugeridos">
                  {listaPerfis.length ? (
                    <ul className="divide-y divide-[var(--mg-divider,#e2e8f0)] rounded-md border border-[var(--mg-divider,#cbd5e1)]">
                      {listaPerfis.map((p) => (
                        <li key={p.perfil_id} className="flex min-h-10 flex-wrap items-center gap-2 px-2 py-1.5 text-[13px]">
                          <span className="min-w-0 flex-1 break-words uppercase">
                            {nomeDoPerfil(p)}
                            {p.dimensao ? <span className="ml-2 normal-case text-[11px] text-[var(--mg-text-2,#475569)]">{ROTULO_DIMENSAO[p.dimensao] ?? p.dimensao}</span> : null}
                            {!p.ativo ? <span className="ml-2 normal-case text-[11px] text-amber-700">(inativo)</span> : null}
                          </span>
                          <button
                            type="button"
                            aria-pressed={p.principal}
                            aria-label={`Perfil principal: ${nomeDoPerfil(p)}`}
                            disabled={readOnly}
                            onClick={() => alternarPrincipal(p.perfil_id)}
                            className={`min-h-8 rounded-full border px-3 text-xs font-medium ${
                              p.principal ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-[var(--mg-divider,#cbd5e1)] bg-white"
                            }`}
                          >
                            Principal
                          </button>
                          {!readOnly ? (
                            <button
                              type="button"
                              aria-label={`Tirar ${nomeDoPerfil(p)} dos perfis sugeridos`}
                              onClick={() => tirarPerfil(p.perfil_id)}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--mg-divider,#cbd5e1)]"
                            >
                              <X aria-hidden size={14} />
                            </button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-[var(--mg-text-2,#475569)]">Nenhum perfil sugerido.</p>
                  )}
                </div>
              )}
              {!readOnly && perfis !== null && listaPerfis.length < LIMITE_PERFIS_DO_TIPO ? (
                <SeletorPaginadoGestao
                  rotulo="Adicionar perfil"
                  testId="tipo-seletor-perfil"
                  chave={["patrimonio", RECURSOS_CATALOGO.PERFIS_MEDICAO]}
                  buscar={({ q, cursor, limit }) => listarOpcoesCatalogo(RECURSOS_CATALOGO.PERFIS_MEDICAO, { q, cursor, limit })}
                  value={null}
                  onChange={adicionarPerfil}
                  detalheDaOpcao={(o) => /** @type {Record<string, string>} */ (ROTULO_DIMENSAO)[o?.dimensao] ?? null}
                  textoVazio="— Escolha um perfil para adicionar —"
                  span={12}
                />
              ) : null}
            </>
          ) : null}

          <div className="col-span-12">
            <AvisoGestao tone="blue" testId="tipo-nota-perfis">
              Perfis de medição sugeridos (área, extensão, volume, capacidade…) existem só para tipos de benfeitorias e servem de ponto de
              partida nas medições do bem. A família não muda depois de criada.
            </AvisoGestao>
          </div>
        </form>
      </div>
    </CadastroFormShell>
  );
}
