/**
 * pages.config.js — registro de páginas do produto.
 *
 * Escopo do produto: Pecuária — Mapa Geral + Manejo.
 * A lista abaixo é validada por `npm run gate:product-scope` contra
 * `config/mapa-manejo-scope.json`. Adicionar página fora do manifesto reprova o gate.
 */
import MapaGeral from './pages/MapaGeral';
import MapaCadastro from './pages/MapaCadastro';
import CadastroLotes from './pages/CadastroLotes';
import CadastroSetores from './pages/CadastroSetores';
import CategoriasManejo from './pages/CategoriasManejo';
import Bebedouros from './pages/Bebedouros';
import Produtos from './pages/Produtos';
import Categorias from './pages/Categorias';
import Marcas from './pages/Marcas';
import UnidadesMedida from './pages/UnidadesMedida';
import LocaisEstoque from './pages/LocaisEstoque';
import TiposTarefa from './pages/TiposTarefa';
import TiposAtividade from './pages/TiposAtividade';
import Estacoes from './pages/Estacoes';
import CurvasGanho from './pages/CurvasGanho';
import LancamentoAtividades from './pages/LancamentoAtividades';
import GruposAtividades from './pages/GruposAtividades';
import Funcionarios from './pages/Funcionarios';
import Servicos from './pages/Servicos';
import Empresa from './pages/Empresa';
import Usuarios from './pages/Usuarios';
import Permissoes from './pages/Permissoes';
import ConfiguracoesGerais from './pages/ConfiguracoesGerais';
import Parceiros from './pages/Parceiros';
import CentrosCusto from './pages/CentrosCusto';
import CentrosResultado from './pages/CentrosResultado';
import NaturezasFinanceiras from './pages/NaturezasFinanceiras';
import LancamentosFinanceiros from './pages/LancamentosFinanceiros';
import BensPatrimoniais from './pages/BensPatrimoniais';
import Abastecimentos from './pages/Abastecimentos';
import __Layout from './Layout.jsx';

export const PAGES = {
    "MapaGeral": MapaGeral,
    "MapaCadastro": MapaCadastro,
    "CadastroLotes": CadastroLotes,
    "CadastroSetores": CadastroSetores,
    "CategoriasManejo": CategoriasManejo,
    "Bebedouros": Bebedouros,
    "Produtos": Produtos,
    "Categorias": Categorias,
    "Marcas": Marcas,
    "UnidadesMedida": UnidadesMedida,
    "LocaisEstoque": LocaisEstoque,
    "TiposTarefa": TiposTarefa,
    "TiposAtividade": TiposAtividade,
    "Estacoes": Estacoes,
    "CurvasGanho": CurvasGanho,
    "LancamentoAtividades": LancamentoAtividades,
    "GruposAtividades": GruposAtividades,
    "Funcionarios": Funcionarios,
    "Servicos": Servicos,
    "Empresa": Empresa,
    "Usuarios": Usuarios,
    "Permissoes": Permissoes,
    "ConfiguracoesGerais": ConfiguracoesGerais,
    "Parceiros": Parceiros,
    "CentrosCusto": CentrosCusto,
    "CentrosResultado": CentrosResultado,
    "NaturezasFinanceiras": NaturezasFinanceiras,
    "LancamentosFinanceiros": LancamentosFinanceiros,
    "BensPatrimoniais": BensPatrimoniais,
    "Abastecimentos": Abastecimentos,
};

export const pagesConfig = {
    mainPage: "MapaGeral",
    Pages: PAGES,
    Layout: __Layout,
};
