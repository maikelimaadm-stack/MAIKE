import React, { memo } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import * as CampoUi from "@/components/ui/input";
import { formatHectaresPt } from "@/lib/geografia";
import {
  APROVEITAMENTO,
  CORES_DISPONIVEIS,
  TIPOS_CULTURAS,
  TIPOS_INFRAESTRUTURA,
  TIPOS_USO,
  pendenciasDaArea,
} from "@/domain/areas/regrasCadastroArea";
import SeletorImportacao from "./SeletorImportacao";

/** shadcn sem tipos de props no checkJs legado: alias `any`, sem dívida nova. */
/** @type {Record<string, any>} */
const ui = CampoUi;
const { Input } = ui;

export const ROTULOS = Object.freeze({
  nome: "Nome",
  setor_id: "Setor",
  tipo_cultura: "Tipo de uso",
  tipo_pastagem: "Tipo de cultura",
  tipo_infraestrutura: "Tipo de infraestrutura",
  area_pastejada: "Área pastejada/arável",
  aproveitamento: "Aproveitamento",
  cor: "Cor",
  coords: "Contorno",
  sigla: "Sigla",
  aproveitamento_classificacao: "Aproveitamento",
});

const selectClass =
  "h-7 w-full min-w-[110px] rounded border border-slate-300 bg-white px-1 text-xs focus:border-emerald-500 focus:outline-none";
const invalidoClass = "border-red-500 bg-red-50";
const arredondar2 = (n) => Math.round(n * 100) / 100;
/** Lista vazia estável: linha sem pendência do servidor não muda de props. */
export const SEM_PENDENCIAS = Object.freeze([]);

/**
 * Pendências locais de uma linha: regra compartilhada com o formulário manual
 * (D-PROD-90) + setor fora da lista de setores ativos da empresa.
 * @param {any} l
 * @param {Map<string, any>} setoresPorId
 */
export const pendenciasDaLinha = (l, setoresPorId) => {
  const pend = pendenciasDaArea({
    nome: l.nome,
    sigla: l.sigla,
    setor_id: l.setor_id,
    tipo_cultura: l.tipo_cultura,
    tipo_pastagem: l.tipo_cultura === "Infraestrutura" ? l.tipo_infraestrutura : l.tipo_pastagem,
    area_pastejada: l.area_pastejada,
    total_ha: arredondar2(l.hectares),
  });
  if (l.setor_id && !setoresPorId.has(l.setor_id)) {
    pend.push({ campo: "setor_id", mensagem: "Setor não está entre os setores ativos desta empresa." });
  }
  return pend;
};

/**
 * Uma linha da conferência. Memorizada: com centenas de linhas, editar uma
 * não re-renderiza as outras (D-PROD-90 R1 — arquivos com mais de 100 áreas).
 *
 * @param {{
 *   l: any, setores: any[], setoresPorId: Map<string, any>, pendServidor: readonly any[], conferida: boolean,
 *   selecionada: boolean, bloqueada: boolean, gravada: any, emFoco: boolean,
 *   onAlterar: (ref: string, campo: string, valor: string) => void,
 *   onAlternar: (ref: string) => void, onFocar: (ref: string) => void,
 * }} props
 */
function LinhaImportacao({
  l,
  setores,
  setoresPorId,
  pendServidor,
  conferida,
  selecionada,
  bloqueada,
  gravada,
  emFoco,
  onAlterar,
  onAlternar,
  onFocar,
}) {
  const pend = gravada ? SEM_PENDENCIAS : [...pendenciasDaLinha(l, setoresPorId), ...pendServidor];
  const infra = l.tipo_cultura === "Infraestrutura";
  const invalida = (campo) => pend.some((p) => p.campo === campo);
  return (
    <>
        <tr
          data-testid={`linha-${l.ref}`}
          className={`border-t border-slate-100 align-top ${emFoco ? "bg-orange-50" : ""}`}
          onClick={() => onFocar(l.ref)}
        >
          <td className="p-1">
            <input type="checkbox" aria-label={`Selecionar ${l.origem}`} checked={selecionada} disabled={bloqueada} onChange={() => onAlternar(l.ref)} />
          </td>
          <td className="whitespace-nowrap p-1 text-slate-500">{l.origem}</td>
          <td className="p-1">
            <Input
              aria-label={`Nome ${l.origem}`}
              value={l.nome}
              disabled={bloqueada}
              onChange={(e) => onAlterar(l.ref, "nome", e.target.value)}
              className={`h-7 min-w-[140px] text-xs uppercase ${invalida("nome") ? invalidoClass : ""}`}
            />
            {l.nomeOrigem === "sugerido" && <div className="text-[10px] text-amber-700">Nome sugerido — confira</div>}
          </td>
          <td className="p-1">
            <SeletorImportacao aria-label={`Setor ${l.origem}`} disabled={bloqueada} className={`${selectClass} ${invalida("setor_id") ? invalidoClass : ""}`} value={l.setor_id} onChange={(e) => onAlterar(l.ref, "setor_id", e.target.value)}>
              <option value="">Selecione</option>
              {setores.map((s) => (
                <option key={s.id} value={s.id}>{s.nome}</option>
              ))}
            </SeletorImportacao>
          </td>
          <td className="p-1">
            <SeletorImportacao aria-label={`Tipo de uso ${l.origem}`} disabled={bloqueada} className={`${selectClass} ${invalida("tipo_cultura") ? invalidoClass : ""}`} value={l.tipo_cultura} onChange={(e) => onAlterar(l.ref, "tipo_cultura", e.target.value)}>
              <option value="">Selecione</option>
              {TIPOS_USO.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </SeletorImportacao>
          </td>
          <td className="whitespace-nowrap p-1 text-right tabular-nums" data-testid={`hectares-${l.ref}`}>
            {formatHectaresPt(l.hectares)}
            {infra && <div className="text-[10px] text-slate-500">grava 0 ha (infraestrutura)</div>}
          </td>
          <td className="p-1">
            {infra ? (
              <span className="text-slate-400">—</span>
            ) : (
              <Input
                aria-label={`Área pastejada ${l.origem}`}
                value={l.area_pastejada}
                disabled={bloqueada}
                placeholder={l.tipo_cultura === "Reserva" || l.tipo_cultura === "APP" ? "0 se não houver" : "ha"}
                onChange={(e) => onAlterar(l.ref, "area_pastejada", e.target.value)}
                className={`h-7 w-24 text-xs ${invalida("area_pastejada") ? invalidoClass : ""}`}
              />
            )}
          </td>
          <td className="p-1">
            {infra ? (
              <SeletorImportacao aria-label={`Infraestrutura ${l.origem}`} disabled={bloqueada} className={`${selectClass} ${invalida("tipo_infraestrutura") || invalida("tipo_pastagem") ? invalidoClass : ""}`} value={l.tipo_infraestrutura} onChange={(e) => onAlterar(l.ref, "tipo_infraestrutura", e.target.value)}>
                <option value="">Selecione</option>
                {TIPOS_INFRAESTRUTURA.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </SeletorImportacao>
            ) : (
              <SeletorImportacao aria-label={`Tipo de cultura ${l.origem}`} disabled={bloqueada} className={`${selectClass} ${invalida("tipo_pastagem") ? invalidoClass : ""}`} value={l.tipo_pastagem} onChange={(e) => onAlterar(l.ref, "tipo_pastagem", e.target.value)}>
                <option value="">{l.tipo_cultura === "Reserva" || l.tipo_cultura === "APP" ? "Opcional" : "Selecione"}</option>
                {TIPOS_CULTURAS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </SeletorImportacao>
            )}
          </td>
          <td className="p-1">
            <SeletorImportacao aria-label={`Aproveitamento ${l.origem}`} disabled={bloqueada} className={selectClass} value={l.aproveitamento} onChange={(e) => onAlterar(l.ref, "aproveitamento", e.target.value)}>
              {APROVEITAMENTO.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </SeletorImportacao>
          </td>
          <td className="p-1">
            <div className="flex items-center gap-1">
              <span className="inline-block h-3 w-3 shrink-0 rounded-full border border-slate-300" style={{ backgroundColor: l.cor }} />
              <SeletorImportacao aria-label={`Cor ${l.origem}`} disabled={bloqueada} className={selectClass} value={l.cor} onChange={(e) => onAlterar(l.ref, "cor", e.target.value)}>
                {CORES_DISPONIVEIS.map((c) => (
                  <option key={c.cor} value={c.cor}>{c.nome}</option>
                ))}
              </SeletorImportacao>
            </div>
          </td>
          <td className="whitespace-nowrap p-1" data-testid={`estado-${l.ref}`}>
            {gravada ? (
              <span className="inline-flex items-center gap-1 font-medium text-emerald-800">
                <CheckCircle2 className="h-3 w-3" /> Gravada · nº {gravada.numero_area} (lote {gravada.lote})
              </span>
            ) : pend.length === 0 ? (
              <span className="inline-flex items-center gap-1 text-emerald-700">
                <CheckCircle2 className="h-3 w-3" /> {conferida ? "Conferida" : "Sem pendência"}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-red-700">
                <XCircle className="h-3 w-3" /> {pend.length} pendência(s)
              </span>
            )}
          </td>
        </tr>
        {(pend.length > 0 || l.avisos.length > 0) && (
          <tr className={emFoco ? "bg-orange-50" : ""}>
            <td />
            <td colSpan={10} className="px-1 pb-1" data-testid={`situacao-${l.ref}`}>
              {pend.length > 0 && (
                <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-red-700">
                  {pend.map((p, i) => (
                    <li key={`${p.campo}-${i}`}>
                      <strong>{ROTULOS[p.campo] ?? p.campo}:</strong> {p.mensagem}
                    </li>
                  ))}
                </ul>
              )}
              {l.avisos.map((a) => (
                <div key={a} className="text-[10px] text-amber-700">{a}</div>
              ))}
            </td>
          </tr>
        )}
    </>
  );
}

export default memo(LinhaImportacao);
