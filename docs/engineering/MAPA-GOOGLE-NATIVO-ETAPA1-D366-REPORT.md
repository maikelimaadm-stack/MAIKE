# Mapa do Google no Mapa Geral — etapa 1 (D-PROD-366)

**Data:** 2026-11-27 · sem servidor, sem migration · **APK 1.0.6 (código 7)** · decisão: [D-PROD-366](./DECISIONS.md)

## Por quê

O satélite do Mapa Geral hoje é o MapLibre com a **Map Tiles API** do Google. Ela conta **cada imagem** baixada: abrir, arrastar e dar zoom. A faixa grátis é de cerca de 100 mil imagens por mês, e o consumo do proprietário estava chegando à cobrança.

O proprietário mostrou três referências que nunca cobraram:

| Onde | Como desenha o mapa | O que o Google conta |
|---|---|---|
| APK do AgriWebb (analisado aqui) | Google Maps **nativo** do Android (`com.google.android.gms.maps`) | nada: o mapa nativo de Android e iOS não é cobrado, e o SDK guarda as imagens já vistas |
| MAKGESTAO antigo (`maikelimaadm-stack/makgestao`, `src/pages/MapaGeral.jsx`) | Google Maps do navegador: `maps.googleapis.com/maps/api/js` + `new google.maps.Map(…, { mapTypeId: 'satellite' })` | **aberturas de mapa** (faixa grátis de cerca de 10 mil por mês); arrastar e dar zoom não contam |
| Outro sistema (captura do proprietário: "Atalhos do teclado · Imagens ©2026 Airbus, CNES / Airbus, Maxar Technologies · Termos") | o mesmo Maps JavaScript API | aberturas de mapa |

O proprietário escolheu o mapa do Google nos dois lados: nativo no app Android e iOS, e Maps JavaScript API no site.

## O que muda nesta etapa

- **Plugin oficial** `@capacitor/google-maps` 8.0.1 (Capacitor 8). Ele tem o mapa nativo de Android e iOS e uma versão web, que usa o Maps JavaScript API. Um componente só serve o app e o site. Registrado no Android (`capacitor.settings.gradle`, `capacitor.build.gradle`) e no iOS (`CapApp-SPM/Package.swift`).
- **`src/lib/mapaNativo/mapaGoogleNativo.js`:**
  - **Onde pode abrir:** no app, com o plugin no APK; no site, com a chave. A escolha fica no aparelho.
  - **Opções de criação:** satélite ou mapa; um dedo arrasta no site; sem botões nem ícones clicáveis do Google.
  - **Polígonos:** a mesma cor do MapLibre (`corDaAreaNoMapaGeral` + `corExibidaNoMapa`) e o estilo do pasto, com a linha em pixels físicos no Android.
  - **Outros:** caixa da fazenda; zoom convertido (Google = MapLibre + 1).
  - **Ciclo de vida:** id novo por mapa, registro do mapa aberto, destroy antes de recarregar, limpeza do mapa órfão.
- **`src/components/mapa/MapaGoogleNativo.jsx`:**
  - cria o mapa na vista salva da fazenda;
  - **no app:** página transparente em volta do mapa só com o Mapa Geral à vista, e `disableTouch` quando ele fica escondido (D-PROD-305);
  - satélite ou mapa;
  - áreas refeitas numa fila, uma troca de cada vez, sem polígono órfão;
  - toque no polígono abre a área;
  - grava a vista quando o mapa para;
  - na primeira abertura, enquadra a fazenda.
- **Mapa Geral:**
  - com a escolha ligada, usa o mapa do Google no lugar do MapLibre. O resto da tela é o mesmo, sem os avisos "Carregando mapa salvo…" e "Mapa indisponível" do MapLibre.
  - A escolha fica em Visualização → "Mapa do Google (teste)". Trocá-la destrói o mapa e recarrega a página.
  - Se o mapa do Google falhar, o app avisa e volta ao mapa de sempre.
- **Chave única:** `VITE_GOOGLE_MAPS_API_KEY`, que já está na Vercel e nos segredos do GitHub, serve o site, o Android e o iPhone.
  - O `build.gradle` põe a chave no `AndroidManifest`. O workflow usa `GOOGLE_MAPS_ANDROID_KEY` se existir e, senão, a chave do site.
  - O iPhone usa `VITE_GOOGLE_MAPS_IOS_KEY` se existir e, senão, a do site.
  - O workflow mostra no resumo a impressão **SHA-1** do certificado, para uma chave própria do app, se um dia for preciso.
- **Versão:** `app-version.json` 1.0.6, código 7. O `nativoMinimo` fica em 5: o pacote novo roda no APK 1.0.5, onde a escolha não aparece no app.

## O que o proprietário precisa fazer

1. **No Google Cloud** (APIs e serviços → Credenciais → a chave usada na Vercel):
   - **APIs ativadas no projeto:** "Maps JavaScript API" (site), "Maps SDK for Android" e "Maps SDK for iOS" (app).
   - **"Restrições do aplicativo":** para uma chave só servir também o app, ela não pode estar em **"Sites"**. Deixe em **"Nenhuma"** e mantenha as **"Restrições de API"** só nas APIs de mapa que o sistema usa.
   - **Em troca:** sem a restrição de site, a chave pode ser usada fora do sistema. Proteja com:
     - **cotas diárias** em cada API de mapa (APIs e serviços → a API → Cotas);
     - um **alerta de orçamento** (Faturamento → Orçamentos e alertas).
   - Quem preferir manter a chave do site restrita a "Sites" cria uma segunda chave, restrita a "Apps Android" (pacote `com.makgestao.app` + a SHA-1 do build), e a cadastra no GitHub como `GOOGLE_MAPS_ANDROID_KEY`.
2. **Testar no site:** Mapa Geral → Visualização → ligar "Mapa do Google (teste)".
3. **Testar no app:** instalar o APK 1.0.6 e ligar a mesma escolha.

## Testes

- `tests/smoke/mapaGoogleNativoD366.test.jsx`, 18 testes com o plugin falso:
  - cor igual à do MapLibre (modo padrão sem cinza, `#rrggbb`), estilos, escala do Android;
  - caixa e tipo; escolha no app (só com o plugin) e no site (só com a chave); opções de criação;
  - vista salva com zoom convertido, janela transparente e devolvida, toque → área, vista gravada, enquadramento;
  - trocas seguidas sem polígono órfão; `ativo` (fundo devolvido e toque largado; de volta, reabre);
  - destroy antes de recarregar; id novo por mapa;
  - site sem página transparente e com a chave do site; falha;
  - a escolha no painel.
- `avisoDeEnvioD346.test.js` (AE-03) passou a conferir `nativoMinimo` 5, e não a versão exata do app.
- Testes do Mapa Geral: passando. `gate:types`: sem dívida nova.

## Revisão independente

Uma revisão só de leitura (com o código do plugin aberto) achou um defeito crítico e três altos. Todos foram corrigidos:

1. **Toques presos (crítico).** Desligar o mapa recarregava a página sem destruir o mapa nativo. No Android ele seguia pegando os toques daquele pedaço da tela.
2. **Aviso fixo.** O aviso "Carregando mapa salvo…" do MapLibre ficava fixo no centro e roubava o toque.
3. **Áreas cinza.** No modo de cor padrão, as áreas ficavam cinza, e não na cor salva.
4. **Polígonos órfãos.** Trocas seguidas de cor deixavam polígonos velhos no mapa.

Também foram corrigidos:
- o mapa nativo aparecendo e pegando toques com o Mapa Geral escondido;
- o destroy atrasado de um mapa velho derrubando o novo, que tinha o mesmo id;
- o zoom ±1 entre os dois mapas;
- a linha e a margem em pixels físicos no Android;
- o tipo do mapa já na criação;
- a vista não gravada numa fazenda sem áreas.

## O que não deu para testar aqui

- **O mapa de verdade.** O container não tem Android nem iOS, e a chave do Google não está aqui. A prova é o site e o APK 1.0.6 com a chave real. O workflow do APK roda na PR e confere que o build com o plugin compila e é assinado.

## Limitações da etapa 1

- **Só áreas.** Lotes, cochos, pontos, tarefas e nomes ainda não aparecem no mapa do Google (etapas 2 e 3).
- **Localizar e local da tarefa.** "Localizar" e a escolha do local da tarefa pelo toque no mapa ainda são do MapLibre (etapa 4).
- **Sem internet.** O Google mostra o que já guardou, sem baixar área inteira.
