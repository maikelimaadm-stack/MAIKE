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
import { api, mensagemDeErro, resultadoIncerto } from '../api.js';
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
        direta). No primeiro acesso o sistema exige que ele troque esta senha por uma só dele antes de entrar. Se usar
        &quot;Copiar senha&quot;, ela continua na área de transferência deste dispositivo até você copiar outra coisa.
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

/** Teto da verificação read-only do cadastro incerto (25 por página → 1.000 clientes). */
const LIMITE_PAGINAS_VERIFICACAO = 40;

function NovoCliente({ onCriado, onCancelar }) {
  const [nome, setNome] = useState('');
  const [codigo, setCodigo] = useState('');
  const [codigoEditado, setCodigoEditado] = useState(false);
  const [adminNome, setAdminNome] = useState('');
  const [adminLogin, setAdminLogin] = useState('');
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [resultado, setResultado] = useState(null);
  // Resultado incerto: o pedido saiu, mas a resposta não chegou (rede, timeout,
  // gateway). O servidor pode ter gravado. Até verificar, NÃO há novo envio.
  const [incerto, setIncerto] = useState(null);
  /** null | {tipo:'existe', cliente} | {tipo:'nao-encontrado'} | {tipo:'inconclusivo', motivo} */
  const [verificacao, setVerificacao] = useState(null);

  const enviar = async (e) => {
    e.preventDefault();
    if (ocupado || incerto) return;
    setErro('');
    setVerificacao(null);
    setOcupado(true);
    const pedido = { nome: nome.trim(), codigo: codigo.trim(), administrador: { nome: adminNome.trim(), login: adminLogin.trim() } };
    try {
      setResultado(await api.criarCliente(pedido));
    } catch (falha) {
      if (resultadoIncerto(falha)) setIncerto({ codigo: pedido.codigo.toLowerCase() });
      else setErro(mensagemDeErro(falha));
    } finally {
      setOcupado(false);
    }
  };

  /**
   * Só leitura: procura o código EXATO percorrendo todas as páginas da busca.
   * Nunca reenvia o cadastro e NUNCA conclui que ele falhou: não achar agora
   * não prova nada (o POST original pode ainda estar em execução).
   */
  const verificar = async () => {
    if (ocupado || !incerto) return;
    setOcupado(true);
    try {
      const vistos = new Set();
      let cursor;
      for (let pagina = 0; pagina < LIMITE_PAGINAS_VERIFICACAO; pagina += 1) {
        const r = await api.clientes({ q: incerto.codigo, cursor });
        const achado = (r?.items || []).find((c) => c.codigo === incerto.codigo);
        if (achado) {
          setVerificacao({ tipo: 'existe', cliente: achado });
          return;
        }
        if (!r?.has_more) {
          setVerificacao({ tipo: 'nao-encontrado' });
          return;
        }
        if (!r.next_cursor || vistos.has(r.next_cursor)) {
          setVerificacao({ tipo: 'inconclusivo', motivo: 'a paginação da busca não avançou' });
          return;
        }
        vistos.add(r.next_cursor);
        cursor = r.next_cursor;
      }
      setVerificacao({ tipo: 'inconclusivo', motivo: 'resultados demais para conferir aqui; procure o código na lista' });
    } catch (falha) {
      setVerificacao({ tipo: 'inconclusivo', motivo: mensagemDeErro(falha) });
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
        {incerto ? (
          <div data-testid="cadastro-incerto">
            <Aviso tipo="aviso">
              A resposta do servidor não chegou: o cadastro pode ter sido concluído ou ainda estar em andamento. O envio fica bloqueado para não
              repetir o pedido. Cancelar fecha este formulário, mas não cancela o pedido já enviado ao servidor.
            </Aviso>
            {verificacao?.tipo === 'existe' ? (
              <Aviso tipo="aviso">
                {`Já existe cliente com o código "${incerto.codigo}". Esta tela não consegue saber se foi este envio que o criou. A senha inicial deste envio não pode ser mostrada: a recuperação do primeiro acesso ainda não existe (fica para a próxima etapa). Não cadastre outra vez.`}
              </Aviso>
            ) : null}
            {verificacao?.tipo === 'nao-encontrado' ? (
              <Aviso tipo="info">
                Não encontramos ainda um cliente com esse código. Isso NÃO confirma que o pedido original falhou: ele pode ainda estar em
                processamento. Verifique novamente em instantes.
              </Aviso>
            ) : null}
            {verificacao?.tipo === 'inconclusivo' ? (
              <Aviso tipo="erro">{`Não foi possível concluir a verificação (${verificacao.motivo}). Nada foi confirmado; o envio continua bloqueado.`}</Aviso>
            ) : null}
          </div>
        ) : null}
        <div className="acoes">
          {incerto ? (
            verificacao?.tipo === 'existe' ? (
              <Botao onClick={() => onCriado(verificacao.cliente.id)}>Abrir ficha do cliente</Botao>
            ) : (
              <Botao onClick={verificar} ocupado={ocupado}>
                {verificacao ? 'Verificar novamente' : 'Verificar se o cliente foi criado'}
              </Botao>
            )
          ) : (
            <Botao type="submit" ocupado={ocupado}>
              Cadastrar cliente e administrador
            </Botao>
          )}
          <Botao variante="secundario" onClick={onCancelar} disabled={ocupado}>
            Cancelar
          </Botao>
        </div>
      </form>
    </section>
  );
}

function EditarCliente({ cliente, revisao, onSalvo, onCancelar }) {
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
      await api.editarCliente(cliente.id, dados, revisao);
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

function AlterarSituacao({ cliente, revisao, onSalvo, onCancelar }) {
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
      await api.alterarSituacaoCliente(cliente.id, { ativo: !suspender, justificativa: justificativa.trim() }, revisao);
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
          ? `Suspender ${cliente.nome}: todos os usuários desta fazenda deixam de entrar e as sessões abertas param na hora. As sessões são encerradas de vez: mesmo que o cliente seja reativado, cada usuário precisa entrar de novo. Nenhum dado é apagado; dá para reativar depois.`
          : `Reativar ${cliente.nome}: os usuários ativos desta fazenda voltam a entrar com as senhas que já tinham. As sessões de antes da suspensão não voltam: cada usuário entra de novo.`}
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

/**
 * Reemissão de senha temporária (MAIKE-SAAS-ADMIN-S04-P3 PR01).
 *
 * Confirmação explícita (nome/login e sessões encerradas, inclusive o risco de
 * lançamentos offline não enviados), justificativa e reautenticação (senha
 * atual + código do autenticador). Um envio por clique; os campos sensíveis
 * são limpos a cada envio. Resultado incerto (rede/5xx) NÃO repete: avisa que
 * a senha anterior pode já ter sido invalidada e manda reler a lista.
 */
function ReemitirSenha({ cliente, usuario, onConcluido, onReler, onCancelar }) {
  const [entendi, setEntendi] = useState(false);
  const [justificativa, setJustificativa] = useState('');
  const [senhaAtual, setSenhaAtual] = useState('');
  const [codigo, setCodigo] = useState('');
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const curta = justificativa.trim().length < 10;
  const incompleto = !entendi || curta || !senhaAtual || codigo.trim().length < 6;
  const enviar = async (e) => {
    e.preventDefault();
    if (ocupado || incompleto) return;
    setErro('');
    setOcupado(true);
    const dados = { justificativa: justificativa.trim(), senha_admin_atual: senhaAtual, codigo_mfa: codigo.trim() };
    setSenhaAtual('');
    setCodigo('');
    try {
      const resultado = await api.reemitirSenhaUsuario(cliente.id, usuario.id, dados, usuario.revisao);
      onConcluido(resultado);
    } catch (falha) {
      const f = /** @type {any} */ (falha);
      if (f?.code === 'ADMIN_REEMISSAO_SENHA_DESABILITADA') {
        // R1: o servidor recusou ANTES de qualquer coisa — resultado certo, nada mudou.
        onReler(mensagemDeErro(f));
      } else if (resultadoIncerto(falha)) {
        onReler(
          `Não foi possível confirmar a reemissão para ${usuario.nome}. A senha anterior pode já ter sido invalidada. Recarregamos a lista: confira o usuário e, se precisar, inicie uma nova reemissão.`
        );
      } else if (f?.code === 'ADMIN_USUARIO_EDICAO_CONCORRENTE' || f?.code === 'ADMIN_REVISAO_REQUERIDA') {
        onReler(mensagemDeErro(f));
      } else {
        setErro(mensagemDeErro(falha));
      }
    } finally {
      dados.senha_admin_atual = '';
      dados.codigo_mfa = '';
      setOcupado(false);
    }
  };
  return (
    <form className="formulario painel" onSubmit={enviar} aria-label="Reemitir senha temporária" data-testid="reemitir-senha">
      <h3>Reemitir senha temporária</h3>
      <Aviso tipo="erro">
        {`${usuario.nome} (${usuario.login}), de ${cliente.nome}: a senha atual deixa de valer e TODAS as sessões abertas desta conta são encerradas na hora, em todos os aparelhos. Lançamentos feitos sem internet e ainda não sincronizados nesses aparelhos podem precisar ser refeitos. No próximo acesso, a pessoa entra com a senha temporária e é obrigada a trocá-la.`}
      </Aviso>
      <label className="checagem">
        <input type="checkbox" checked={entendi} onChange={(e) => setEntendi(e.target.checked)} />
        {` Entendi: reemitir a senha de ${usuario.login} e encerrar as sessões dessa conta.`}
      </label>
      <Campo rotulo="Justificativa (fica registrada na auditoria)" id="reemitir-justificativa" dica="Pelo menos 10 caracteres.">
        <textarea id="reemitir-justificativa" rows={3} maxLength={500} value={justificativa} onChange={(e) => setJustificativa(e.target.value)} />
      </Campo>
      <Campo rotulo="Sua senha atual (proprietário)" id="reemitir-senha-admin">
        <input id="reemitir-senha-admin" type="password" autoComplete="current-password" value={senhaAtual} onChange={(e) => setSenhaAtual(e.target.value)} />
      </Campo>
      <Campo rotulo="Código do autenticador" id="reemitir-codigo" dica="Use um código novo: o mesmo código não vale duas vezes.">
        <input
          id="reemitir-codigo"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={12}
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
        />
      </Campo>
      <Aviso tipo="erro">{erro}</Aviso>
      <div className="acoes">
        <Botao type="submit" variante="perigo" ocupado={ocupado} disabled={incompleto}>
          Reemitir senha
        </Botao>
        <Botao variante="secundario" onClick={onCancelar} disabled={ocupado}>
          Cancelar
        </Botao>
      </div>
    </form>
  );
}

/** Mostra a senha reemitida UMA vez; fechar descarta o estado. */
function SenhaReemitida({ resultado, onConcluir }) {
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
    <section className="painel" aria-labelledby="titulo-senha-reemitida" data-testid="senha-reemitida">
      <h3 id="titulo-senha-reemitida">Nova senha temporária de {resultado.usuario.nome}</h3>
      <Aviso tipo="aviso">
        Esta é a única vez que a nova senha aparece. Entregue por um canal seguro. As sessões desta conta foram encerradas; no próximo
        acesso o sistema exige trocar esta senha por uma só da pessoa. Se usar &quot;Copiar senha&quot;, ela fica na área de transferência
        deste dispositivo até você copiar outra coisa.
      </Aviso>
      <dl className="ficha-dados">
        <div>
          <dt>Login</dt>
          <dd>{resultado.usuario.login}</dd>
        </div>
      </dl>
      <div className="senha-unica">
        <span className="campo-rotulo">Senha temporária</span>
        <code data-testid="senha-temporaria-reemitida">{resultado.senha_temporaria}</code>
        <Botao variante="secundario" onClick={copiar}>
          {copiado ? 'Copiada' : 'Copiar senha'}
        </Botao>
      </div>
      <Botao onClick={onConcluir}>Já entreguei/guardei a senha — fechar</Botao>
    </section>
  );
}

function FichaCliente({ id, onFechar, onAlterado }) {
  const [ficha, setFicha] = useState(null);
  const [erro, setErro] = useState('');
  const [modo, setModo] = useState('ver');
  const [aviso, setAviso] = useState('');
  // S04-P3: reemissão de senha (conta alvo, resultado mostrado uma vez, recarga da lista).
  const [reemitindo, setReemitindo] = useState(null);
  const [reemitida, setReemitida] = useState(null);
  const [versaoUsuarios, setVersaoUsuarios] = useState(0);
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
    setReemitindo(null);
    setReemitida(null);
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
            <EditarCliente cliente={ficha.cliente} revisao={ficha.revisao} onSalvo={() => salvo('Identificação atualizada.')} onCancelar={() => setModo('ver')} />
          ) : modo === 'situacao' ? (
            <AlterarSituacao
              cliente={ficha.cliente}
              revisao={ficha.revisao}
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
          {reemitida ? (
            <SenhaReemitida resultado={reemitida} onConcluir={() => setReemitida(null)} />
          ) : reemitindo ? (
            <ReemitirSenha
              cliente={ficha.cliente}
              usuario={reemitindo}
              onConcluido={(r) => {
                setReemitindo(null);
                setReemitida(r);
                setVersaoUsuarios((v) => v + 1);
              }}
              onReler={(texto) => {
                setReemitindo(null);
                setErro('');
                setAviso(texto);
                setVersaoUsuarios((v) => v + 1);
              }}
              onCancelar={() => setReemitindo(null)}
            />
          ) : null}
          <ListaDoCliente
            key={`u-${id}-${versaoUsuarios}`}
            titulo="Usuários"
            carregar={usuarios}
            colunas={['Nome', 'Login', 'Situação', 'Cadastrado em', 'Ações']}
            vazio="Nenhum usuário cadastrado."
            linha={(u) => (
              <tr key={u.id} className={u.ativo ? undefined : 'linha-inativa'}>
                <td>{u.nome}</td>
                <td>{u.login}</td>
                <td>
                  <Situacao ativo={u.ativo} />
                </td>
                <td>{data(u.criado_em)}</td>
                <td>
                  {u.reemissao_disponivel === true && u.ativo && ficha.cliente.ativo && !reemitindo && !reemitida ? (
                    <Botao variante="secundario" onClick={() => setReemitindo(u)} aria-label={`Reemitir senha temporária de ${u.login}`}>
                      Reemitir senha temporária
                    </Botao>
                  ) : null}
                </td>
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
