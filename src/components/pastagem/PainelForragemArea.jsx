import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LancLoteDialogo } from "@/components/lotes/LancamentoLoteUi";
import FormularioMedicaoForragem from "./FormularioMedicaoForragem";
import { getMapaCachedData, refreshMapaCacheEntry, updateMapaCachedData } from "@/services/mapaCacheService";
import { listEmpresas } from "@/services/empresaService";
import { listarCulturas } from "@/services/culturaCadastroService";
import { excluirMedicaoForragem } from "@/services/medicaoForragemService";
import { useDiaCivil } from "@/hooks/useDiaCivil";
import { formatarDia } from "@/lib/diaCivil";
import { confirmarExclusao } from "@/lib/maikeConfirmar";
import { notifyError, notifySuccess } from "@/lib/maikeNotify";
import { getApiErrorMessage } from "@/apis/_core/ApiError";
import { ROTULO_SITUACAO, parametrosDoPasto } from "@/domain/pastagem/medicaoForragem";
import { DIAS_VALIDADE_FORRAGEM, estimativaDoPasto, farolDaMedicao, farolQueVale } from "@/domain/pastagem/farolForragem";
import { Acao, Cartao, Linha, TituloBloco } from "@/components/mapa/detalhes-lote/blocos";

/** Cores das bolinhas da situação no desenho v12 (as mesmas do 🔴🟡🟢🟣 do formulário). */
const COR_SITUACAO = Object.freeze({ RAPADO: "#dc2626", DESCANSO: "#f59e0b", PRONTO: "#16a34a", PASSOU: "#7c3aed" });

const CHAVE = "medicoesForragem";
/** D-PROD-223: ocupação e última saída de lote por pasto (farol estimado). */
const CHAVE_DESCANSO = "descansoPastos";
const diasTexto = (n) => `${n} ${n === 1 ? "dia" : "dias"}`;
/** D-PROD-223: de onde vem cada parâmetro do pasto. */
const ORIGEM = Object.freeze({ PASTO: "do pasto", CULTURA: "da cultura" });
const fmt = (v, casas = 1) => (v === null || v === undefined ? "—" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas }));
const fmtCm = (v) => Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
const fmtInt = (v) => Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 0 });
const dia = (m) => formatarDia(String(m?.data_medicao ?? "").slice(0, 10));

/** Resumo de uma medição numa linha: método, média, situação e MS. @param {any} m */
export const resumoDaMedicao = (m) => {
  const partes = [m.metodo === "OLHO" ? "No olho" : `Régua ${fmt(m.altura_media_cm)} cm`];
  if (m.situacao) partes.push(ROTULO_SITUACAO[m.situacao] ?? m.situacao);
  if (m.massa_seca_kg_ha !== null && m.massa_seca_kg_ha !== undefined) partes.push(`${fmtInt(m.massa_seca_kg_ha)} kg MS/ha`);
  else if (m.massa_verde_kg_ha !== null && m.massa_verde_kg_ha !== undefined) partes.push(`${fmtInt(m.massa_verde_kg_ha)} kg/ha verde`);
  return partes.join(" · ");
};

/**
 * Lê uma capacidade do cache do mapa (mesmo padrão do detalhe do cocho): cache local
 * primeiro, servidor quando há rede.
 * @param {string} chave @param {string|null} empresaId
 */
function useCacheDoMapa(chave, empresaId) {
  const queryClient = useQueryClient();
  const queryKey = ["mapa-cache", chave, empresaId, "default"];
  return useQuery({
    queryKey,
    queryFn: async () => {
      const cached = await getMapaCachedData(chave, empresaId);
      if (typeof navigator !== "undefined" && navigator.onLine) {
        if (cached?.length) {
          refreshMapaCacheEntry(chave, empresaId).then((fresh) => {
            if (fresh?.length) queryClient.setQueryData(queryKey, fresh);
          }).catch(() => {});
          return cached;
        }
        return (await refreshMapaCacheEntry(chave, empresaId)) || [];
      }
      return cached || [];
    },
    enabled: !!empresaId,
    staleTime: 60 * 1000,
  });
}

/**
 * D-PROD-219 — Forragem do pasto no detalhe da área (Mapa Geral): o botão
 * "Medição de Forragem", a última medição e as últimas 5, com excluir. Só aparece
 * para quem tem a chave do mapa `medir_forragem` (o detalhe decide).
 * No desenho do Detalhes do Lote v12 (D-PROD-220): título de seção com o link
 * "Medição de Forragem", cartão com a última medição e as últimas 5 com
 * "Excluir". O desenho antigo saiu: o detalhe da área era o único uso.
 * @param {{ area: any }} props
 */
export default function PainelForragemArea({ area }) {
  const queryClient = useQueryClient();
  const empresaId = area?.empresa_id ?? null;
  const [aberto, setAberto] = useState(false);

  const { data: empresas = [] } = useQuery({ queryKey: ["empresas"], queryFn: () => listEmpresas(), enabled: !!empresaId, staleTime: 5 * 60 * 1000, refetchOnWindowFocus: false });
  const fuso = useMemo(() => {
    const empresa = (Array.isArray(empresas) ? empresas : []).find((e) => String(e?.id) === String(empresaId));
    return typeof empresa?.fuso_horario === "string" && empresa.fuso_horario ? empresa.fuso_horario : null;
  }, [empresas, empresaId]);
  const hoje = useDiaCivil(fuso);

  // As alturas da cultura (prévia da situação). Sem acesso ao cadastro de Culturas, só a média; o servidor decide.
  const { data: culturas = [] } = useQuery({
    queryKey: ["culturas", empresaId],
    queryFn: async () => {
      try {
        return await listarCulturas(empresaId);
      } catch {
        return [];
      }
    },
    enabled: !!empresaId && !!area?.cultura_id,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const cultura = useMemo(() => {
    const doCadastro = (Array.isArray(culturas) ? culturas : []).find((c) => c?.id === area?.cultura_id);
    if (doCadastro) return doCadastro;
    return area?.cultura ? { ...area.cultura } : null;
  }, [culturas, area?.cultura_id, area?.cultura]);

  const { data: medicoes = [] } = useCacheDoMapa(CHAVE, empresaId);
  const doPasto = useMemo(
    () => (Array.isArray(medicoes) ? medicoes : [])
      .filter((m) => m?.area_id === area?.id)
      .sort((a, b) => String(b.data_medicao).localeCompare(String(a.data_medicao)) || String(b.created_date ?? "").localeCompare(String(a.created_date ?? ""))),
    [medicoes, area?.id],
  );
  const ultima = doPasto[0] ?? null;
  // D-PROD-223: lote dentro agora e a última saída, para a estimativa pelos dias de descanso da cultura.
  const { data: descansos = [] } = useCacheDoMapa(CHAVE_DESCANSO, empresaId);
  const estimativa = useMemo(() => {
    const doPastoAgora = (Array.isArray(descansos) ? descansos : []).find((d) => d?.area_id === area?.id) ?? null;
    return estimativaDoPasto({ ...area, cultura }, doPastoAgora, hoje);
  }, [descansos, area, cultura, hoje]);
  // D-PROD-223: os parâmetros que valem para o pasto e de onde vêm (do pasto ou da cultura).
  const parametros = useMemo(() => parametrosDoPasto(area, cultura), [area, cultura]);
  // D-PROD-221: o mesmo farol que pinta o pasto no modo "Forragem" do mapa (D-PROD-223: com a estimativa).
  const farol = useMemo(() => farolQueVale(ultima ? farolDaMedicao(ultima, hoje) : null, estimativa), [ultima, hoje, estimativa]);
  const textoParametros = [
    parametros.altura_entrada_cm !== null ? `entrada ${fmtCm(parametros.altura_entrada_cm)} cm (${ORIGEM[parametros.origem.altura_entrada_cm]})` : null,
    parametros.altura_saida_cm !== null ? `saída ${fmtCm(parametros.altura_saida_cm)} cm (${ORIGEM[parametros.origem.altura_saida_cm]})` : null,
    parametros.dias_descanso !== null ? `descanso ${diasTexto(parametros.dias_descanso)} (${ORIGEM[parametros.origem.dias_descanso]})` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const atualizadas = (lista) => {
    if (Array.isArray(lista)) queryClient.setQueryData(["mapa-cache", CHAVE, empresaId, "default"], lista);
    queryClient.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "mapa-cache" && q.queryKey[1] === CHAVE });
    window.dispatchEvent(new CustomEvent("atualizar-mapa", { detail: { cacheKeys: [CHAVE] } }));
  };

  const excluir = async (m) => {
    const ok = await confirmarExclusao(`Excluir a medição de ${dia(m)} (${resumoDaMedicao(m)})?`);
    if (!ok) return;
    try {
      await excluirMedicaoForragem(m.id);
      atualizadas(await updateMapaCachedData(CHAVE, empresaId, (itens) => (itens || []).filter((i) => i.id !== m.id)));
      notifySuccess("Medição excluída");
    } catch (erro) {
      notifyError("Erro ao excluir a medição", getApiErrorMessage(erro));
    }
  };

  if (!area?.id) return null;

  const dialogo = (
    <LancLoteDialogo open={aberto} onOpenChange={setAberto} titulo="Medição de Forragem" lotes={area?.nome ? [{ nome: area.nome }] : undefined} largo>
      {aberto ? (
        <FormularioMedicaoForragem
          area={area}
          cultura={cultura}
          hoje={hoje}
          onCancel={() => setAberto(false)}
          onSaved={async () => {
            setAberto(false);
            atualizadas(await getMapaCachedData(CHAVE, empresaId));
          }}
        />
      ) : null}
    </LancLoteDialogo>
  );

  return (
    <section className="mk-dp-forragem" aria-label="Forragem do pasto" data-testid="painel-forragem">
      <TituloBloco link="Medição de Forragem" onLink={() => setAberto(true)}>
        Forragem
      </TituloBloco>
      <Cartao>
        {farol ? (
          // D-PROD-221: o mesmo farol que pinta o pasto no modo "Forragem" do mapa, como linha do v12.
          // D-PROD-223: sem medição válida, o estimado pelos dias de descanso, com a saída do lote e o descanso.
          <Linha
            data-testid="farol-forragem"
            rotulo={farol.rotulo}
            bolinha={farol.cor}
            valor={
              "estimado" in farol ? (
                <span data-testid="farol-forragem-estimado">
                  {`lote saiu há ${diasTexto(farol.diasDesdeSaida)} · descanso ${farol.origemDescanso === "PASTO" ? "do pasto" : "da cultura"} ${diasTexto(farol.diasDescanso)}`}
                </span>
              ) : (
                [
                  farol.dias === null ? null : farol.dias === 0 ? "medido hoje" : `há ${farol.dias} ${farol.dias === 1 ? "dia" : "dias"}`,
                  farol.vencida ? `vencida (mais de ${DIAS_VALIDADE_FORRAGEM} dias)` : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || null
              )
            }
          />
        ) : null}
        {textoParametros ? (
          // D-PROD-223: alturas e descanso que valem para o pasto, e de onde vem cada um.
          <Linha rotulo="Parâmetros de manejo" valor={<span data-testid="parametros-do-pasto">{textoParametros}</span>} quebra />
        ) : null}
        {estimativa?.emPastejo ? (
          <Linha data-testid="forragem-em-pastejo" rotulo="Em pastejo" sub="lote no pasto agora (sem estimativa pelos dias de descanso)" />
        ) : null}
        {ultima ? (
          <Linha
            data-testid="ultima-medicao"
            rotulo={resumoDaMedicao(ultima)}
            sub={ultima.observacoes || null}
            bolinha={ultima.situacao ? COR_SITUACAO[ultima.situacao] : null}
            valor={`${dia(ultima)}${ultima.registrado_por_nome ? ` · ${ultima.registrado_por_nome}` : ""}`}
          />
        ) : (
          <Linha rotulo="Nenhuma medição registrada." />
        )}
        {doPasto.length > 0 ? (
          <ul className="mk-dp-forragem__lista" aria-label="Últimas medições">
            {doPasto.slice(0, 5).map((m) => (
              <li key={m.id}>
                <Linha
                  className="mk-dp-forragem__item"
                  rotulo={dia(m)}
                  sub={m.observacoes || null}
                  bolinha={m.situacao ? COR_SITUACAO[m.situacao] : null}
                  valor={
                    <>
                      {resumoDaMedicao(m)}
                      <Acao tom="perigo" onClick={() => excluir(m)} aria-label={`Excluir a medição de ${dia(m)}`}>
                        Excluir
                      </Acao>
                    </>
                  }
                />
              </li>
            ))}
          </ul>
        ) : null}
      </Cartao>
      {dialogo}
    </section>
  );
}
