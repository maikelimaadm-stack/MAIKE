/**
 * Clientes da plataforma — consulta SOMENTE LEITURA (MAIKE-SAAS-ADMIN-S01).
 *
 * Lista paginada com busca e ficha do cliente (identidade, contagens, empresas
 * e usuários). Não há botão de editar, ativar, excluir nem "entrar como
 * cliente": o MAIKE Admin não abre sessão de fazenda e não altera dados.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, mensagemDeErro } from '../api.js';
import { Aviso, Botao, Campo, Carregando, IdCurto } from '../componentes.jsx';

const data = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—');
const Situacao = ({ ativo }) => <span className={`estado ${ativo ? 'estado-publicado' : 'estado-inativo'}`}>{ativo ? 'Ativo' : 'Inativo'}</span>;

/** Lista paginada de um tipo de filho do cliente (usuários ou empresas). */
function ListaDoCliente({ titulo, carregar, colunas, linha, vazio }) {
  const [pagina, setPagina] = useState(null);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const buscar = useCallback(
    async (cursor) => {
      setOcupado(true);
      setErro('');
      try {
        const r = await carregar(cursor);
        setPagina((atual) => (cursor && atual ? { ...r, total: atual.total, items: [...atual.items, ...r.items] } : r));
      } catch (e) {
        setErro(mensagemDeErro(e));
      } finally {
        setOcupado(false);
      }
    },
    [carregar]
  );

  useEffect(() => {
    setPagina(null);
    buscar(null);
  }, [buscar]);

  return (
    <div className="painel">
      <h3>
        {titulo}
        {pagina ? ` (${pagina.total ?? pagina.items.length})` : ''}
      </h3>
      <Aviso tipo="erro">{erro}</Aviso>
      {erro && !pagina ? (
        <Botao variante="secundario" onClick={() => buscar(null)}>
          Tentar novamente
        </Botao>
      ) : !pagina ? (
        <Carregando />
      ) : pagina.items.length === 0 ? (
        <p className="vazio">{vazio}</p>
      ) : (
        <div className="tabela-rolavel">
          <table>
            <thead>
              <tr>
                {colunas.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>{pagina.items.map(linha)}</tbody>
          </table>
        </div>
      )}
      {pagina?.has_more ? (
        <Botao variante="secundario" ocupado={ocupado} onClick={() => buscar(pagina.next_cursor)}>
          Carregar mais
        </Botao>
      ) : null}
    </div>
  );
}

function FichaCliente({ id, onFechar }) {
  const [ficha, setFicha] = useState(null);
  const [erro, setErro] = useState('');
  const atual = useRef(id);

  const carregar = useCallback(async () => {
    setFicha(null);
    setErro('');
    try {
      const r = await api.cliente(id);
      // Troca rápida de cliente: resposta atrasada de outro id é descartada.
      if (atual.current === id) setFicha(r);
    } catch (e) {
      if (atual.current === id) setErro(mensagemDeErro(e));
    }
  }, [id]);

  useEffect(() => {
    atual.current = id;
    carregar();
  }, [id, carregar]);

  const usuarios = useCallback((cursor) => api.usuariosDoCliente(id, cursor), [id]);
  const empresas = useCallback((cursor) => api.empresasDoCliente(id, cursor), [id]);

  return (
    <section className="painel" aria-labelledby="titulo-ficha" data-testid="ficha-cliente">
      <div className="cabecalho-secao">
        <h2 id="titulo-ficha">{ficha ? ficha.cliente.nome : 'Ficha do cliente'}</h2>
        <Botao variante="secundario" onClick={onFechar}>
          Fechar ficha
        </Botao>
      </div>
      <Aviso tipo="info">Consulta administrativa: somente leitura. Daqui não se entra na conta do cliente nem se altera nenhum dado.</Aviso>
      <Aviso tipo="erro">{erro}</Aviso>
      {erro ? (
        <Botao variante="secundario" onClick={carregar}>
          Tentar novamente
        </Botao>
      ) : !ficha ? (
        <Carregando texto="Carregando ficha…" />
      ) : (
        <>
          <dl className="ficha-dados">
            <div>
              <dt>Código</dt>
              <dd>{ficha.cliente.codigo}</dd>
            </div>
            <div>
              <dt>Situação</dt>
              <dd>
                <Situacao ativo={ficha.cliente.ativo} />
              </dd>
            </div>
            <div>
              <dt>Cadastrado em</dt>
              <dd>{data(ficha.cliente.criado_em)}</dd>
            </div>
            <div>
              <dt>Atualizado em</dt>
              <dd>{data(ficha.cliente.atualizado_em)}</dd>
            </div>
            <div>
              <dt>Usuários</dt>
              <dd>
                {ficha.contagens.usuarios} ({ficha.contagens.usuarios_ativos} ativos)
              </dd>
            </div>
            <div>
              <dt>Empresas</dt>
              <dd>{ficha.contagens.empresas}</dd>
            </div>
            <div>
              <dt>Identificador</dt>
              <dd>
                <IdCurto id={ficha.cliente.id} />
              </dd>
            </div>
          </dl>
          <ListaDoCliente
            key={`e-${id}`}
            titulo="Empresas"
            carregar={empresas}
            colunas={['Nº', 'Apelido', 'Nome', 'Cadastrada em']}
            vazio="Nenhuma empresa cadastrada."
            linha={(e) => (
              <tr key={e.id}>
                <td>{e.numero_empresa}</td>
                <td>{e.apelido}</td>
                <td>{e.nome}</td>
                <td>{data(e.criado_em)}</td>
              </tr>
            )}
          />
          <ListaDoCliente
            key={`u-${id}`}
            titulo="Usuários"
            carregar={usuarios}
            colunas={['Nome', 'Login', 'Situação', 'Cadastrado em']}
            vazio="Nenhum usuário cadastrado."
            linha={(u) => (
              <tr key={u.id} className={u.ativo ? undefined : 'linha-inativa'}>
                <td>{u.nome}</td>
                <td>{u.login}</td>
                <td>
                  <Situacao ativo={u.ativo} />
                </td>
                <td>{data(u.criado_em)}</td>
              </tr>
            )}
          />
        </>
      )}
    </section>
  );
}

export default function Clientes() {
  const [texto, setTexto] = useState('');
  const [situacao, setSituacao] = useState('');
  const [filtros, setFiltros] = useState({ q: '', ativo: '' });
  const [pagina, setPagina] = useState(null);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [selecionado, setSelecionado] = useState(null);
  const consultaAtual = useRef(0);

  const buscar = useCallback(
    async (cursor) => {
      const n = ++consultaAtual.current;
      setOcupado(true);
      setErro('');
      try {
        const r = await api.clientes({ q: filtros.q, ativo: filtros.ativo, cursor });
        if (n !== consultaAtual.current) return;
        setPagina((atual) => (cursor && atual ? { ...r, total: atual.total, items: [...atual.items, ...r.items] } : r));
      } catch (e) {
        if (n === consultaAtual.current) setErro(mensagemDeErro(e));
      } finally {
        if (n === consultaAtual.current) setOcupado(false);
      }
    },
    [filtros]
  );

  useEffect(() => {
    setPagina(null);
    buscar(null);
  }, [buscar]);

  const aplicar = (e) => {
    e.preventDefault();
    setSelecionado(null);
    setFiltros({ q: texto.trim(), ativo: situacao });
  };

  return (
    <section aria-labelledby="titulo-clientes">
      <div className="cabecalho-secao">
        <h2 id="titulo-clientes">Clientes</h2>
        <span className="texto-apoio">{pagina && pagina.total !== null ? `${pagina.total} cliente(s)` : ''}</span>
      </div>
      <form className="filtros" onSubmit={aplicar} role="search">
        <Campo rotulo="Buscar por nome ou código" id="busca-cliente">
          <input id="busca-cliente" type="search" value={texto} maxLength={120} onChange={(e) => setTexto(e.target.value)} />
        </Campo>
        <Campo rotulo="Situação" id="situacao-cliente">
          <select id="situacao-cliente" value={situacao} onChange={(e) => setSituacao(e.target.value)}>
            <option value="">Todos</option>
            <option value="true">Ativos</option>
            <option value="false">Inativos</option>
          </select>
        </Campo>
        <div className="campo campo-acao">
          <Botao type="submit">Buscar</Botao>
        </div>
      </form>
      <Aviso tipo="erro">{erro}</Aviso>
      {erro && !pagina ? (
        <div className="vazio">
          <Botao onClick={() => buscar(null)}>Tentar novamente</Botao>
        </div>
      ) : !pagina ? (
        <Carregando texto="Carregando clientes…" />
      ) : pagina.items.length === 0 ? (
        <p className="vazio">{filtros.q || filtros.ativo ? 'Nenhum cliente encontrado com esses filtros.' : 'Nenhum cliente cadastrado.'}</p>
      ) : (
        <div className="painel tabela-rolavel">
          <table data-testid="lista-clientes">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Código</th>
                <th>Situação</th>
                <th>Usuários</th>
                <th>Empresas</th>
                <th>Cadastrado em</th>
                <th>
                  <span className="sr-only">Ficha</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {pagina.items.map((c) => (
                <tr key={c.id} className={c.ativo ? undefined : 'linha-inativa'} aria-current={selecionado === c.id ? 'true' : undefined}>
                  <td>{c.nome}</td>
                  <td>{c.codigo}</td>
                  <td>
                    <Situacao ativo={c.ativo} />
                  </td>
                  <td>{c.usuarios_total}</td>
                  <td>{c.empresas_total}</td>
                  <td>{data(c.criado_em)}</td>
                  <td>
                    <Botao variante="secundario" aria-label={`Ver ficha de ${c.nome}`} onClick={() => setSelecionado(c.id)}>
                      Ver ficha
                    </Botao>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {pagina.has_more ? (
            <Botao variante="secundario" ocupado={ocupado} onClick={() => buscar(pagina.next_cursor)}>
              Carregar mais
            </Botao>
          ) : null}
        </div>
      )}
      {selecionado ? <FichaCliente id={selecionado} onFechar={() => setSelecionado(null)} /> : null}
    </section>
  );
}
