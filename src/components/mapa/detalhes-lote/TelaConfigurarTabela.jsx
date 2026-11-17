import React from "react";
import { createPortal } from "react-dom";
import { Busca, GrupoMarcar, Info, RodapeBotoes } from "@/components/mapa/detalhes-lote/blocos";
import { COLUNAS_PADRAO, SECOES_LOTE, camposDaSecao } from "@/components/mapa/detalhes-lote/catalogo";
import { usePasto, useRodapeProprio } from "@/components/mapa/detalhes-lote/pastoContexto";
import { useColunasLote } from "@/components/mapa/detalhes-lote/preferencias";

/** Minúsculas sem acento, para a busca achar "lotacao" em "Lotação". @param {string} t */
const normalizar = (t) =>
  String(t)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLocaleLowerCase("pt-BR");

/**
 * Tela empilhada "Configurar tabela" (v12): marca as colunas da Lista, por
 * seção. Trabalha num rascunho; "Redefinir" volta o rascunho ao padrão (Alertas,
 * Lotação e Pesagem) e fica na tela; "Aplicar" grava a preferência do usuário
 * (`colunasLote`, D-PROD-135) e volta. Sair sem Aplicar descarta o rascunho.
 * A busca filtra os campos pelo nome; a caixa de cada seção marca/desmarca só os
 * campos que estão aparecendo, e o contador n/N conta só esses.
 */
export function TelaConfigurarTabela() {
  const { escopoPreferencias, voltar, slotRodape } = usePasto();
  const [colunas, gravar] = useColunasLote(escopoPreferencias);
  const [rascunho, setRascunho] = React.useState(() => [...colunas]);
  const [busca, setBusca] = React.useState("");
  useRodapeProprio(true);

  const termo = normalizar(busca.trim());
  const marcadas = new Set(rascunho);
  const grupos = SECOES_LOTE.map((secao) => ({
    secao,
    campos: camposDaSecao(secao).filter((c) => !termo || normalizar(c.rotulo).includes(termo)),
  })).filter((g) => g.campos.length > 0);

  /** @param {string} chave */
  const alternar = (chave) => setRascunho((r) => (r.includes(chave) ? r.filter((k) => k !== chave) : [...r, chave]));

  /** @param {string[]} chaves */
  const alternarGrupo = (chaves) =>
    setRascunho((r) => (chaves.every((k) => r.includes(k)) ? r.filter((k) => !chaves.includes(k)) : [...new Set([...r, ...chaves])]));

  const aplicar = () => {
    gravar(rascunho);
    voltar();
  };

  return (
    <>
      <Info linhas={["Marque as colunas que a tabela mostra.", "As colunas ficam agrupadas por seção: Alertas, Lotação, Pesagem e Identificação."]} />
      <Busca valor={busca} onMudar={setBusca} placeholder="Filtrar" rotulo="Filtrar colunas" />
      {grupos.map((g) => (
        <GrupoMarcar
          key={g.secao}
          titulo={g.secao}
          itens={g.campos.map((c) => ({ chave: c.chave, rotulo: c.rotulo, marcado: marcadas.has(c.chave) }))}
          onAlternar={alternar}
          onAlternarTodos={() => alternarGrupo(g.campos.map((c) => c.chave))}
        />
      ))}
      {slotRodape
        ? createPortal(
            <RodapeBotoes
              itens={[
                { rotulo: "Redefinir", onClick: () => setRascunho([...COLUNAS_PADRAO]) },
                { rotulo: "Aplicar", tom: "verde", onClick: aplicar },
              ]}
            />,
            slotRodape,
          )
        : null}
    </>
  );
}

export default TelaConfigurarTabela;
