/**
 * Inicialização única do MAIKE (PR145-G4): lógica pura, testável sem banco.
 *
 * O script `inicializar-tenant-maike.mjs` apaga os dados de TESTE dos tenants
 * existentes e cria o tenant técnico inicial com uma única conta. Este módulo
 * decide o que pode ser apagado, em que ordem, e recusa qualquer surpresa:
 * tabela fora do schema versionado, ciclo de FK, auto-referência não anulável.
 *
 * Nunca toca: `_prisma_migrations`, catálogo global e identidade do
 * proprietário (listas fechadas de `config/modelobase1-pecuario.json`), nem
 * nada fora do schema `public`.
 */

import { createHash } from 'node:crypto';

export const CLIENTE_INICIAL = Object.freeze({ codigo: 'maike', nome: 'MAIKE' });
export const CONTA_INICIAL = Object.freeze({ login: 'maike', nome: 'Maike' });

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Identificador SQL entre aspas, só para nomes vindos do catálogo e validados. */
export const q = (nome) => {
  if (!IDENT.test(nome)) throw new Error(`identificador inesperado: ${nome}`);
  return `"${nome}"`;
};

/**
 * Inventário: separa o que é apagável do que é preservado e recusa surpresas.
 *
 * @param {{
 *   tabelasBanco: string[],
 *   modelos: string[],
 *   preservados: string[],
 *   comClienteId: string[],
 * }} e
 */
export const classificarTabelas = ({ tabelasBanco, modelos, preservados, comClienteId }) => {
  const esperadas = new Set([...modelos, '_prisma_migrations']);
  const inesperadas = tabelasBanco.filter((t) => !esperadas.has(t)).sort();
  const ausentes = [...esperadas].filter((t) => !tabelasBanco.includes(t)).sort();
  const preservadas = new Set([...preservados, '_prisma_migrations']);
  const tenant = comClienteId.filter((t) => !preservadas.has(t) && t !== 'Cliente').sort();
  return { inesperadas, ausentes, tenant, preservadas: [...preservadas].sort() };
};

/**
 * Ordem de exclusão filho → pai entre as tabelas apagáveis (+ `Cliente` por
 * último). Auto-referências viram anulação prévia; outro ciclo é recusado.
 *
 * @param {string[]} tabelas apagáveis (sem `Cliente`)
 * @param {Array<{filha: string, mae: string, colunas: string[], anulaveis: boolean}>} fks
 */
export const planejarOrdem = (tabelas, fks) => {
  const conjunto = new Set([...tabelas, 'Cliente']);
  const relevantes = fks.filter((f) => conjunto.has(f.filha) && conjunto.has(f.mae));
  const autoRef = relevantes.filter((f) => f.filha === f.mae);
  for (const f of autoRef) {
    if (!f.anulaveis) throw new Error(`auto-referência não anulável em ${f.filha}: recuse e revise`);
  }
  // filha precisa sair antes da mãe: aresta filha → mãe.
  const pendentes = new Map([...conjunto].map((t) => [t, new Set()]));
  for (const f of relevantes) if (f.filha !== f.mae) pendentes.get(f.mae).add(f.filha);
  const ordem = [];
  const restantes = new Set(conjunto);
  while (restantes.size) {
    const livres = [...restantes].filter((t) => [...pendentes.get(t)].every((filha) => !restantes.has(filha))).sort();
    if (!livres.length) throw new Error(`ciclo de FK entre: ${[...restantes].sort().join(', ')}`);
    for (const t of livres) {
      ordem.push(t);
      restantes.delete(t);
    }
  }
  // `Cliente` é a raiz: sempre a última.
  return {
    ordem: [...ordem.filter((t) => t !== 'Cliente'), 'Cliente'],
    anular: autoRef.map((f) => ({ tabela: f.filha, colunas: f.colunas.filter((c) => c !== 'cliente_id') })),
  };
};

const COMUNS = ['senha', 'password', '123456', 'qwerty', 'admin', 'maike', 'fazenda', 'abcdef', '111111', 'iloveyou'];

/**
 * Política da senha da conta inicial (entrada só por terminal oculto).
 * @returns {string | null} motivo da recusa, ou null
 */
export const avaliarSenha = (senha, { login, nome }) => {
  if (typeof senha !== 'string' || senha.length < 12) return 'use ao menos 12 caracteres (recomendado 16+)';
  if (senha.length > 512) return 'senha longa demais';
  if (/^\d+$/.test(senha)) return 'não use só números';
  if (new Set(senha).size < 6) return 'use mais variedade de caracteres';
  const baixa = senha.toLowerCase();
  if (COMUNS.some((c) => baixa.includes(c))) return 'senha muito comum ou previsível';
  if ([login, nome].filter(Boolean).some((x) => baixa.includes(String(x).toLowerCase()))) return 'não use o login nem o nome';
  return null;
};

/** Ações de AuditLog aceitas no estado inicial: a própria inicialização e a elevação. */
export const AUDITORIA_DO_ESTADO_INICIAL = Object.freeze(['ops_inicializacao', 'papel_tenant']);

/**
 * Impressão digital do inventário (G4-R1): contagem POR TABELA, conjunto de
 * clientes, classes (apagáveis/preservadas) e a ordem de FK. O mesmo total
 * com outra distribuição dá outra impressão. Só o hash sai; ids não são impressos.
 */
export const impressaoInventario = ({ contagens, clienteIds, tenant, preservadas, ordem }) =>
  createHash('sha256')
    .update(
      JSON.stringify({
        contagens: Object.entries(contagens).sort(([a], [b]) => (a < b ? -1 : 1)),
        clientes: [...clienteIds].sort(),
        tenant: [...tenant].sort(),
        preservadas: [...preservadas].sort(),
        ordem,
      })
    )
    .digest('hex')
    .slice(0, 8);

/** Frase que o operador digita: amarra a execução ao inventário EXATO exibido no dry-run. */
export const fraseDeConfirmacao = ({ clientes, linhas, impressao }) =>
  `APAGAR ${linhas} LINHAS DE ${clientes} CLIENTE(S) #${impressao}`;

/**
 * Estado do banco em relação à inicialização (G4-R1):
 * - 'nao_inicializado': não há cliente nem conta "maike" → a limpeza pode seguir;
 * - 'inicial': só o cliente técnico, só a conta "maike", nenhuma outra linha de
 *   tenant e só a auditoria da inicialização/elevação → nada a fazer (idempotente);
 * - 'anomalia': há "maike" E qualquer outro dado → NUNCA apagar sozinho; revisão humana.
 *
 * @param {{clientes: Array<{codigo: string}>, usuarios: Array<{login: string}>,
 *          contagens: Record<string, number>, auditoriaForaDoPermitido: number}} e
 */
export const estadoInicializacao = ({ clientes, usuarios, contagens, auditoriaForaDoPermitido }) => {
  const temMaike = clientes.some((c) => c.codigo === CLIENTE_INICIAL.codigo) || usuarios.some((u) => u.login === CONTA_INICIAL.login);
  if (!temMaike) return 'nao_inicializado';
  const permitido = { Cliente: 1, Usuario: 1 };
  const limpo =
    clientes.length === 1 &&
    clientes[0].codigo === CLIENTE_INICIAL.codigo &&
    usuarios.length === 1 &&
    usuarios[0].login === CONTA_INICIAL.login &&
    auditoriaForaDoPermitido === 0 &&
    Object.entries(contagens).every(([t, n]) => t === 'AuditLog' || n === (permitido[t] ?? 0));
  return limpo ? 'inicial' : 'anomalia';
};
