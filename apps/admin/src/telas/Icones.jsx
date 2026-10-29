/**
 * Ícones oficiais: cadastrar com imagem principal e subícone opcional (dois
 * arquivos distintos), trocar imagem mantendo o MESMO id, cor de fallback,
 * publicar e desativar. As imagens vão sem nenhuma transformação.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { catalogo, enviarArquivo, lerImagem } from '../api.js';
import { Aviso, Botao, Campo, Estado, IdCurto, Miniatura } from '../componentes.jsx';

const usePrevia = (arquivo) => {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!arquivo) return setUrl(null);
    const u = URL.createObjectURL(arquivo);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [arquivo]);
  return url;
};

const limitesTexto = (l) =>
  `${l.mimes.map((m) => m.split('/')[1].toUpperCase()).join(', ')} · até ${Math.round(l.max_bytes / 1024)} KB · SVG não aceito`;

/** Seletor de arquivo com prévia local e checagem antecipada dos limites do backend. */
const EscolherImagem = ({ id, rotulo, limites, arquivo, onArquivo, opcional = false }) => {
  const previa = usePrevia(arquivo);
  const [erro, setErro] = useState('');
  return (
    <Campo rotulo={`${rotulo}${opcional ? ' (opcional)' : ''}`} id={id} dica={limitesTexto(limites)}>
      <input
        id={id}
        type="file"
        accept={limites.mimes.join(',')}
        onChange={async (e) => {
          const f = e.target.files?.[0] ?? null;
          setErro('');
          if (f) {
            try {
              await lerImagem(f, limites);
            } catch (falha) {
              setErro(falha.message);
              e.target.value = '';
              onArquivo(null);
              return;
            }
          }
          onArquivo(f);
        }}
      />
      {previa ? (
        <span className="previa-local">
          <img src={previa} alt={`Prévia: ${rotulo}`} /> <span>{arquivo.name} · {Math.ceil(arquivo.size / 1024)} KB</span>
        </span>
      ) : null}
      <Aviso tipo="erro">{erro}</Aviso>
    </Campo>
  );
};

const NovoIcone = ({ dados, executar }) => {
  const [tipoId, setTipoId] = useState(dados.tipos.find((t) => t.ativo)?.id ?? '');
  const [categoriaId, setCategoriaId] = useState('');
  const [principal, setPrincipal] = useState(null);
  const [sub, setSub] = useState(null);
  const [cor, setCor] = useState('');
  const [publicar, setPublicar] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [chave, setChave] = useState(0);
  const categorias = dados.categorias.filter((c) => c.tipo_id === tipoId && c.ativo);
  const salvar = async (e) => {
    e.preventDefault();
    setOcupado(true);
    try {
      await executar(async () => {
        const a = await enviarArquivo(principal, dados.limites);
        const s = sub ? await enviarArquivo(sub, dados.limites) : null;
        const icone = await catalogo.criarIcone({
          tipo_id: tipoId,
          categoria_id: categoriaId,
          asset_principal_id: a.id,
          asset_subicone_id: s?.id ?? null,
          cor_fallback: cor || null,
        });
        if (publicar) await catalogo.publicarIcone(icone.id);
        return icone;
      }, publicar ? 'Ícone criado e publicado.' : 'Ícone criado como rascunho.');
      setPrincipal(null);
      setSub(null);
      setCor('');
      setCategoriaId('');
      setChave((k) => k + 1);
    } catch {
      /* aviso já exibido */
    } finally {
      setOcupado(false);
    }
  };
  return (
    <details className="painel" open={dados.icones.length === 0}>
      <summary>Novo ícone</summary>
      <form className="formulario grade-2" onSubmit={salvar} key={chave}>
        <Campo rotulo="Tipo" id="novo-tipo">
          <select id="novo-tipo" value={tipoId} onChange={(e) => { setTipoId(e.target.value); setCategoriaId(''); }} required>
            <option value="">Selecione</option>
            {dados.tipos.filter((t) => t.ativo).map((t) => (
              <option key={t.id} value={t.id}>
                {t.nome}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Categoria visual" id="novo-categoria" dica={categorias.length ? '' : 'Crie a categoria em "Tipos e categorias".'}>
          <select id="novo-categoria" value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)} required>
            <option value="">Selecione</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome} ({c.codigo})
              </option>
            ))}
          </select>
        </Campo>
        <EscolherImagem id="novo-principal" rotulo="Imagem principal" limites={dados.limites} arquivo={principal} onArquivo={setPrincipal} />
        <EscolherImagem id="novo-subicone" rotulo="Subícone" opcional limites={dados.limites} arquivo={sub} onArquivo={setSub} />
        <Campo rotulo="Cor de fallback (opcional)" id="novo-cor" dica="Usada só se a imagem não carregar.">
          <span className="linha">
            <input id="novo-cor" type="color" value={cor || '#16a34a'} onChange={(e) => setCor(e.target.value)} />
            {cor ? (
              <button type="button" className="link" onClick={() => setCor('')}>
                sem cor
              </button>
            ) : (
              <span className="campo-dica">sem cor</span>
            )}
          </span>
        </Campo>
        <label className="checagem">
          <input type="checkbox" checked={publicar} onChange={(e) => setPublicar(e.target.checked)} /> Publicar em seguida
        </label>
        <div className="acoes">
          <Botao type="submit" ocupado={ocupado} disabled={!principal || !categoriaId}>
            Criar ícone
          </Botao>
        </div>
      </form>
    </details>
  );
};

const Cartao = ({ icone, categoria, tipo, dados, executar }) => {
  const principalRef = useRef(null);
  const subRef = useRef(null);
  const [cor, setCor] = useState(icone.cor_fallback ?? '');
  const [ocupado, setOcupado] = useState(false);
  const rodar = async (fn, msg) => {
    setOcupado(true);
    try {
      await executar(fn, msg);
    } catch {
      /* aviso já exibido */
    } finally {
      setOcupado(false);
    }
  };
  const trocar = (campo) => async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    await rodar(async () => {
      const a = await enviarArquivo(f, dados.limites);
      return catalogo.atualizarIcone(icone.id, { [campo]: a.id });
    }, campo === 'asset_principal_id' ? 'Imagem principal trocada (mesmo id do ícone).' : 'Subícone atualizado.');
  };
  return (
    <article className="cartao" data-testid="cartao-icone" data-icone-id={icone.id} data-estado={icone.estado}>
      <div className="cartao-imagens">
        <Miniatura url={icone.asset_principal?.public_url} rotulo={`Principal de ${categoria?.nome}`} cor={icone.cor_fallback} />
        <Miniatura url={icone.asset_subicone?.public_url} rotulo={`Subícone de ${categoria?.nome}`} />
      </div>
      <div className="cartao-corpo">
        <h3>{categoria?.nome ?? 'Categoria removida'}</h3>
        <p className="cartao-meta">
          {tipo?.nome} · <code>{categoria?.codigo}</code>
        </p>
        <p className="cartao-meta">
          <Estado estado={icone.estado} /> rev. {icone.revisao} · id <IdCurto id={icone.id} />
        </p>
        {icone.asset_principal ? (
          <p className="cartao-meta">
            {icone.asset_principal.mime.split('/')[1].toUpperCase()} · {Math.ceil(icone.asset_principal.bytes / 1024)} KB
            {icone.asset_principal.largura ? ` · ${icone.asset_principal.largura}×${icone.asset_principal.altura}px` : ''}
          </p>
        ) : null}
      </div>
      <div className="cartao-acoes">
        <input ref={principalRef} type="file" hidden accept={dados.limites.mimes.join(',')} onChange={trocar('asset_principal_id')} aria-label="Nova imagem principal" />
        <input ref={subRef} type="file" hidden accept={dados.limites.mimes.join(',')} onChange={trocar('asset_subicone_id')} aria-label="Novo subícone" />
        <Botao variante="secundario" ocupado={ocupado} onClick={() => principalRef.current?.click()}>
          Trocar imagem
        </Botao>
        <Botao variante="secundario" ocupado={ocupado} onClick={() => subRef.current?.click()}>
          {icone.asset_subicone ? 'Trocar subícone' : 'Adicionar subícone'}
        </Botao>
        {icone.asset_subicone ? (
          <Botao variante="secundario" ocupado={ocupado} onClick={() => rodar(() => catalogo.atualizarIcone(icone.id, { asset_subicone_id: null }), 'Subícone removido.')}>
            Remover subícone
          </Botao>
        ) : null}
        <span className="linha">
          <input type="color" aria-label="Cor de fallback" value={cor || '#16a34a'} onChange={(e) => setCor(e.target.value)} />
          <Botao
            variante="secundario"
            ocupado={ocupado}
            disabled={(cor || null) === (icone.cor_fallback ?? null)}
            onClick={() => rodar(() => catalogo.atualizarIcone(icone.id, { cor_fallback: cor || null }), 'Cor atualizada.')}
          >
            Salvar cor
          </Botao>
        </span>
        {icone.estado !== 'publicado' ? (
          <Botao ocupado={ocupado} onClick={() => rodar(() => catalogo.publicarIcone(icone.id), 'Ícone publicado: os clientes passam a vê-lo.')}>
            Publicar
          </Botao>
        ) : null}
        {icone.estado !== 'inativo' ? (
          <Botao
            variante="perigo"
            ocupado={ocupado}
            onClick={() => {
              if (window.confirm('Desativar este ícone? Ele sai da leitura dos clientes; o registro e as imagens ficam guardados.')) {
                rodar(() => catalogo.desativarIcone(icone.id), 'Ícone desativado.');
              }
            }}
          >
            Desativar
          </Botao>
        ) : null}
      </div>
    </article>
  );
};

export default function Icones({ dados, executar }) {
  const [tipo, setTipo] = useState('');
  const [estado, setEstado] = useState('');
  const [busca, setBusca] = useState('');
  const catPorId = useMemo(() => new Map(dados.categorias.map((c) => [c.id, c])), [dados]);
  const tipoPorId = useMemo(() => new Map(dados.tipos.map((t) => [t.id, t])), [dados]);
  const termo = busca.trim().toLowerCase();
  const lista = dados.icones.filter((i) => {
    const c = catPorId.get(i.categoria_id);
    return (
      (!tipo || i.tipo_id === tipo) &&
      (!estado || i.estado === estado) &&
      (!termo || `${c?.nome} ${c?.codigo} ${i.id}`.toLowerCase().includes(termo))
    );
  });
  return (
    <section aria-labelledby="titulo-icones">
      <div className="cabecalho-secao">
        <h2 id="titulo-icones">Ícones oficiais</h2>
        <p className="texto-apoio">
          Revisão do catálogo: <strong>{dados.revisao}</strong>. Publicar atualiza o MAIKE dos clientes em até 1 minuto, sem deploy.
        </p>
      </div>
      {dados.tipos.length === 0 ? (
        <Aviso tipo="info">Comece criando um tipo (ex.: "lote") e as categorias em "Tipos e categorias".</Aviso>
      ) : (
        <NovoIcone dados={dados} executar={executar} />
      )}
      <div className="filtros">
        <Campo rotulo="Tipo" id="filtro-tipo">
          <select id="filtro-tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="">Todos</option>
            {dados.tipos.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nome}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Estado" id="filtro-estado">
          <select id="filtro-estado" value={estado} onChange={(e) => setEstado(e.target.value)}>
            <option value="">Todos</option>
            <option value="rascunho">Rascunho</option>
            <option value="publicado">Publicado</option>
            <option value="inativo">Inativo</option>
          </select>
        </Campo>
        <Campo rotulo="Pesquisar" id="filtro-busca">
          <input id="filtro-busca" type="search" placeholder="categoria, código ou id" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </Campo>
      </div>
      {lista.length === 0 ? (
        <p className="vazio">{dados.icones.length ? 'Nenhum ícone com esses filtros.' : 'Nenhum ícone cadastrado ainda.'}</p>
      ) : (
        <div className="grade-cartoes">
          {lista.map((i) => (
            <Cartao key={`${i.id}:${i.revisao}`} icone={i} categoria={catPorId.get(i.categoria_id)} tipo={tipoPorId.get(i.tipo_id)} dados={dados} executar={executar} />
          ))}
        </div>
      )}
    </section>
  );
}
