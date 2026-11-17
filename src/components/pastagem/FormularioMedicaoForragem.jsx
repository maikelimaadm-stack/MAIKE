import React, { useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import LancField from "@/components/cadastro/base1/LancField";
import { LancLoteForm, LancLoteGrade, LancLoteSegmento, LancLoteAviso, LancLoteRodape, LL_CTL } from "@/components/lotes/LancamentoLoteUi";
import { notifyError, notifySuccess, notifyWarning } from "@/lib/maikeNotify";
import { getApiErrorMessage } from "@/apis/_core/ApiError";
import { registrarMedicaoForragem } from "@/services/medicaoForragemService";
import { refreshMapaCacheEntry, updateMapaCachedData } from "@/services/mapaCacheService";
import {
  ROTULO_SITUACAO, SITUACOES, calcularAmostra, lerLeituras, mediaDasLeituras, numeroPtBR, situacaoPelaAltura, toneladasNoPasto,
} from "@/domain/pastagem/medicaoForragem";

/** Tom do aviso e bolinha por situação (o farol no mapa é a próxima etapa). */
export const TOM_SITUACAO = Object.freeze({ RAPADO: "vermelho", DESCANSO: "ambar", PRONTO: "verde", PASSOU: "ambar" });
export const BOLINHA_SITUACAO = Object.freeze({ RAPADO: "🔴", DESCANSO: "🟡", PRONTO: "🟢", PASSOU: "🟣" });

const fmt = (v, casas = 1) => (v === null || v === undefined ? "—" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas }));
const fmtInt = (v) => (v === null || v === undefined ? "—" : Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 0 }));

/** Texto do número para o corpo (o servidor lê pt-BR); vazio → ausente. @param {string} t */
const campoNumero = (t) => (String(t ?? "").trim() ? String(t).trim() : undefined);

/**
 * D-PROD-219 — Medição de Forragem do pasto: pela régua (leituras em cm → média e
 * situação pelas alturas da cultura da área; amostra de corte opcional → matéria
 * verde, % de matéria seca e massa seca) ou no olho (só a situação). As contas aqui
 * são só a PRÉVIA: o servidor recalcula e grava. Funciona sem rede (fila offline).
 *
 * @param {{
 *   area: { id: string, empresa_id: string, nome?: string, tamanho_hectares?: number|string|null },
 *   cultura?: { codigo?: string, nome?: string, altura_entrada_cm?: number|null, altura_saida_cm?: number|null } | null,
 *   hoje: string,
 *   onCancel: () => void,
 *   onSaved?: (medicao: any) => void,
 * }} props
 */
export default function FormularioMedicaoForragem({ area, cultura = null, hoje, onCancel, onSaved }) {
  const [form, setForm] = useState({
    data_medicao: hoje, metodo: "REGUA", leituras: [], novaLeitura: "", situacao: "",
    quadro_m2: "", qtd_amostras: "", peso_verde_g: "", peso_seco_g: "", materia_seca_pct: "", observacoes: "",
  });
  const [salvando, setSalvando] = useState(false);
  const muda = (campo) => (valor) => setForm((f) => ({ ...f, [campo]: valor }));
  const regua = form.metodo === "REGUA";

  const entrada = cultura?.altura_entrada_cm ?? null;
  const saida = cultura?.altura_saida_cm ?? null;
  // Leituras já adicionadas (lista) + a que está sendo digitada (ainda não confirmada):
  // as duas contam na média, para nada se perder se o usuário salvar sem tocar em "+".
  const leituras = useMemo(() => {
    const pendente = lerLeituras(form.novaLeitura);
    return { valores: [...form.leituras, ...pendente.valores], invalidas: pendente.invalidas };
  }, [form.leituras, form.novaLeitura]);
  const campoLeitura = useRef(/** @type {HTMLInputElement | null} */ (null));
  /** Passa a leitura digitada para a lista (o teclado numérico do celular não tem espaço). */
  const adicionarLeitura = ({ manterFoco = false } = {}) => {
    const pendente = lerLeituras(form.novaLeitura);
    if (pendente.invalidas.length) {
      notifyWarning("Atenção", `Leitura inválida: ${pendente.invalidas.slice(0, 3).join(", ")} (de 0 a 500 cm).`);
      return;
    }
    if (pendente.valores.length) setForm((f) => ({ ...f, leituras: [...f.leituras, ...pendente.valores], novaLeitura: "" }));
    if (manterFoco) campoLeitura.current?.focus();
  };
  const removerLeitura = (indice) => setForm((f) => ({ ...f, leituras: f.leituras.filter((_, i) => i !== indice) }));
  const media = mediaDasLeituras(leituras.valores);
  const situacaoRegua = situacaoPelaAltura(media, entrada, saida);
  const temAmostra = ["quadro_m2", "peso_verde_g", "peso_seco_g", "materia_seca_pct"].some((c) => String(form[c]).trim());
  const contas = useMemo(
    () => calcularAmostra({
      quadro_m2: numeroPtBR(form.quadro_m2),
      peso_verde_g: numeroPtBR(form.peso_verde_g),
      peso_seco_g: numeroPtBR(form.peso_seco_g),
      materia_seca_pct: numeroPtBR(form.materia_seca_pct),
    }),
    [form.quadro_m2, form.peso_verde_g, form.peso_seco_g, form.materia_seca_pct],
  );
  const toneladas = toneladasNoPasto(contas.massa_seca_kg_ha, Number(area?.tamanho_hectares));

  const enviar = async (e) => {
    e?.preventDefault?.();
    if (salvando) return;
    if (!form.data_medicao || (hoje && form.data_medicao > hoje)) {
      notifyWarning("Atenção", "A data da medição não pode ser depois de hoje.");
      return;
    }
    if (regua) {
      if (leituras.invalidas.length) {
        notifyWarning("Atenção", `Leitura inválida: ${leituras.invalidas.slice(0, 3).join(", ")} (de 0 a 500 cm).`);
        return;
      }
      if (!leituras.valores.length) {
        notifyWarning("Atenção", "Informe as leituras da régua (cm): digite cada uma e toque em +.");
        return;
      }
      if (temAmostra && (!(numeroPtBR(form.quadro_m2) > 0) || !(numeroPtBR(form.peso_verde_g) > 0))) {
        notifyWarning("Atenção", "Na amostra de corte, informe o tamanho do quadrado e o peso verde.");
        return;
      }
    } else if (!form.situacao) {
      notifyWarning("Atenção", "Escolha a situação do pasto.");
      return;
    }
    setSalvando(true);
    try {
      const corpo = {
        empresa_id: area.empresa_id,
        area_id: area.id,
        data_medicao: form.data_medicao,
        metodo: form.metodo,
        ...(regua
          ? {
              leituras_cm: leituras.valores,
              ...(temAmostra
                ? {
                    quadro_m2: campoNumero(form.quadro_m2),
                    qtd_amostras: form.qtd_amostras ? Number(form.qtd_amostras) : undefined,
                    peso_verde_g: campoNumero(form.peso_verde_g),
                    peso_seco_g: campoNumero(form.peso_seco_g),
                    materia_seca_pct: campoNumero(form.peso_seco_g) ? undefined : campoNumero(form.materia_seca_pct),
                  }
                : {}),
            }
          : { situacao: form.situacao }),
        observacoes: form.observacoes.trim() || null,
      };
      const medicao = await registrarMedicaoForragem(corpo);
      // Offline, o cache recebe a prévia (o servidor recalcula no replay).
      const previa = regua
        ? { altura_media_cm: media, qtd_leituras: leituras.valores.length, situacao: situacaoRegua, ...(temAmostra ? contas : {}) }
        : {};
      const registro = { ...corpo, ...previa, ...(medicao || {}) };
      await updateMapaCachedData("medicoesForragem", area.empresa_id, (itens) => [registro, ...(itens || []).filter((i) => i.id !== registro.id)]);
      if (typeof navigator === "undefined" || navigator.onLine !== false) {
        refreshMapaCacheEntry("medicoesForragem", area.empresa_id, { force: true }).catch(() => {});
      }
      notifySuccess("Medição registrada", registro._isOffline ? "Sem conexão: a medição vai ao servidor quando a rede voltar." : undefined);
      onSaved?.(registro);
    } catch (erro) {
      notifyError("Erro ao registrar a medição", getApiErrorMessage(erro));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <LancLoteForm onSubmit={enviar} data-testid="form-medicao-forragem">
      <LancLoteAviso tom="neutro" data-testid="medicao-cabecalho">
        <b>{area?.nome || "Pasto"}</b>
        {area?.tamanho_hectares ? <> · {fmt(area.tamanho_hectares, 1)} ha</> : null}
        {cultura ? (
          <>
            {" · Cultura "}<b>{[cultura.codigo, cultura.nome].filter(Boolean).join(" · ")}</b>
            {entrada !== null && saida !== null ? <> — entrada {fmt(entrada)} cm · saída {fmt(saida)} cm</> : <> — sem alturas no cadastro</>}
          </>
        ) : <> · sem cultura no cadastro da área</>}
      </LancLoteAviso>
      <LancField label="Data da Medição" required>
        <Input type="date" value={form.data_medicao} max={hoje || undefined} onChange={(e) => muda("data_medicao")(e.target.value)} className={LL_CTL} required />
      </LancField>
      <LancLoteSegmento
        rotulo="Como foi avaliado" required name="metodo"
        opcoes={[{ value: "REGUA", label: "Régua" }, { value: "OLHO", label: "No olho" }]}
        valor={form.metodo} onChange={muda("metodo")}
      />

      {regua ? (
        <>
          <div className="mk-ll__seg-rotulo">Altura do capim · leituras da régua, em cm</div>
          <div className="flex items-stretch gap-2">
            <LancField label={`Leitura (cm)${form.leituras.length ? ` · ${form.leituras.length + 1}ª` : ""}`} required className="flex-1">
              <Input
                ref={campoLeitura}
                value={form.novaLeitura} inputMode="decimal" enterKeyHint="next" placeholder="Ex.: 24,5"
                onChange={(e) => muda("novaLeitura")(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); adicionarLeitura({ manterFoco: true }); } }}
                onBlur={() => adicionarLeitura()}
                className={LL_CTL} data-testid="medicao-leituras"
              />
            </LancField>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => adicionarLeitura({ manterFoco: true })}
              className="shrink-0 w-14 rounded-xl bg-[#16A34A] text-white text-2xl font-semibold leading-none active:opacity-80"
              aria-label="Adicionar leitura" data-testid="medicao-adicionar-leitura"
            >+</button>
          </div>
          {form.leituras.length ? (
            <div className="flex flex-wrap gap-1.5" data-testid="medicao-lista-leituras">
              {form.leituras.map((v, i) => (
                <span key={`${i}-${v}`} className="inline-flex items-center gap-1 rounded-full pl-2.5 pr-1 py-1 text-xs font-medium" style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", color: "#14532D" }}>
                  {fmt(v)}
                  <button type="button" onClick={() => removerLeitura(i)} className="w-5 h-5 rounded-full" style={{ color: "#166534" }} aria-label={`Remover a leitura ${fmt(v)} cm`}>×</button>
                </span>
              ))}
            </div>
          ) : null}
          {media !== null ? (
            <LancLoteAviso tom={situacaoRegua ? TOM_SITUACAO[situacaoRegua] : "neutro"} data-testid="medicao-media">
              {situacaoRegua ? `${BOLINHA_SITUACAO[situacaoRegua]} ` : null}
              <b>Média {fmt(media)} cm</b> ({leituras.valores.length} {leituras.valores.length === 1 ? "leitura" : "leituras"})
              {situacaoRegua ? <> — <b>{ROTULO_SITUACAO[situacaoRegua]}</b>{situacaoRegua === "DESCANSO" && entrada !== null ? `. Fica pronto a partir de ${fmt(entrada)} cm.` : "."}</> : ". Sem as alturas da cultura, só a média."}
              {leituras.invalidas.length ? <> Ignorada(s): {leituras.invalidas.join(", ")}.</> : null}
            </LancLoteAviso>
          ) : null}

          <div className="mk-ll__seg-rotulo">Amostra de corte · opcional — para matéria verde e matéria seca</div>
          <LancLoteGrade>
            <LancField label="Tamanho do quadrado (m²)"><Input value={form.quadro_m2} inputMode="decimal" onChange={(e) => muda("quadro_m2")(e.target.value)} className={LL_CTL} data-testid="medicao-quadro" /></LancField>
            <LancField label="Quantas amostras"><Input value={form.qtd_amostras} inputMode="numeric" onChange={(e) => muda("qtd_amostras")(e.target.value.replace(/\D/g, ""))} className={LL_CTL} /></LancField>
            <LancField label="Peso verde médio da amostra (g)"><Input value={form.peso_verde_g} inputMode="decimal" onChange={(e) => muda("peso_verde_g")(e.target.value)} className={LL_CTL} data-testid="medicao-peso-verde" /></LancField>
            <LancField label="Peso seco médio da amostra (g)"><Input value={form.peso_seco_g} inputMode="decimal" onChange={(e) => muda("peso_seco_g")(e.target.value)} className={LL_CTL} data-testid="medicao-peso-seco" /></LancField>
            {!String(form.peso_seco_g).trim() ? (
              <LancField label="Matéria seca (%) · se veio do laboratório"><Input value={form.materia_seca_pct} inputMode="decimal" onChange={(e) => muda("materia_seca_pct")(e.target.value)} className={LL_CTL} data-testid="medicao-ms-pct" /></LancField>
            ) : null}
          </LancLoteGrade>
          {contas.massa_verde_kg_ha !== null ? (
            <div className="mk-ll__aviso mk-ll__aviso--verde" style={{ display: "grid", gap: 6 }} data-testid="medicao-amostra">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 8 }}>
                {[
                  ["Matéria verde (bruta)", fmtInt(contas.massa_verde_kg_ha), "kg/ha"],
                  ["Matéria seca", fmt(contas.materia_seca_pct), "%"],
                  ["Massa seca", fmtInt(contas.massa_seca_kg_ha), "kg MS/ha"],
                ].map(([r, v, u]) => (
                  <div key={r}>
                    <div style={{ fontSize: 11, color: "#4B5563" }}>{r}</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: "#14532D" }}>{v} <span style={{ fontSize: 11, fontWeight: 500 }}>{u}</span></div>
                  </div>
                ))}
              </div>
              {toneladas !== null ? <div style={{ fontSize: 12 }}>No pasto inteiro ({fmt(area.tamanho_hectares, 1)} ha): <b>{fmt(toneladas)} t de matéria seca</b>.</div> : null}
              {contas.materia_seca_pct === null ? <div style={{ fontSize: 12 }}>Sem o peso seco (ou a % do laboratório), só a matéria verde.</div> : null}
            </div>
          ) : null}
        </>
      ) : (
        <>
          <LancLoteSegmento
            rotulo="Situação do pasto" required name="situacao"
            opcoes={SITUACOES.map((s) => ({ value: s, label: s === "DESCANSO" ? "Descanso" : ROTULO_SITUACAO[s] }))}
            valor={form.situacao} onChange={muda("situacao")}
          />
          {form.situacao ? (
            <LancLoteAviso tom={TOM_SITUACAO[form.situacao]} data-testid="medicao-olho">
              {BOLINHA_SITUACAO[form.situacao]} <b>{ROTULO_SITUACAO[form.situacao]}</b> — avaliado no olho, sem número.
            </LancLoteAviso>
          ) : null}
        </>
      )}

      <LancField label="Observação">
        <textarea
          value={form.observacoes} maxLength={2000} rows={2}
          onChange={(e) => muda("observacoes")(e.target.value)}
          className="w-full resize-y bg-transparent px-2 py-1 text-xs outline-none"
        />
      </LancField>
      <LancLoteRodape onCancelar={onCancel} cancelarDesabilitado={salvando} textoAcao="Salvar Medição" textoEnviando="Salvando..." enviando={salvando} />
    </LancLoteForm>
  );
}
