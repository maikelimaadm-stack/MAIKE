import React, { useState } from "react";
import { Check, ChevronLeft, Play, X } from "lucide-react";
import { AvisoGestao } from "@/components/gestao/GestaoFormParts";
import { Selo } from "@/components/financeiroGestao/ConsultaLancamento";
import DialogoAreaDaAtividade from "@/components/lancamento-atividades/DialogoAreaDaAtividade";
import JanelaAbastecimentoDaArea from "@/components/lancamento-atividades/JanelaAbastecimentoDaArea";
import { useEmpresaRealSelecionadaId, useFusoDaFazenda } from "@/hooks/useLancamentoAtividadesSessao";
import { useAcoesTelaAbastecimento } from "@/hooks/usePatrimonioSessao";
import { BOTAO_PRIMARIO, BOTAO_SECUNDARIO } from "@/components/patrimonio/DialogosAbastecimento";
import {
  CHAVE_DO_SELO_AREA,
  STATUS_AREA,
  areasDaAtividade,
  linhaDaAreaParaExibir,
  rotuloDaAreaDaAtividade,
  temAreas,
  totaisDaArea,
} from "@/lib/atividadeAreasRegras";
import { LINHA_MAQUINA, formatarMoedaAtividade, formatarQuantidadeLinha } from "@/lib/atividadeLinhasRegras";
import {
  REGISTRO_ABASTECIMENTO,
  REGISTRO_IMPLEMENTO,
  fraseDoRegistro,
  movimentosDaArea,
  opcoesDeRegistro,
  registroDoDiaParaAbastecer,
  rotuloDaAreaNoCampo,
  textoProgressoAreas,
} from "@/lib/atividadeFluxoCampo";
import { formatarAreaExecutadaPlanejada, formatarDiaAtividade, rotuloDaArea } from "@/lib/lancamentoAtividadesRegras";

// Os botões são os de sempre do app (os mesmos dos formulários de lançamento): nada de botão gigante só para celular.
const BOTAO = BOTAO_PRIMARIO;
const BOTAO_CLARO = BOTAO_SECUNDARIO;

/**
 * A atividade pelo lugar do custo: um cartão por área, o registro saindo dali,
 * e a confirmação dizendo em qual área entrou (D-PROD-251).
 *
 * @param {{
 *   atividade: any,
 *   totais: any,
 *   lendoTotais: boolean,
 *   apontamentos: any[],
 *   podeLancar: boolean,
 *   podeGerir: boolean,
 *   flags: { permiteProduto?: boolean, permiteImplemento?: boolean, permiteMaoObra?: boolean, permiteServico?: boolean },
 *   onLancar: (tipo: string, aba: 'lista'|'dados', areaId: string|null) => void,
 *   onGravouAbastecimento?: (recado: { texto: string, areaId: string|null, nomeArea: string, nomeAtividade: string }) => void,
 *   onAtividadeAtualizada: (atividade: any) => void,
 *   onAbrirAjustes: (areaId: string|null) => void,
 *   recado: { texto: string, areaId: string|null, nomeArea: string, nomeAtividade: string } | null,
 *   onLimparRecado: () => void,
 *   telaInicial?: { nome: 'cartoes' } | { nome: 'area', id: string|null } | { nome: 'escolher', id: string|null } | null,
 * }} props
 */
export default function FluxoPorArea({
  atividade,
  totais,
  lendoTotais,
  apontamentos,
  podeLancar,
  podeGerir,
  flags,
  onLancar,
  onGravouAbastecimento = () => {},
  onAtividadeAtualizada,
  onAbrirAjustes,
  recado,
  onLimparRecado,
  telaInicial = null,
}) {
  const comAreas = temAreas(atividade);
  const [tela, setTela] = useState(/** @type {{ nome: 'cartoes' } | { nome: 'area', id: string|null } | { nome: 'escolher', id: string|null }} */ (telaInicial ?? { nome: "cartoes" }));
  const [dialogo, setDialogo] = useState(/** @type {any|null} */ (null));
  const [avisoCombustivel, setAvisoCombustivel] = useState("");
  const [abastecendo, setAbastecendo] = useState(/** @type {{ apontamento: any, areaId: string|null } | null} */ (null));
  const empresaId = useEmpresaRealSelecionadaId();
  const { hoje } = useFusoDaFazenda(empresaId);
  const acoesAbastecimento = useAcoesTelaAbastecimento();
  const podeAbastecer = acoesAbastecimento.ver === true && acoesAbastecimento.criar === true;

  const areas = areasDaAtividade(atividade);
  const nomeDa = (/** @type {string|null} */ id) => {
    if (!id) return rotuloDaArea(atividade?.area) || "esta atividade";
    return rotuloDaAreaDaAtividade(areas.find((a) => String(a.id) === String(id))) || "esta área";
  };

  /** @param {string} id @param {string|null} areaId */
  const escolher = (id, areaId) => {
    if (id === REGISTRO_ABASTECIMENTO) {
      const registro = registroDoDiaParaAbastecer(apontamentos, areaId, hoje || "");
      if (!registro) {
        setAvisoCombustivel("Para registrar o abastecimento, registre antes uma máquina neste lugar.");
        return;
      }
      setAvisoCombustivel("");
      setAbastecendo({ apontamento: registro, areaId });
      return;
    }
    if (id === REGISTRO_IMPLEMENTO) {
      onLancar(LINHA_MAQUINA, "dados", areaId);
      return;
    }
    onLancar(id, "dados", areaId);
  };

  // A confirmação é um aviso no alto da área (como os avisos das outras telas), não uma tela à parte.
  // "Escolher" é a mesma tela da área: "O que você quer registrar?" fica ali, junto do que já foi feito.
  const telaAtual = recado && tela.nome === "cartoes" && recado.areaId ? { nome: "area", id: recado.areaId } : tela;
  const tela_ = telaAtual.nome === "escolher" ? { nome: "area", id: telaAtual.id } : telaAtual;
  const fecharRecado = () => {
    if (recado && tela.nome === "cartoes" && recado.areaId) setTela({ nome: "area", id: recado.areaId });
    onLimparRecado();
  };
  const avisoRecado = recado ? (
    <AvisoGestao tone="blue" testId="registro-confirmado">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-[13px]" data-testid="registro-confirmado-frase">
          {fraseDoRegistro({ texto: recado.texto, area: recado.nomeArea, atividade: recado.nomeAtividade })}
        </p>
        <button type="button" className={BOTAO_CLARO} onClick={fecharRecado} aria-label="Fechar o aviso" data-testid="registro-voltar-area">
          <X className="h-4 w-4" aria-hidden /> Fechar
        </button>
      </div>
    </AvisoGestao>
  ) : null;

  if (tela_.nome === "area") {
    const area = tela_.id ? areas.find((a) => String(a.id) === String(tela_.id)) : null;
    const numeros = tela_.id ? totaisDaArea(totais, tela_.id) : null;
    const linha = area ? linhaDaAreaParaExibir(area, numeros) : null;
    const nome = nomeDa(tela_.id);
    const custoTipo = numeros?.custo_por_tipo ?? totais?.custo_por_tipo ?? null;
    const grupos = movimentosDaArea(apontamentos, tela_.id, custoTipo);
    const combustivel = numeros?.combustivel ?? totais?.combustivel ?? null;
    const custoCombustivel = formatarMoedaAtividade(custoTipo?.combustivel) || "";
    const podeRegistrar = podeLancar && (!area || area.status === STATUS_AREA.EM_ANDAMENTO);
    const feita = linha ? linha.feita : formatarAreaExecutadaPlanejada(atividade) ? `${formatarAreaExecutadaPlanejada(atividade)} ha` : "—";
    return (
      <section className="min-w-0" data-testid="detalhe-area">
        <button type="button" className="mb-2 inline-flex min-h-11 items-center gap-1 text-[13px] font-semibold text-emerald-800" onClick={() => {
            setTela({ nome: "cartoes" });
            if (recado) onLimparRecado();
          }}>
          <ChevronLeft className="h-4 w-4" aria-hidden /> Áreas
        </button>
        {avisoRecado}
        <h2 className="text-lg font-semibold" data-testid="detalhe-area-nome">
          {nome}
        </h2>
        <p className="mb-3 text-[13px] text-[var(--mg-text-2,#475569)]">
          {[String(atividade?.nome ?? ""), feita !== "—" ? feita : "", formatarMoedaAtividade(numeros?.custo_total ?? totais?.custo_total)].filter(Boolean).join(" · ")}
        </p>
        <div className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-[13px] font-medium text-emerald-900" data-testid="detalhe-area-aviso">
          Tudo o que você registrar entra só {comAreas ? `neste lugar (${nome})` : "nesta atividade"}.
        </div>
        <section className="b1-aba-cartao mb-3" aria-label="O que já foi feito aqui">
          <h3 className="mb-2 text-[14px] font-semibold">O que já foi feito aqui</h3>
          {lendoTotais && grupos.length === 0 ? <p className="text-[13px] text-[var(--mg-text-2,#475569)]">Lendo…</p> : null}
          {grupos.length === 0 && !custoCombustivel ? <p className="text-[13px] text-[var(--mg-text-2,#475569)]">Nada registrado aqui ainda.</p> : null}
          <ul className="flex flex-col gap-3">
            {grupos.map((g) => (
              <li key={g.id} data-testid={`grupo-${g.id}`}>
                <div className="flex items-baseline justify-between gap-3 border-b border-[var(--mg-divider,#e2e8f0)] pb-1">
                  <span className="text-[14px] font-semibold">{g.rotulo}</span>
                  <span className="text-[14px] font-semibold tabular-nums" data-testid={`grupo-${g.id}-total`}>
                    {g.total || "—"}
                  </span>
                </div>
                {g.nota ? <p className="pt-1 text-[12px] text-[var(--mg-text-2,#475569)]">{g.nota}</p> : null}
                <ul>
                  {g.itens.map((item) => (
                    <li key={item.id} className="flex items-baseline justify-between gap-3 py-1.5 text-[13px]" data-testid={`movimento-${item.id}`}>
                      <span className="min-w-0">
                        <span className="block font-medium">{item.titulo}</span>
                        {item.detalhe ? <span className="block text-[12px] text-[var(--mg-text-2,#475569)]">{item.detalhe}</span> : null}
                      </span>
                      {item.custo ? <span className="shrink-0 tabular-nums">{item.custo}</span> : null}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
            {custoCombustivel || combustivel?.quantidade_l ? (
              <li data-testid="grupo-abastecimento">
                <div className="flex items-baseline justify-between gap-3 border-b border-[var(--mg-divider,#e2e8f0)] pb-1">
                  <span className="text-[14px] font-semibold">Abastecimento</span>
                  <span className="text-[14px] font-semibold tabular-nums">{custoCombustivel || "—"}</span>
                </div>
                <p className="py-1.5 text-[13px] text-[var(--mg-text-2,#475569)]" data-testid="grupo-abastecimento-quantidade">
                  {[formatarQuantidadeLinha(combustivel?.quantidade_l, "L"), formatarQuantidadeLinha(combustivel?.quantidade_kg, "KG")].filter(Boolean).join(" · ") || "Combustível desta área."}
                </p>
              </li>
            ) : null}
          </ul>
        </section>
        {podeRegistrar ? (
          <section className="b1-aba-cartao mb-3" aria-label="O que você quer registrar?" data-testid="escolher-registro">
            <h3 className="mb-1 text-[14px] font-semibold">O que você quer registrar?</h3>
            <p className="mb-3 text-[12px] text-[var(--mg-text-2,#475569)]">Escolha o tipo e preencha o formulário. Tudo entra só {comAreas ? `em ${nome}` : "nesta atividade"}.</p>
            {avisoCombustivel ? (
              <AvisoGestao testId="aviso-abastecimento">{avisoCombustivel}</AvisoGestao>
            ) : null}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {opcoesDeRegistro(flags, { abastecimento: podeAbastecer }).map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className={`${BOTAO_CLARO} h-auto flex-col items-start justify-start gap-0 py-2 text-left`}
                  onClick={() => escolher(o.id, tela_.id)}
                  data-testid={`escolher-${o.id}`}
                >
                  <span className="text-[13px] font-semibold">{o.rotulo}</span>
                  <span className="text-[12px] font-normal text-[var(--mg-text-2,#475569)]">{o.detalhe}</span>
                </button>
              ))}
            </div>
          </section>
        ) : null}
        <button type="button" className={BOTAO_CLARO} onClick={() => onAbrirAjustes(tela_.id)} data-testid="ajustar-dia">
          Ajustar um dia
        </button>
        {abastecendo ? (
          <JanelaAbastecimentoDaArea
            atividade={atividade}
            apontamento={abastecendo.apontamento}
            nomeArea={nome}
            onFechar={() => setAbastecendo(null)}
            onGravou={(texto) => onGravouAbastecimento({ texto, areaId: abastecendo.areaId, nomeArea: nome, nomeAtividade: String(atividade?.nome ?? "") })}
          />
        ) : null}
      </section>
    );
  }

  const custoTotal = formatarMoedaAtividade(totais?.custo_total);
  const progresso = textoProgressoAreas(atividade);
  const feitaHa = formatarAreaExecutadaPlanejada(atividade);

  /** @param {any} area */
  const cartao = (area) => {
    const id = area?.id != null ? String(area.id) : null;
    const numeros = id ? totaisDaArea(totais, id) : null;
    const linha = area?.id != null ? linhaDaAreaParaExibir(area, numeros) : null;
    const nome = linha?.nome || rotuloDaArea(atividade?.area) || String(atividade?.nome ?? "Atividade");
    const status = area?.status ?? (atividade?.status === "ABERTA" ? STATUS_AREA.EM_ANDAMENTO : atividade?.status === "CONCLUIDA" ? STATUS_AREA.CONCLUIDA : "");
    const emAndamento = !area || status === STATUS_AREA.EM_ANDAMENTO;
    const planejada = area?.status === STATUS_AREA.PLANEJADA;
    const custoDaArea = linha?.custo && linha.custo !== "—" ? linha.custo : lendoTotais ? "…" : linha ? "R$ 0" : formatarMoedaAtividade(totais?.custo_total) || "R$ 0";
    const semHa = (/** @type {string} */ s) => s.replace(/\s*ha$/i, "");
    const feito = linha ? (planejada ? linha.planejada : linha.feita === "—" ? "—" : `${semHa(linha.feita)} de ${linha.planejada}`) : feitaHa ? `${feitaHa} ha` : "—";
    return (
      <article key={id ?? "unica"} className="b1-aba-cartao flex min-w-0 flex-col gap-2 p-3" data-testid={id ? `cartao-area-${id}` : "cartao-area-unica"}>
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-[15px] font-semibold">{nome}</h3>
          {status ? <Selo status={CHAVE_DO_SELO_AREA[status] ?? status} rotulo={rotuloDaAreaNoCampo(status)} /> : null}
        </div>
        <div className="grid grid-cols-2 gap-2 text-[13px]">
          <p>
            <span className="block text-[11px] text-[var(--mg-text-2,#475569)]">{planejada ? "Planejado" : "Feito"}</span>
            <span className="font-semibold tabular-nums">{lendoTotais && !planejada ? "…" : feito}</span>
          </p>
          <p className="text-right">
            <span className="block text-[11px] text-[var(--mg-text-2,#475569)]">Custo desta área</span>
            <span className="font-semibold tabular-nums">{custoDaArea}</span>
          </p>
        </div>
        {planejada && podeGerir ? (
          <button type="button" className={BOTAO} onClick={() => setDialogo(area)} data-testid={`comecar-area-${id}`}>
            <Play className="h-4 w-4" aria-hidden /> Começar esta área
          </button>
        ) : null}
        {emAndamento && podeLancar ? (
          <button type="button" className={BOTAO} onClick={() => setTela({ nome: "area", id })} data-testid={id ? `registrar-area-${id}` : "registrar-area-unica"}>
            Registrar nesta área
          </button>
        ) : null}
        {!planejada ? (
          <button type="button" className="min-h-11 text-left text-[13px] font-semibold text-emerald-800" onClick={() => setTela({ nome: "area", id })} data-testid={id ? `abrir-area-${id}` : "abrir-area-unica"}>
            Ver o que já foi feito
          </button>
        ) : null}
      </article>
    );
  };

  return (
    <section className="min-w-0" data-testid="fluxo-por-area">
      {avisoRecado}
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="fluxo-resumo">
        <p className="b1-aba-cartao px-3 py-2">
          <span className="block text-[11px] text-[var(--mg-text-2,#475569)]">Custo total</span>
          <span className="text-[16px] font-semibold tabular-nums">{lendoTotais ? "…" : custoTotal || "—"}</span>
        </p>
        <p className="b1-aba-cartao px-3 py-2">
          <span className="block text-[11px] text-[var(--mg-text-2,#475569)]">Áreas</span>
          <span className="text-[14px] font-semibold">{progresso || "—"}</span>
        </p>
        <p className="b1-aba-cartao col-span-2 px-3 py-2 sm:col-span-1">
          <span className="block text-[11px] text-[var(--mg-text-2,#475569)]">Desde</span>
          <span className="text-[14px] font-semibold">{formatarDiaAtividade(atividade?.data_inicio) || "—"}</span>
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {comAreas ? areas.map((a) => cartao(a)) : cartao(null)}
      </div>
      {dialogo ? (
        <DialogoAreaDaAtividade
          modo="iniciar"
          atividade={atividade}
          area={dialogo}
          onFechar={() => setDialogo(null)}
          onFeito={(r) => {
            setDialogo(null);
            if (r?.atividade) onAtividadeAtualizada(r.atividade);
          }}
        />
      ) : null}
    </section>
  );
}
