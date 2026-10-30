/**
 * Regras MISTO — regra VISUAL do catálogo: quando um conjunto de categorias
 * aparece junto, qual ícone representa o grupo. Não tem relação com o sexo
 * "Misto" do lote e, enquanto o renderer do mapa estiver congelado, NÃO muda o
 * mapa atual (que segue no legado ConfiguracaoIcone).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { api, catalogo } from '../api.js';
import { Aviso, Botao, Campo, Estado, IdCurto, Miniatura } from '../componentes.jsx';

const FormRegra = ({ dados, regra, onSalvar, onCancelar }) => {
  const [tipoId, setTipoId] = useState(regra?.tipo_id ?? dados.tipos.find((t) => t.ativo)?.id ?? '');
  const [ids, setIds] = useState(regra?.categoria_ids ?? []);
  const [iconeId, setIconeId] = useState(regra?.icone_id ?? '');
  const [prioridade, setPrioridade] = useState(regra?.prioridade ?? 0);
  const [ocupado, setOcupado] = useState(false);
  const categorias = dados.categorias.filter((c) => c.tipo_id === tipoId && c.ativo);
  const icones = dados.icones.filter((i) => i.tipo_id === tipoId && i.estado !== 'inativo');
  const nomeCat = new Map(dados.categorias.map((c) => [c.id, c.nome]));
  const alternar = (id) => setIds((atual) => (atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id]));
  const enviar = async (e) => {
    e.preventDefault();
    setOcupado(true);
    try {
      await onSalvar({ tipo_id: tipoId, categoria_ids: ids, icone_id: iconeId, prioridade: Number(prioridade) });
    } catch {
      /* aviso já exibido */
    } finally {
      setOcupado(false);
    }
  };
  return (
    <form className="formulario" onSubmit={enviar} aria-label={regra ? 'Editar regra MISTO' : 'Nova regra MISTO'}>
      <div className="grade-2">
        <Campo rotulo="Tipo" id="regra-tipo">
          <select id="regra-tipo" value={tipoId} disabled={Boolean(regra)} onChange={(e) => { setTipoId(e.target.value); setIds([]); setIconeId(''); }} required>
            {dados.tipos.filter((t) => t.ativo).map((t) => (
              <option key={t.id} value={t.id}>
                {t.nome}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Prioridade" id="regra-prioridade" dica="Maior vence quando duas regras se aplicam.">
          <input id="regra-prioridade" type="number" min="0" value={prioridade} onChange={(e) => setPrioridade(e.target.value)} />
        </Campo>
      </div>
      <fieldset className="grupo-checagem">
        <legend>Categorias participantes (mínimo 2)</legend>
        {categorias.map((c) => (
          <label key={c.id} className="checagem">
            <input type="checkbox" checked={ids.includes(c.id)} onChange={() => alternar(c.id)} /> {c.nome} <code>{c.codigo}</code>
          </label>
        ))}
      </fieldset>
      <Campo rotulo="Ícone resultado" id="regra-icone" dica="Para publicar a regra, o ícone resultado precisa estar publicado.">
        <select id="regra-icone" value={iconeId} onChange={(e) => setIconeId(e.target.value)} required>
          <option value="">Selecione</option>
          {icones.map((i) => (
            <option key={i.id} value={i.id}>
              {nomeCat.get(i.categoria_id)} — {i.estado} ({i.id.slice(0, 8)})
            </option>
          ))}
        </select>
      </Campo>
      <div className="acoes">
        <Botao type="submit" ocupado={ocupado} disabled={ids.length < 2 || !iconeId}>
          {regra ? 'Salvar regra' : 'Criar regra (rascunho)'}
        </Botao>
        {onCancelar ? (
          <Botao variante="secundario" onClick={onCancelar}>
            Cancelar
          </Botao>
        ) : null}
      </div>
    </form>
  );
};

export default function RegrasMisto({ dados, executar }) {
  const [editando, setEditando] = useState(null);
  const [diagnostico, setDiagnostico] = useState(null);
  const nomeCat = useMemo(() => new Map(dados.categorias.map((c) => [c.id, c.nome])), [dados]);
  const iconePorId = useMemo(() => new Map(dados.icones.map((i) => [i.id, i])), [dados]);
  useEffect(() => {
    api.validacao().then(setDiagnostico, () => setDiagnostico(null));
  }, [dados]);
  const problemasDe = (id) =>
    diagnostico ? [...diagnostico.erros, ...diagnostico.avisos].filter((p) => p.codigo.startsWith('MISTO') && p.ids.includes(id)) : [];
  return (
    <section aria-labelledby="titulo-misto">
      <div className="cabecalho-secao">
        <h2 id="titulo-misto">Regras MISTO</h2>
        <Aviso tipo="info">
          Regra visual do catálogo (qual ícone representa um grupo de categorias). Não é o sexo “Misto” do lote e, por enquanto, não altera
          o mapa atual.
        </Aviso>
      </div>
      <details className="painel">
        <summary>Nova regra</summary>
        <FormRegra dados={dados} onSalvar={(d) => executar(() => catalogo.criarRegra(d), 'Regra criada como rascunho.')} />
      </details>
      {dados.regras_misto.length === 0 ? (
        <p className="vazio">Nenhuma regra MISTO cadastrada.</p>
      ) : (
        <div className="grade-cartoes">
          {dados.regras_misto.map((r) => {
            const icone = iconePorId.get(r.icone_id);
            const problemas = problemasDe(r.id);
            return (
              <article key={`${r.id}:${r.estado}:${r.prioridade}`} className="cartao" data-testid="cartao-regra" data-estado={r.estado}>
                {editando === r.id ? (
                  <FormRegra
                    dados={dados}
                    regra={r}
                    onCancelar={() => setEditando(null)}
                    onSalvar={async ({ tipo_id, ...d }) => {
                      await executar(() => catalogo.atualizarRegra(r.id, d), 'Regra atualizada.');
                      setEditando(null);
                    }}
                  />
                ) : (
                  <>
                    <div className="cartao-imagens">
                      <Miniatura url={icone?.asset_principal?.public_url} rotulo="Ícone resultado" cor={icone?.cor_fallback} />
                    </div>
                    <div className="cartao-corpo">
                      <h3>{r.categoria_ids.map((id) => nomeCat.get(id) ?? id).join(' + ')}</h3>
                      <p className="cartao-meta">
                        <Estado estado={r.estado} /> prioridade {r.prioridade} · especificidade {r.especificidade} · id <IdCurto id={r.id} />
                      </p>
                      {problemas.map((p) => (
                        <p key={p.codigo} className={`problema problema-${diagnostico.erros.includes(p) ? 'erro' : 'aviso'}`}>
                          {p.mensagem}
                        </p>
                      ))}
                    </div>
                    {r.estado !== 'inativo' ? (
                      <div className="cartao-acoes">
                        <Botao variante="secundario" onClick={() => setEditando(r.id)}>
                          Editar
                        </Botao>
                        {r.estado !== 'publicado' ? (
                          <Botao onClick={() => executar(() => catalogo.publicarRegra(r.id), 'Regra publicada.').catch(() => {})}>Publicar</Botao>
                        ) : null}
                        <Botao variante="perigo" onClick={() => executar(() => catalogo.desativarRegra(r.id), 'Regra desativada.').catch(() => {})}>
                          Desativar
                        </Botao>
                      </div>
                    ) : null}
                  </>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
