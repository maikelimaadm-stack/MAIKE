/**
 * Clientes da plataforma (MAIKE-SAAS-ADMIN-S01 consulta; S03 gestão).
 *
 * Lista paginada com busca e ficha do cliente (identidade, contagens, empresas
 * e usuários). A S03 acrescenta: cadastrar cliente com o primeiro
 * administrador (senha temporária mostrada UMA vez), editar nome/código e
 * suspender/reativar com justificativa. Não existe exclusão nem "entrar como
 * cliente": o MAIKE Admin não abre sessão de fazenda.
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

/** Sugestão de código a partir do nome: "Fazenda São João" → "fazenda-sao-joao". */
export const sugerirCodigo = (nome) =>
  String(nome || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');

/**
 * Mostra a senha temporária UMA vez. Fica só neste estado de React: não vai
 * para aviso, storage, URL nem log; some ao confirmar.
 */
function SenhaUnica({ resultado, onConcluir }) {
  const [copiado, setCopiado] = useState(false);
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(resultado.senha_temporaria);
      setCopiado(true);
    } catch {
      setCopiado(false);
    }
  };
  return (
    <section className="painel" aria-labelledby="titulo-senha" data-testid="senha-unica">
      <h2 id="titulo-senha">Cliente {resultado.cliente.nome} cadastrado</h2>
      <Aviso tipo="aviso">
        Esta é a única vez que a senha inicial aparece. Copie e entregue ao administrador por um canal seguro (pessoalmente ou mensagem
        direta). Ainda não existe troca obrigatória no primeiro acesso: peça para ele trocar a senha em Usuários logo ao entrar.
      </Aviso>
      <dl className="ficha-dados">
        <div>
          <dt>Administrador</dt>
          <dd>{resultado.administrador.nome}</dd>
        </div>
        <div>
          <dt>Login</dt>
          <dd>{resultado.administrador.login}</dd>
        </div>
      </dl>
      <div className="senha-unica">
        <span className="campo-rotulo">Senha inicial</span>
        <code data-testid="senha-temporaria">{resultado.senha_temporaria}</code>
        <Botao variante="secundario" onClick={copiar}>
          {copiado ? 'Copiada' : 'Copiar senha'}
        </Botao>
      </div>
      <Botao onClick={onConcluir}>Já entreguei/guardei a senha — fechar</Botao>
    </section>
  );
}

function NovoCliente({ onCriado, onCancelar }) {
  const [nome, setNome] = useState('');
  const [codigo, setCodigo] = useState('');
  const [codigoEditado, setCodigoEditado] = useState(false);
  const [adminNome, setAdminNome] = useState('');
  const [adminLogin, setAdminLogin] = useState('');
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [resultado, setResultado] = useState(null);

  const enviar = async (e) => {
    e.preventDefault();
    if (ocupado) return;
    setErro('');
    setOcupado(true);
    try {
      setResultado(
        await api.criarCliente({ nome: nome.trim(), codigo: codigo.trim(), administrador: { nome: adminNome.trim(), login: adminLogin.trim() } })
      );
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    } finally {
      setOcupado(false);
    }
  };

  if (resultado) {
    return (
      <SenhaUnica
        resultado={resultado}
        onConcluir={() => {
          const id = resultado.cliente.id;
          setResultado(null);
          onCriado(id);
        }}
      />
    );
  }
  return (
    <section className="painel" aria-labelledby="titulo-novo-cliente">
      <h2 id="titulo-novo-cliente">Cadastrar cliente</h2>
      <p className="texto-apoio">
        Cria a organização e o primeiro administrador da fazenda. A empresa (fazenda) é cadastrada depois, pelo próprio cliente.
      </p>
      <form className="formulario" onSubmit={enviar}>
        <div className="grade-2">
          <Campo rotulo="Nome do cliente" id="novo-nome">
            <input
              id="novo-nome"
              value={nome}
              maxLength={255}
              required
              onChange={(e) => {
                setNome(e.target.value);
                if (!codigoEditado) setCodigo(sugerirCodigo(e.target.value));
              }}
            />
          </Campo>
          <Campo rotulo="Código" id="novo-codigo" dica="Minúsculas, números e hífen (3 a 64). Único entre todos os clientes.">
            <input
              id="novo-codigo"
              value={codigo}
              maxLength={64}
              required
              onChange={(e) => {
                setCodigoEditado(true);
                setCodigo(e.target.value);
              }}
            />
          </Campo>
          <Campo rotulo="Nome do administrador" id="novo-admin-nome">
            <input id="novo-admin-nome" value={adminNome} maxLength={255} required onChange={(e) => setAdminNome(e.target.value)} />
          </Campo>
          <Campo rotulo="Login do administrador" id="novo-admin-login" dica="Sem espaços. Não pode ser igual ao de outra conta ativa.">
            <input id="novo-admin-login" value={adminLogin} maxLength={120} autoComplete="off" required onChange={(e) => setAdminLogin(e.target.value)} />
          </Campo>
        </div>
        <Aviso tipo="erro">{erro}</Aviso>
        <div className="acoes">
          <Botao type="submit" ocupado={ocupado}>
            Cadastrar cliente e administrador
          </Botao>
          <Botao variante="secundario" onClick={onCancelar} disabled={ocupado}>
            Cancelar
          </Botao>
        </div>
      </form>
    </section>
  );
}

function EditarCliente({ cliente, onSalvo, onCancelar }) {
  const [nome, setNome] = useState(cliente.nome);
  const [codigo, setCodigo] = useState(cliente.codigo);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const enviar = async (e) => {
    e.preventDefault();
    if (ocupado) return;
    const dados = {};
    if (nome.trim() !== cliente.nome) dados.nome = nome.trim();
    if (codigo.trim().toLowerCase() !== cliente.codigo) dados.codigo = codigo.trim();
    if (!Object.keys(dados).length) {
      onCancelar();
      return;
    }
    setErro('');
    setOcupado(true);
    try {
      await api.editarCliente(cliente.id, dados);
      onSalvo();
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    } finally {
      setOcupado(false);
    }
  };
  return (
    <form className="formulario painel" onSubmit={enviar} aria-label="Editar identificação do cliente">
      <div className="grade-2">
        <Campo rotulo="Nome do cliente" id="editar-nome">
          <input id="editar-nome" value={nome} maxLength={255} required onChange={(e) => setNome(e.target.value)} />
        </Campo>
        <Campo rotulo="Código" id="editar-codigo" dica="Trocar o código não muda logins nem dados da fazenda.">
          <input id="editar-codigo" value={codigo} maxLength={64} required onChange={(e) => setCodigo(e.target.value)} />
        </Campo>
      </div>
      <Aviso tipo="erro">{erro}</Aviso>
      <div className="acoes">
        <Botao type="submit" ocupado={ocupado}>
          Salvar identificação
        </Botao>
        <Botao variante="secundario" onClick={onCancelar} disabled={ocupado}>
          Cancelar
        </Botao>
      </div>
    </form>
  );
}

function AlterarSituacao({ cliente, onSalvo, onCancelar }) {
  const suspender = cliente.ativo;
  const [justificativa, setJustificativa] = useState('');
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const curta = justificativa.trim().length < 10;
  const enviar = async (e) => {
    e.preventDefault();
    if (ocupado || curta) return;
    setErro('');
    setOcupado(true);
    try {
      await api.alterarSituacaoCliente(cliente.id, { ativo: !suspender, justificativa: justificativa.trim() });
      onSalvo();
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    } finally {
      setOcupado(false);
    }
  };
  return (
    <form className="formulario painel" onSubmit={enviar} aria-label={suspender ? 'Confirmar suspensão' : 'Confirmar reativação'}>
      <Aviso tipo={suspender ? 'erro' : 'info'}>
        {suspender
          ? `Suspender ${cliente.nome}: todos os usuários desta fazenda deixam de entrar e as sessões abertas param na hora. Nenhum dado é apagado; dá para reativar depois.`
          : `Reativar ${cliente.nome}: os usuários ativos desta fazenda voltam a entrar com as senhas que já tinham.`}
      </Aviso>
      <Campo rotulo="Justificativa (fica registrada na auditoria)" id="situacao-justificativa" dica="Pelo menos 10 caracteres.">
        <textarea id="situacao-justificativa" rows={3} maxLength={500} value={justificativa} onChange={(e) => setJustificativa(e.target.value)} />
      </Campo>
      <Aviso tipo="erro">{erro}</Aviso>
      <div className="acoes">
        <Botao type="submit" variante={suspender ? 'perigo' : 'primario'} ocupado={ocupado} disabled={curta}>
          {suspender ? 'Confirmar suspensão' : 'Confirmar reativação'}
        </Botao>
        <Botao variante="secundario" onClick={onCancelar} disabled={ocupado}>
          Cancelar
        </Botao>
      </div>
    </form>
  );
}

function FichaCliente({ id, onFechar, onAlterado }) {
  const [ficha, setFicha] = useState(null);
  const [erro, setErro] = useState('');
  const [modo, setModo] = useState('ver');
  const [aviso, setAviso] = useState('');
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
    setModo('ver');
    setAviso('');
    carregar();
  }, [id, carregar]);

  const salvo = (texto) => {
    setModo('ver');
    setAviso(texto);
    carregar();
    onAlterado?.();
  };

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
      <Aviso tipo="info">Daqui não se entra na conta do cliente nem se mexe nos dados da fazenda: só identificação e situação da organização.</Aviso>
      <Aviso tipo="sucesso" onFechar={() => setAviso('')}>
        {aviso}
      </Aviso>
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
          {modo === 'editar' ? (
            <EditarCliente cliente={ficha.cliente} onSalvo={() => salvo('Identificação atualizada.')} onCancelar={() => setModo('ver')} />
          ) : modo === 'situacao' ? (
            <AlterarSituacao
              cliente={ficha.cliente}
              onSalvo={() => salvo(ficha.cliente.ativo ? 'Cliente suspenso.' : 'Cliente reativado.')}
              onCancelar={() => setModo('ver')}
            />
          ) : (
            <div className="acoes-ficha">
              <Botao variante="secundario" onClick={() => setModo('editar')}>
                Editar identificação
              </Botao>
              <Botao variante={ficha.cliente.ativo ? 'perigo' : 'primario'} onClick={() => setModo('situacao')}>
                {ficha.cliente.ativo ? 'Suspender cliente' : 'Reativar cliente'}
              </Botao>
            </div>
          )}
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
  const [cadastrando, setCadastrando] = useState(false);
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
        <div className="linha">
          <span className="texto-apoio">{pagina && pagina.total !== null ? `${pagina.total} cliente(s)` : ''}</span>
          {!cadastrando ? (
            <Botao
              onClick={() => {
                setSelecionado(null);
                setCadastrando(true);
              }}
            >
              Cadastrar cliente
            </Botao>
          ) : null}
        </div>
      </div>
      {cadastrando ? (
        <NovoCliente
          onCancelar={() => setCadastrando(false)}
          onCriado={(id) => {
            setCadastrando(false);
            buscar(null);
            setSelecionado(id);
          }}
        />
      ) : null}
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
                  <td data-rotulo="Código">{c.codigo}</td>
                  <td data-rotulo="Situação">
                    <Situacao ativo={c.ativo} />
                  </td>
                  <td data-rotulo="Usuários">{c.usuarios_total}</td>
                  <td data-rotulo="Empresas">{c.empresas_total}</td>
                  <td data-rotulo="Cadastrado em">{data(c.criado_em)}</td>
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
      {selecionado ? <FichaCliente id={selecionado} onFechar={() => setSelecionado(null)} onAlterado={() => buscar(null)} /> : null}
    </section>
  );
}
