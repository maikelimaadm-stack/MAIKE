# Mapa nativo do Google no app — etapa 1 (D-PROD-366)

**Data:** 2026-11-27 · sem servidor, sem migration · **APK 1.0.6 (código 7)** · decisão: [D-PROD-366](./DECISIONS.md)

## Por quê

O proprietário perguntou como o AgriWebb abre o mapa rápido sem pagar.

Analisei o APK do AgriWebb que ele mandou. O app usa o **Google Maps nativo do Android** (`com.google.android.gms.maps`, modos satélite e híbrido) e nenhum outro provedor de satélite.

- **Não paga:** o Google não cobra pelo mapa nativo dos SDKs de Android e iOS.
- **Guarda as imagens:** o próprio SDK guarda no aparelho as imagens já vistas, dentro das regras do Google.
- **É liso:** o mapa é desenhado em código nativo, não numa página web.

O MAKGestão desenha o mapa numa página web dentro do app (MapLibre), com o satélite da Map Tiles API. Essa API conta cada imagem baixada e não deixa guardar imagem no aparelho.

O proprietário escolheu o mapa nativo do Google no Android e no iOS, por etapas.

## O que muda nesta etapa

- **Plugin oficial** `@capacitor/google-maps` 8.0.1 (Capacitor 8), registrado no Android (`capacitor.settings.gradle`, `capacitor.build.gradle`) e no iOS (`CapApp-SPM/Package.swift`).
- **`src/lib/mapaNativo/mapaGoogleNativo.js`:**
  - polígonos das áreas: cor da coloração, estilo do pasto, `tag` = id da área;
  - caixa da fazenda;
  - tipo do mapa;
  - escolha do aparelho;
  - teste "o plugin está no aparelho?".
- **`src/components/mapa/MapaGoogleNativo.jsx`:**
  - cria o mapa na vista salva da fazenda, a mesma chave do MapLibre;
  - deixa transparentes os fundos entre o mapa e a raiz, porque o mapa nativo fica atrás da WebView, e devolve tudo ao sair;
  - satélite ou mapa;
  - áreas refeitas quando mudam as áreas, a coloração ou o estilo;
  - toque no polígono abre a área;
  - grava a vista quando o mapa para;
  - na primeira abertura, enquadra a fazenda.
- **Mapa Geral:**
  - com a escolha ligada e o plugin no aparelho, usa o mapa do Google no lugar do MapLibre. O resto da tela (barra, painéis, legenda, detalhes) é o mesmo.
  - A escolha fica em Visualização → "Mapa do Google (teste)" e só aparece com o plugin. Trocá-la recarrega a página.
  - Se o mapa do Google falhar, o app avisa, desliga a escolha e volta ao mapa de sempre.
- **Android:**
  - `build.gradle` lê `GOOGLE_MAPS_ANDROID_KEY` e põe a chave no `AndroidManifest` (`com.google.android.geo.API_KEY`).
  - O workflow `app-android` passa o segredo ao build e mostra no resumo a impressão **SHA-1** do certificado, para restringir a chave.
  - Na PR, a falta da chave só avisa. Na publicação, ela é obrigatória, porque o mapa nativo sem chave fecha o app ao abrir.
- **iPhone:** `VITE_GOOGLE_MAPS_IOS_KEY` (`runtimeConfig`), passada ao plugin pelo código. Na falta dela, vai a chave do site.
- **Versão:** `app-version.json` 1.0.6, código 7. O `nativoMinimo` fica em 5: o pacote novo roda no APK 1.0.5, onde a escolha não aparece.

## O que o proprietário precisa fazer

1. No Google Cloud, no mesmo projeto, com o "Maps SDK for Android" ativado (ele confirmou), criar uma chave restrita:
   - a "Apps Android";
   - pacote `com.makgestao.app`;
   - impressão SHA-1 que o build mostra;
   - API "Maps SDK for Android".
2. Cadastrar a chave no GitHub (Settings → Secrets and variables → Actions) com o nome `GOOGLE_MAPS_ANDROID_KEY`. Nunca pelo chat.
3. Instalar o APK 1.0.6, abrir o Mapa Geral → Visualização → ligar "Mapa do Google (teste)".
4. iPhone, quando houver Mac:
   - chave restrita a "Apps iOS" com o bundle do app;
   - em `VITE_GOOGLE_MAPS_IOS_KEY`, na Vercel e no build do Mac.

## Testes

- `tests/smoke/mapaGoogleNativoD366.test.jsx`, 10 testes, com o plugin falso:
  - G366-1: polígonos, cor de reserva, estilos Cheio/Suave/Contorno, área sem contorno fora.
  - G366-2: caixa da fazenda, tipo do mapa, escolha do aparelho; sem o plugin nunca liga.
  - G366-3:
    - vista salva, satélite, fundos transparentes e devolvidos, toque → área, vista gravada, destruição ao sair;
    - enquadra na primeira abertura;
    - troca de coloração, estilo e tipo; áreas escondidas;
    - falha avisa.
  - G366-4: a escolha só aparece com o plugin e alterna.
- Testes do Mapa Geral (18 arquivos, 275 testes): passando, sem mudança.
- `gate:types`: sem dívida nova.

## O que não deu para testar aqui

- **O mapa nativo de verdade.** O container não tem Android nem iOS. A prova real é o APK 1.0.6 no aparelho do proprietário. O workflow do APK roda na PR e confere que o build com o plugin compila e é assinado.
- **iPhone.** Só num Mac com Xcode.

## Próximas etapas

- **2.** Lotes, cochos, pontos e tarefas como marcadores do Google, com as imagens já desenhadas nas etapas 2 e 3 do mapa leve; toque e toque longo.
- **3.** Nomes dos pastos (imagens da etapa 4), com o nível nome / nome + ha / sigla pelo zoom.
- **4.** Coloração por situação, forragem e farol; focos; arrastar lote; minha localização.
- **Depois.** A escolha vira o padrão do app. O editor de áreas continua no MapLibre até haver pedido.

## Riscos

- **Dois mapas para manter:** o nativo no app e o MapLibre no site.
- **Visual:** o desenho passa a ser do Google. Divisas, realce e posição dos nomes podem variar um pixel.
- **Sem internet:** o Google mostra o que já guardou, sem baixar área inteira.
