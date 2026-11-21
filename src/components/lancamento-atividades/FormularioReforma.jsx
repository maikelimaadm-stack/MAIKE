import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";
import B1Janela from "@/components/cadastro/base1/B1Janela";
import { DENSIDADE_BASE1 } from "@/components/cadastro/base1/B1Field";
import { MobileSheetPortalCtx, useCelular } from "@/components/common/MobileSheet";
import { CampoSelect, SecaoForm } from "@/components/gestao/GestaoFormParts";
import { CampoDia, ValorCalculado } from "@/components/financeiroGestao/CamposLancamento";
import { BOTAO_PRIMARIO, BOTAO_SECUNDARIO } from "@/components/patrimonio/DialogosAbastecimento";
import { SecoesDoFormularioContext } from "@/components/lancamento-atividades/JanelasDaLinha";
import AreasDoRegistro from "@/components/lancamento-atividades/AreasDoRegistro";
import { useEmpresaRealSelecionadaId } from "@/hooks/useLancamentoAtividadesSessao";
import { RAIZ_CONSULTAS_ATIVIDADES } from "@/lib/atividadeApontamentoRegras";
import { capinsDoCadastro, dicaDaCultura, safraDoDia } from "@/lib/camposPorTipo";
import { mensagemDeErroAtividade } from "@/lib/lancamentoAtividadesRegras";
import { notifyInfo, notifySuccess } from "@/lib/maikeNotify";
import { corpoDasAreasDoRegistro, errosDasAreasDoRegistro } from "@/lib/registroDeCampoRegras";
import { TIPOS_DE_REFORMA, corpoDaReforma, nomeSugeridoDaReforma, textosDaNatureza } from "@/lib/reformaRegras";
import { listarCulturas } from "@/services/culturaCadastroService";
import { planejarReforma } from "@/services/lancamentoAtividadesService";
import { ehResultadoIncerto } from "@/services/operacaoFinanceiraService";

const NOTA = "mt-1 min-w-0 break-words px-1 text-[12px] text-[var(--mg-text-2,#475569)]";

/**
 * MAIKE-ENTREGA3 (D-PROD-275) — o "Planejar" da REFORMA DE PASTAGEM (o agrupador): só 4 campos, nesta ordem —
 *  1. Áreas (a mesma tabela da Nova realização: Área · Tamanho · % · Hectares, com o Total; os hectares de cada área são o
 *     divisor do R$/ha);
 *  2. Tipo: Reforma de pastagem, Formação de pasto novo ou Outro;
 *  3. Capim que vai ficar (opcional, do Cadastro de Culturas), com "(recuperação: mesmo capim)" ou "(renovação: troca de
 *     capim)" ao lado, comparando com o capim de hoje de cada área;
 *  4. Início previsto (pode ser futuro).
 * O nome é sugerido sozinho ("Reforma · PASTO DA AROEIRA · 2026/27": a safra é o ano agrícola do início, de julho a
 * junho) e mostrado só para leitura; quem grava o nome é o servidor, com a mesma regra. Um envio só (`POST
 * /planejamentos`); a recusa fica na janela; sem resposta, avisa para conferir a lista antes de repetir.
 *
 * @param {{ areas: any[], hoje: string, onFechar: () => void, onCriada: (reforma: any) => void }} props
 *   `areas`: as áreas da fazenda (com `cultura_id`, o capim de hoje); infraestrutura fica de fora (a página filtra).
 */
export default function FormularioReforma({ areas, hoje, onFechar, onCriada }) {
  const celular = useCelular();
  const [linhas, setLinhas] = useState(/** @type {import("@/lib/registroDeCampoRegras").AreaDoRegistro[]} */ ([]));
  const [tipo, setTipo] = useState("REFORMA");
  const [capimId, setCapimId] = useState("");
  const [inicio, setInicio] = useState(hoje || "");
  const [erros, setErros] = useState(/** @type {Record<string, string>} */ ({}));
  const [aviso, setAviso] = useState(/** @type {string|null} */ (null));
  const [enviando, setEnviando] = useState(false);
  const [alvoFolha, setAlvoFolha] = useState(/** @type {HTMLElement | null} */ (null));

  const empresaId = useEmpresaRealSelecionadaId();
  // O mesmo cache do capim da Nova realização (Plantio de pastagem).
  const culturasLidas = useQuery({
    queryKey: [RAIZ_CONSULTAS_ATIVIDADES, "culturas", empresaId],
    queryFn: () => listarCulturas(String(empresaId)),
    enabled: Boolean(empresaId),
    staleTime: 60 * 1000,
  });
  const culturas = useMemo(() => (Array.isArray(culturasLidas.data) ? culturasLidas.data : []), [culturasLidas.data]);
  const capins = useMemo(() => capinsDoCadastro(culturas), [culturas]);
  const capim = capins.find((c) => String(c.id) === String(capimId)) ?? null;

  const areaDe = (/** @type {string} */ id) => areas.find((a) => String(a?.id) === String(id)) ?? null;
  const escolhidas = /** @type {any[]} */ (linhas.map((l) => areaDe(l.area_id)).filter(Boolean));
  const nome = nomeSugeridoDaReforma(tipo, escolhidas.map((a) => String(a.nome ?? "")), inicio);
  const naturezas = textosDaNatureza(capimId || null, escolhidas.map((a) => ({ nome: a.nome, cultura_id: a.cultura_id ?? null })));
  const safra = safraDoDia(inicio);

  /** @param {string[]} campos */
  const limpar = (campos) => setErros((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !campos.some((c) => k === c || k.startsWith(`${c}:`)))));

  const salvar = async () => {
    if (enviando) return;
    /** @type {Record<string, string>} */
    const e = { ...errosDasAreasDoRegistro(linhas) };
    if (!tipo) e.tipo = "Escolha o tipo.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio)) e.inicio = "Informe o início previsto.";
    setErros(e);
    if (Object.keys(e).length) return;
    setEnviando(true);
    setAviso(null);
    try {
      const criada = /** @type {any} */ (await planejarReforma(corpoDaReforma({ tipo, areas: corpoDasAreasDoRegistro(linhas), capimId, inicio })));
      notifySuccess("Sucesso", `${criada?.nome ?? "Reforma"} planejada. As realizações destas áreas entram nela sozinhas.`);
      onCriada(criada);
    } catch (falha) {
      if (ehResultadoIncerto(falha)) {
        notifyInfo("Resultado incerto", "Não recebemos a resposta do servidor: a reforma PODE ter sido criada. Confira o filtro Reforma antes de repetir.");
        setAviso("Não recebemos a resposta do servidor: a reforma PODE ter sido criada. Feche e confira o filtro Reforma da lista antes de repetir.");
      } else {
        setAviso(mensagemDeErroAtividade(falha, "Não foi possível planejar a reforma. Nada foi gravado."));
      }
    } finally {
      setEnviando(false);
    }
  };

  return (
    <B1Janela
      aberto
      onFechar={onFechar}
      podeFechar={!enviando}
      aoPedirFechar={() => !alvoFolha?.querySelector(".mk-sheet-root")}
      titulo={<span data-testid="formulario-reforma-titulo">Planejar reforma de pastagem</span>}
      testId="formulario-reforma"
      className={`b1-realizacao b1-reforma-form${celular ? " b1-janela--tela-cheia" : ""}`}
      contentProps={{ "data-permissao-explicita": "", "data-celular": celular ? "" : undefined, className: celular ? "b1-janela__camada--tela-cheia" : undefined }}
      fora={<div ref={setAlvoFolha} className="contents" />}
      rodape={
        <>
          <button type="button" className={BOTAO_SECUNDARIO} onClick={onFechar} disabled={enviando} data-testid="formulario-reforma-cancelar">
            Cancelar
          </button>
          <button type="button" className={BOTAO_PRIMARIO} onClick={() => void salvar()} disabled={enviando} data-testid="formulario-reforma-salvar">
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
            {enviando ? "Salvando…" : "Planejar reforma"}
          </button>
        </>
      }
    >
      <MobileSheetPortalCtx.Provider value={alvoFolha}>
        <form
          className="b1 mg-b1-form-grid b1-form-embutido"
          data-densidade={DENSIDADE_BASE1}
          noValidate
          onSubmit={(ev) => {
            ev.preventDefault();
            void salvar();
          }}
          data-testid="formulario-reforma-form"
        >
          <SecoesDoFormularioContext.Provider value={{ topo: null, opcional: true }}>
            <SecaoForm titulo="Áreas" />
            <AreasDoRegistro
              areasDoMapa={areas}
              linhas={linhas}
              onChange={(ls) => {
                setLinhas(ls);
                limpar(["areas", "area", "pct"]);
                setAviso(null);
              }}
              erros={erros}
              celular={celular}
              readOnly={enviando}
              palavraDosHectares="na reforma"
            />

            <SecaoForm titulo="A reforma" />
            <CampoSelect
              label="Tipo"
              value={tipo}
              onChange={(v) => {
                setTipo(v);
                limpar(["tipo"]);
              }}
              options={TIPOS_DE_REFORMA.map((t) => ({ value: t.value, label: t.label }))}
              readOnly={enviando}
              required
              span={12}
              error={erros.tipo}
            />
            <CampoSelect
              label="Capim que vai ficar"
              value={capimId}
              onChange={(v) => setCapimId(v)}
              options={capins.map((c) => ({ value: String(c.id), label: String(c.nome ?? "") }))}
              placeholder={capins.length ? "Ainda não sei (opcional)" : culturasLidas.isLoading ? "Lendo o cadastro…" : "Nenhum capim no cadastro"}
              readOnly={enviando}
              span={12}
              dica={
                <div className={NOTA} data-testid="formulario-reforma-capim-dica">
                  {capim ? <span className="block">{dicaDaCultura(capim)}</span> : <span className="block">opcional · do cadastro de culturas</span>}
                  {naturezas.map((t) => (
                    <span key={t} className="block font-medium text-[var(--mg-text-1,#1f2937)]" data-testid="formulario-reforma-natureza">
                      {t}
                    </span>
                  ))}
                </div>
              }
            />
            <CampoDia
              label="Início previsto"
              value={inicio}
              onChange={(v) => {
                setInicio(v || "");
                limpar(["inicio"]);
              }}
              readOnly={enviando}
              required
              span={6}
              error={erros.inicio}
              testId="formulario-reforma-inicio"
            />
            <ValorCalculado label="Safra" valor={safra || "—"} span={6} testId="formulario-reforma-safra" dica={<p className={NOTA}>preenchida pelo início (julho a junho)</p>} />

            <SecaoForm titulo="Nome" />
            <p className="col-span-12 min-w-0 break-words text-[13px] text-[var(--mg-text-1,#1f2937)]" data-testid="formulario-reforma-nome">
              {nome ? <strong>{nome}</strong> : <span className="text-[var(--mg-text-2,#475569)]">Escolha a área e o início: o nome sai sozinho.</span>}
            </p>
            <p className="col-span-12 -mt-1 min-w-0 break-words text-[12px] text-[var(--mg-text-2,#475569)]">
              Cada realização destas áreas (calcário, preparo, plantio…) entra nesta reforma sozinha, e o filtro Reforma da lista mostra o custo total e o R$/ha.
            </p>
            {aviso ? (
              <p className="col-span-12 text-[12.5px] text-amber-800" role="alert" data-testid="formulario-reforma-erro">
                {aviso}
              </p>
            ) : null}
          </SecoesDoFormularioContext.Provider>
        </form>
      </MobileSheetPortalCtx.Provider>
    </B1Janela>
  );
}
