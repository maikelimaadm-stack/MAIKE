import React, { useState } from "react";
import { Check, X } from "lucide-react";
import { toast } from "sonner";
import B1Janela from "@/components/cadastro/base1/B1Janela";
import B1Field, { B1_FIELD_CTL_CLS, DENSIDADE_BASE1 } from "@/components/cadastro/base1/B1Field";
import B1Select from "@/components/cadastro/base1/B1Select";
import { atualizarArea, renumerarAreas } from "@/services/mapaService";
import { mensagemErroRenumeracao } from "@/domain/areas/mensagemErroRenumeracao";
import { CORES_DISPONIVEIS } from "@/domain/areas/regrasCadastroArea";

const TITULOS = { setor: "Definir setor", cor: "Definir cor no mapa", renumerar: "Reatribuir códigos" };

const navegadorOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;

/**
 * Ações em lote das áreas selecionadas (D-PROD-174), na janela do motor. Mesma gravação da tabela antiga:
 * setor (id e nome), cor (na área e na geometria) e códigos em sequência pela ordem do nome.
 *
 * @param {{
 *   acao: 'setor' | 'cor' | 'renumerar' | null,
 *   areas: any[],
 *   setores: any[],
 *   onFechar: () => void,
 *   onAplicado: () => void,
 * }} props
 */
export default function AcoesEmLoteAreas({ acao, areas, setores, onFechar, onAplicado }) {
  const [setorId, setSetorId] = useState("");
  const [cor, setCor] = useState(CORES_DISPONIVEIS[4].cor);
  const [inicio, setInicio] = useState("1");
  const [aplicando, setAplicando] = useState(false);

  const aplicar = async () => {
    if (!areas.length) {
      toast.error("Selecione ao menos uma área!");
      return;
    }
    if (acao === "renumerar" && navegadorOffline()) {
      // A renumeração é só online (não tem fila offline): avisa antes de tentar.
      toast.error("Reatribuir códigos precisa de conexão com a internet. Tente de novo quando estiver online.");
      return;
    }
    setAplicando(true);
    try {
      /** @type {Array<() => Promise<unknown>>} */
      let gravacoes = [];
      if (acao === "setor") {
        const setor = setores.find((s) => s.id === setorId);
        if (!setor) {
          toast.error("Selecione um setor válido");
          return;
        }
        gravacoes = areas.map((a) => () => atualizarArea(a.id, { setor_id: setor.id, setor_nome: setor.nome }));
      } else if (acao === "cor") {
        gravacoes = areas.map((a) => () => atualizarArea(a.id, { cor, coordenadas: { coords: a?.coordenadas?.coords || [], cor } }));
      } else if (acao === "renumerar") {
        const primeiro = parseInt(inicio || "1", 10);
        if (Number.isNaN(primeiro)) {
          toast.error("Informe um número inicial válido");
          return;
        }
        const ordenadas = [...areas].sort((a, b) => (a.nome || "").localeCompare(b.nome || ""));
        // Uma operação só, atômica no servidor (POST /areas-pastagem/renumerar): troca 1↔2
        // entre áreas da seleção funciona, e uma recusa não deixa códigos pela metade.
        try {
          await renumerarAreas(ordenadas.map((a, i) => ({ id: a.id, numero_area: String(primeiro + i) })));
        } catch (erro) {
          toast.error(mensagemErroRenumeracao(erro));
          return;
        }
        toast.success("Códigos reatribuídos");
        onAplicado();
        return;
      }
      const resultados = await Promise.allSettled(gravacoes.map((gravar) => gravar()));
      const falhas = resultados.filter((r) => r.status === "rejected").length;
      const certas = resultados.length - falhas;
      if (!falhas) {
        toast.success("Atualizado com sucesso");
        onAplicado();
      } else if (certas) {
        // Parte foi gravada: a lista precisa mostrar o que mudou.
        toast.error(`Atualização parcial: ${certas} ${certas === 1 ? "área atualizada" : "áreas atualizadas"}, ${falhas} com falha.`);
        onAplicado();
      } else {
        toast.error("Falha ao aplicar alterações");
      }
    } catch {
      toast.error("Falha ao aplicar alterações");
    } finally {
      setAplicando(false);
    }
  };

  const desabilitado = aplicando || (acao === "setor" && !setorId) || (acao === "renumerar" && !inicio);

  return (
    <B1Janela
      aberto={Boolean(acao)}
      onFechar={onFechar}
      podeFechar={!aplicando}
      titulo={acao ? TITULOS[acao] : ""}
      descricao={`${areas.length} ${areas.length === 1 ? "área selecionada" : "áreas selecionadas"}.`}
      testId="areas-acao-em-lote"
      rodape={
        <>
          <button type="button" className="tb-btn" onClick={onFechar} disabled={aplicando}>
            <X className="h-4 w-4" aria-hidden />
            Cancelar
          </button>
          <button type="button" className="tb-btn tb-btn-green" onClick={aplicar} disabled={desabilitado}>
            <Check className="h-4 w-4" aria-hidden />
            Aplicar
          </button>
        </>
      }
    >
      <form
        data-densidade={DENSIDADE_BASE1}
        className="b1 mg-b1-form-grid b1-form-embutido"
        onSubmit={(e) => {
          e.preventDefault();
          if (!desabilitado) void aplicar();
        }}
      >
        {acao === "setor" ? (
          <B1Field label="Setor" required span={12} hasValue={Boolean(setorId)}>
            <B1Select
              aria-label="Setor"
              value={setorId}
              onChange={(e) => setSetorId(e.target.value)}
              className={B1_FIELD_CTL_CLS}
              pesquisa="sempre"
              semOpcaoVazia
              maiusculas
            >
              {setores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nome}
                </option>
              ))}
            </B1Select>
          </B1Field>
        ) : null}
        {acao === "cor" ? (
          <div className="col-span-12 grid grid-cols-5 gap-2" role="radiogroup" aria-label="Cor no mapa">
            {CORES_DISPONIVEIS.map((c) => (
              <button
                key={c.cor}
                type="button"
                role="radio"
                aria-checked={cor === c.cor}
                aria-label={c.nome}
                title={c.nome}
                onClick={() => setCor(c.cor)}
                className={`h-9 rounded-lg border border-slate-300 ${cor === c.cor ? "ring-2 ring-emerald-600 ring-offset-1" : ""}`}
                style={{ backgroundColor: c.cor }}
              />
            ))}
          </div>
        ) : null}
        {acao === "renumerar" ? (
          <B1Field label="Número inicial" required span={12} hasValue={Boolean(inicio)}>
            <input
              type="text"
              inputMode="numeric"
              value={inicio}
              onChange={(e) => setInicio(e.target.value.replace(/[^0-9]/g, ""))}
              className={B1_FIELD_CTL_CLS}
            />
          </B1Field>
        ) : null}
      </form>
    </B1Janela>
  );
}
