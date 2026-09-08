/**
 * Parser estrutural de `schema.prisma`.
 *
 * Os dois gates da P3 dependem de enxergar a **estrutura** do schema, não de
 * casar substring. A diferença não é estética: `@@index([cliente_id, ativo])` e
 * `@@index([ativo, cliente_id])` contêm exatamente os mesmos caracteres, e só a
 * ordem separa um índice tenant-first de um que não serve para nada. Um gate
 * que procura a string `cliente_id` dentro do bloco aprova os dois.
 *
 * O parser também precisa ser insensível a formatação: espaço, tabulação,
 * quebra de linha dentro do array e comentário no meio do bloco não podem mudar
 * o veredito. Foi essa lição que a D-PROD-15 registrou para as functions
 * Base44, e ela vale igual aqui.
 *
 * Não usa dependência externa: o Prisma não expõe um parser estável de schema
 * para Node, e trazer um pacote só para isso ampliaria a superfície do gate.
 */

/** Remove comentários de linha preservando o comprimento das demais linhas. */
const semComentarios = (texto) =>
  texto
    .split('\n')
    .map((linha) => {
      const posicao = linha.indexOf('//');
      return posicao === -1 ? linha : linha.slice(0, posicao);
    })
    .join('\n');

/**
 * Extrai os blocos de topo (`model X { … }`, `enum Y { … }`, …).
 *
 * @param {string} fonte
 * @returns {Array<{tipo: string, nome: string, corpo: string}>}
 */
export const extrairBlocos = (fonte) => {
  const limpo = semComentarios(fonte);
  const blocos = [];
  const abertura = /\b(model|enum|type|view|generator|datasource)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/g;

  let match;
  while ((match = abertura.exec(limpo)) !== null) {
    const inicioCorpo = abertura.lastIndex;
    let profundidade = 1;
    let i = inicioCorpo;

    while (i < limpo.length && profundidade > 0) {
      const c = limpo[i];
      if (c === '{') profundidade += 1;
      else if (c === '}') profundidade -= 1;
      i += 1;
    }

    if (profundidade !== 0) {
      throw new Error(`bloco "${match[1]} ${match[2]}" não foi fechado`);
    }

    blocos.push({
      tipo: match[1],
      nome: match[2],
      corpo: limpo.slice(inicioCorpo, i - 1),
    });
    abertura.lastIndex = i;
  }

  return blocos;
};

/**
 * Lista de colunas de um atributo `@@index([...])` / `@@unique([...])`.
 * Aceita quebra de linha e espaço arbitrário dentro dos colchetes.
 *
 * @param {string} corpo
 * @param {'index'|'unique'|'id'} atributo
 * @returns {string[][]} uma lista de colunas por ocorrência
 */
export const listasDoAtributo = (corpo, atributo) => {
  const re = new RegExp(`@@${atributo}\\s*\\(`, 'g');
  const resultado = [];

  while (re.exec(corpo) !== null) {
    // Avança até o `[` de abertura da lista de campos.
    let i = re.lastIndex;
    while (i < corpo.length && corpo[i] !== '[' && corpo[i] !== ')') i += 1;
    if (corpo[i] !== '[') continue;

    const fim = corpo.indexOf(']', i);
    if (fim === -1) continue;

    const colunas = corpo
      .slice(i + 1, fim)
      .split(',')
      .map((parte) => parte.trim())
      // `@@index([cliente_id(sort: Desc)])` — só o nome interessa.
      .map((parte) => parte.replace(/\(.*$/, '').trim())
      .filter(Boolean);

    if (colunas.length) resultado.push(colunas);
    re.lastIndex = fim;
  }

  return resultado;
};

/**
 * Campos escalares e de relação declarados no corpo de um model.
 *
 * @param {string} corpo
 * @returns {Array<{nome: string, tipo: string, opcional: boolean, lista: boolean, atributos: string}>}
 */
export const camposDoModel = (corpo) => {
  const campos = [];

  for (const linhaBruta of corpo.split('\n')) {
    const linha = linhaBruta.trim();
    if (!linha || linha.startsWith('@@')) continue;

    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s+([A-Za-z_][A-Za-z0-9_]*)(\[\])?(\?)?\s*(.*)$/.exec(
      linha
    );
    if (!match) continue;

    campos.push({
      nome: match[1],
      tipo: match[2],
      lista: Boolean(match[3]),
      opcional: Boolean(match[4]),
      atributos: (match[5] || '').trim(),
    });
  }

  return campos;
};

/**
 * Lê um schema e devolve só os models, já com campos e atributos resolvidos.
 *
 * @param {string} fonte
 */
export const lerModels = (fonte) =>
  extrairBlocos(fonte)
    .filter((bloco) => bloco.tipo === 'model')
    .map((bloco) => {
      const campos = camposDoModel(bloco.corpo);
      return {
        nome: bloco.nome,
        corpo: bloco.corpo,
        campos,
        // Campo escalar = não é lista e o tipo não é outro model. O gate resolve
        // isso depois, quando conhece o conjunto de nomes de model.
        indices: listasDoAtributo(bloco.corpo, 'index'),
        uniques: listasDoAtributo(bloco.corpo, 'unique'),
        ids: listasDoAtributo(bloco.corpo, 'id'),
      };
    });

/**
 * Campo por nome.
 * @param {{campos: Array<{nome: string}>}} model
 * @param {string} nome
 */
export const campo = (model, nome) => model.campos.find((c) => c.nome === nome) || null;

/**
 * Um model é tenant-scoped quando não é a raiz declarada.
 * @param {string} nomeDoModel
 * @param {string} rootModel
 */
export const ehTenantScoped = (nomeDoModel, rootModel) => nomeDoModel !== rootModel;
