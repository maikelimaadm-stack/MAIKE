# App Android e iOS (Capacitor)

O MAIKE roda como app nativo pelo Capacitor 8: o mesmo frontend (`dist/`) vai empacotado dentro do app, então ele **abre sem internet**. Os dados continuam vindo da API de produção.

## Configuração

- `capacitor.config.json`: `appId` `com.makgestao.app`, nome "MAK Gestão", `webDir` `dist`.
- Projetos nativos: `android/` e `ios/` (gerados por `npx cap add`). O que é gerado em build (`android/app/src/main/assets/public`, `android/**/build`, `ios/App/App/public`, `ios/App/Pods`) fica fora do Git.
- Origens do app no backend: `https://localhost` (Android) e `capacitor://localhost` (iOS) precisam estar em `FRONTEND_ORIGINS` na Vercel. Sem isso, o CORS responde 404 e o app não loga.

## APK assinado pelo GitHub (caminho normal)

O workflow `.github/workflows/app-android.yml` gera o APK já assinado com a chave fixa e publica numa Release `app-vX.Y.Z` do GitHub. Para baixar: aba **Releases** do repositório → a versão mais nova → `MAK-Gestao-X.Y.Z.apk`.

- Roda sozinho quando `app-version.json` muda na `main`, ou à mão em Actions → app-android → Run workflow.
- Nunca sobrescreve uma versão publicada: versão nova = subir `versionName` e `versionCode`.
- Só publica se o APK estiver assinado com o certificado da chave fixa (impressão digital SHA-256 no próprio workflow).
- Segredos do repositório (Settings → Secrets and variables → Actions): `MAKGESTAO_KEYSTORE_BASE64` (o `.jks` em base64), `MAKGESTAO_KEYSTORE_PASSWORD` e `VITE_GOOGLE_MAPS_API_KEY`.

## Gerar o APK de teste à mão (Android)

Pré-requisitos: Node 22+, JDK 21 e Android SDK (plataforma 36, build-tools 36) com `ANDROID_HOME` apontando para ele.

Variáveis de build (não versionar; R4):

- `VITE_MAIKE_API_URL=https://www.makgestao.com`: só a origem (o app acrescenta `/api/native`). Dentro do app (Capacitor) vale sempre esta URL, e não a origem da página (`https://localhost`), regra em `src/config/runtimeConfig.js`;
- `VITE_GOOGLE_MAPS_API_KEY`: a mesma chave do site (satélite).

## Versão e assinatura

- A versão fica em `app-version.json` (`versionName` e `versionCode`). A cada versão nova, suba os dois; o `versionCode` só cresce.
- O APK de uso é assinado com a chave fixa `makgestao-release.jks` (alias `makgestao`). A chave e a senha **nunca** entram no repositório: vêm de `MAKGESTAO_KEYSTORE` (caminho do arquivo) e `MAKGESTAO_KEYSTORE_PASSWORD`. Perder a chave obriga a desinstalar o app em todos os aparelhos.

```bash
npm run app:build
```

```bash
cd android && ./gradlew assembleRelease
```

O APK sai em `android/app/build/outputs/apk/release/app-release.apk` e instala por arquivo no Android, por cima da versão anterior assinada com a mesma chave.

## iOS

`npm run app:build` atualiza `ios/`. O build do iOS (IPA) só roda num Mac com Xcode: abrir `ios/App/App.xcworkspace`, escolher a equipe de assinatura e rodar no aparelho ou exportar.

## Mapa do Google (D-PROD-366)

O Mapa Geral tem o mapa do Google pelo plugin oficial `@capacitor/google-maps`. No app Android e iOS é o mapa **nativo**: o Google não cobra e o SDK guarda as imagens já vistas, como no AgriWebb. No site é a versão web do mesmo plugin (Maps JavaScript API), cobrada por abertura do mapa e não por imagem.

- **Etapa 1 (em teste):**
  - Mostra o satélite do Google com as áreas (cores e estilo do Mapa Geral), e o toque na área abre o detalhe.
  - Liga em Mapa Geral → Visualização → "Mapa do Google (teste)", por aparelho. No app, só aparece a partir do APK 1.0.6.
  - Se o mapa não abrir, o app avisa e volta ao mapa de sempre.
- **Chave:** a `VITE_GOOGLE_MAPS_API_KEY` (Vercel e segredos do GitHub) serve o site, o Android e o iPhone.
  - Para o app, ela não pode ter a restrição de aplicativo "Sites". Use "Nenhuma", com restrição de API, cotas diárias e alerta de orçamento.
  - Opcional: `GOOGLE_MAPS_ANDROID_KEY` (chave própria do Android, restrita ao pacote e à SHA-1 que o build mostra) e `VITE_GOOGLE_MAPS_IOS_KEY`.
- **Sem internet:** o Google mostra o que já guardou, sem baixar área inteira.
- **Ícones no app (D-PROD-372, D-PROD-373):**
  - Os lotes, cochos, pontos e tarefas ficam por cima do mapa nativo, com os mesmos ícones do sistema.
  - A partir do APK 1.0.7, o mapa nativo avisa a câmera a cada quadro e os ícones andam junto ao arrastar e ao dar zoom. No APK 1.0.6, eles somem durante o movimento.
  - O aviso a cada quadro vem de um remendo no plugin (`scripts/app/remendar-google-maps.mjs`), aplicado no `postinstall`, antes do `cap sync` e do build. Ao subir a versão do `@capacitor/google-maps`, conferir o teste `mapaGoogleCameraD373`.
- **Ícones e nomes como marcadores do mapa (D-PROD-374):**
  - A partir do APK 1.0.8 (código 9), os ícones e os nomes dos pastos são marcadores do próprio mapa nativo e andam colados nele, sem tremer.
  - O remendo também faz o marcador aceitar a imagem `data:` e faz o toque no marcador não centralizar o mapa.
  - No APK 1.0.7 ou mais antigo, os ícones continuam no `div` por cima do mapa.
- **Camada nativa do Mapa Geral (D-PROD-376, APK 1.0.9 em diante, Android):**
  - Os ícones e os nomes são desenhados pelo próprio app (`CamadaDoMapaPlugin.java`, `CamadaDoMapaView.java`), por cima do mapa do Google, a cada passo da câmera.
  - Os nomes mudam de tamanho junto com o zoom. As imagens são as do sistema.
  - O plugin do mapa avisa cada passo pelo gancho `MaikeCamera`, criado pelo remendo do `postinstall`.
  - Ao subir a versão do `@capacitor/google-maps`, conferir também a versão do `play-services-maps` no `android/app/build.gradle`. O teste `mapaGoogleCamadaNativaD376` compara as duas.

## Permissões

- Android (`AndroidManifest.xml`): internet, localização (GPS do mapa: ponto, área e "onde estou") e câmera (fotos dos formulários). O Android pergunta na primeira vez que a função é usada.
- iOS (`Info.plist`): textos de localização, câmera e fotos.
- Permissão nova é mudança nativa: exige APK novo (não vai pela atualização automática).

## Login (D-PROD-294)

- No app o login fica guardado no aparelho até a pessoa tocar em "Sair" (a opção "Manter conectado" não aparece: vale sempre).
- Com internet, o app troca o login por um novo de 30 dias (`POST /auth/renovar`). Quem abre o app ao menos uma vez a cada 30 dias com internet não precisa entrar de novo.
- Suspender a conta, trocar a senha ou o papel derruba a sessão do app na próxima vez que ele falar com o servidor.

## Sem internet (D-PROD-294)

- **Primeira vez:** depois de entrar, o app mostra "Preparando o app para usar no campo" e só abre quando baixou mapa, áreas, lotes, cadastros e as telas do sistema. **Depois:** abre direto com o que está no celular e sincroniza sozinho a cada 6 h com internet; o menu do usuário → "Dados sem internet" atualiza na hora.
- **Internet fraca:** com cópia no celular, a tela espera o servidor no máximo 6 s e abre com a cópia.
- **Abre:** telas, código e ícones estão dentro do app, e o login guardado vale (sem aviso na tela).
- **Mapa:** sem internet, fundo liso local com áreas, pontos e lotes por cima, sem mensagens.
- **Satélite sem internet:** com a chave da MapTiler (`VITE_MAPTILER_KEY` na Vercel e no segredo do GitHub), o satélite do app é da MapTiler e as imagens já vistas ficam em cache no celular (até 30 dias). Sem a chave, o app usa o Google (sem cache: o Google proíbe uso offline).
- **Mostra:** tudo o que foi baixado ou visto com internet (leituras guardadas no aparelho, por fazenda).
- **Quando a rede volta:** o app confere o login no servidor sozinho.
- **Ainda precisa de internet:** o primeiro login e **gravar** (lançar, editar, excluir). Registrar sem internet e enviar depois é a próxima etapa.

## Atualização automática (D-PROD-294)

- Frontend novo chega sem instalar APK: a cada deploy da Vercel, `npm run app:pacote` publica `/app-atualizacao/ultima.json` e o pacote `.zip`.
- O app confere ao abrir e ao voltar para a frente; baixa por baixo e aplica na **próxima abertura**. Se a versão nova não abrir, volta sozinho à anterior.
- **Precisa de APK novo** só para mudança nativa (plugin novo, permissão, ícone): suba `versionCode` em `app-version.json`; pacotes com `nativoMinimo` maior que o APK instalado não são aplicados.
- D-PROD-346: quando o pacote novo também roda no APK anterior (o código confere se o plugin nativo existe), `nativoMinimo` em `app-version.json` fica no `versionCode` anterior. Assim quem ainda não instalou o APK novo continua recebendo as atualizações. Exemplo: 1.0.5 (código 6) com `nativoMinimo: 5`.
- Plugin `@capgo/capacitor-updater` em modo manual, sem servidor da Capgo (estatística e canais desligados).
