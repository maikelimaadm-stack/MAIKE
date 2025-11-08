import Dashboard from './pages/Dashboard';
import Relatorios from './pages/Relatorios';
import Usuarios from './pages/Usuarios';
import Fornecedores from './pages/Fornecedores';
import Produtos from './pages/Produtos';
import RelatorioPesagens from './pages/RelatorioPesagens';
import RelatorioFornecedores from './pages/RelatorioFornecedores';
import RelatorioProdutos from './pages/RelatorioProdutos';
import UnidadesMedida from './pages/UnidadesMedida';
import Categorias from './pages/Categorias';
import LocaisEstoque from './pages/LocaisEstoque';
import Empresa from './pages/Empresa';
import CustosSafra from './pages/CustosSafra';
import RelatorioCustosSafra from './pages/RelatorioCustosSafra';
import RelatorioEstoque from './pages/RelatorioEstoque';
import GerenciarSafras from './pages/GerenciarSafras';
import RelatorioHistoricoEntregas from './pages/RelatorioHistoricoEntregas';
import MovimentacoesEstoque from './pages/MovimentacoesEstoque';
import CentrosCusto from './pages/CentrosCusto';
import Layout from './Layout.jsx';


export const PAGES = {
    "Dashboard": Dashboard,
    "Relatorios": Relatorios,
    "Usuarios": Usuarios,
    "Fornecedores": Fornecedores,
    "Produtos": Produtos,
    "RelatorioPesagens": RelatorioPesagens,
    "RelatorioFornecedores": RelatorioFornecedores,
    "RelatorioProdutos": RelatorioProdutos,
    "UnidadesMedida": UnidadesMedida,
    "Categorias": Categorias,
    "LocaisEstoque": LocaisEstoque,
    "Empresa": Empresa,
    "CustosSafra": CustosSafra,
    "RelatorioCustosSafra": RelatorioCustosSafra,
    "RelatorioEstoque": RelatorioEstoque,
    "GerenciarSafras": GerenciarSafras,
    "RelatorioHistoricoEntregas": RelatorioHistoricoEntregas,
    "MovimentacoesEstoque": MovimentacoesEstoque,
    "CentrosCusto": CentrosCusto,
}

export const pagesConfig = {
    mainPage: "Dashboard",
    Pages: PAGES,
    Layout: Layout,
};