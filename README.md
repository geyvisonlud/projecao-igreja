# Projeção Igreja

Software de apresentação para o telão da igreja (macOS). Versão 0.5: **banco de músicas**,
**roteiro do culto**, **telas com texto, imagens, vídeos e PowerPoint**, **timer** e **fundos em vídeo**.

## Como rodar no Mac

1. Instale o [Node.js](https://nodejs.org) (versão LTS).
2. No Terminal, dentro da pasta do projeto:

   ```sh
   npm install
   npm start
   ```

Para gerar um aplicativo (`.dmg`) que dá para instalar sem o Terminal:

```sh
npm run dist
```

O arquivo sai em `dist/`. Como o app não é assinado pela Apple, na primeira vez abra com
**botão direito → Abrir**.

## Como usar

A janela do app (o **Comando**) tem três partes, no estilo dos apps do Mac:

- **Barra lateral:** o **Roteiro** do culto e a **Biblioteca** (Músicas, Mídia, Timer).
- **Centro:** os slides do item escolhido, a lista de músicas, a biblioteca de mídia ou o timer.
- **Inspetor (direita):** prévias das duas telas de saída, fundo, ajustes de texto e o player de áudio.

### As telas

- **Palco**: o que o público vê (letra, imagens, vídeos com som, timer).
- **Retorno**: monitor virado para músicos e pregador. Mostra o relógio, o timer (sempre que estiver
  correndo), o slide atual em letra grande e, embaixo, **o que vem a seguir** (o próximo slide ou o
  próximo item do roteiro).
- **Comando**: a própria janela do operador, com as prévias do Palco e do Retorno.

Nos botões **Palco** e **Retorno** da barra de cima, escolha em qual tela cada uma aparece (ou
**Desligar**). A bolinha vermelha acende quando a tela está no ar. Sem tela externa, elas abrem em
janelas para teste. Enquanto alguma estiver aberta, o Mac não apaga a tela.

### Roteiro

O nome do roteiro aparece no alto; clique nele para trocar de roteiro, criar, renomear, duplicar ou
excluir. O **+** ao lado de "Roteiro" adiciona **Música**, **Timer**, **Telas** (texto, imagens,
vídeos e PowerPoint) ou **Áudio**. Também dá para arrastar músicas da lista para o roteiro e
arrastar os itens para mudar a ordem. Botão direito num item: **Editar** ou **Tirar do roteiro**.

Durante o culto, **→** avança os slides; no último slide de um item, ele seleciona o próximo item sem
projetar, e o próximo **→** projeta. Selecionar um timer do roteiro carrega a duração dele; se outro
timer estiver correndo, aparece **Carregar** para trocar na hora certa.

| Tecla | Ação |
| --- | --- |
| → ↓ espaço PageDown | próximo slide |
| ← ↑ PageUp | slide anterior |
| B | tela preta |
| C ou Esc | limpar (esconde a letra, fica só o fundo) |
| ⌘N | nova música |
| ⌘F | buscar música |
| ⌘, | ajustes |

### Músicas

Em **Músicas**, **Nova música**, cole a letra e salve. Linha em branco separa os slides; `[Verso 1]`,
`[Refrão]`, `[Ponte]` nomeiam as partes; uma linha só com `[Refrão]` repete o refrão; cifras e
tablaturas coladas de sites são removidas.

### Mídia (imagens, vídeos e áudios)

Em **Mídia**, **Enviar arquivos** ou arraste do Finder. Os arquivos são copiados para a pasta de
dados do app. **Duplo clique** mostra a imagem/vídeo no Palco ou toca o áudio. **Botão direito**:
Mostrar no Palco, Tocar, **Usar como fundo**, **Adicionar ao roteiro** ou Excluir.

Os **áudios** (playback, vinhetas, música ambiente) tocam pelo som do Mac, com o player no canto
de baixo à direita (tocar/pausar, posição e volume). Não aparecem no telão.

### Telas (sermão, avisos, momentos do culto)

No editor de **Telas**: **Texto**, **Da biblioteca…**, **Arquivo do Mac…** e **PowerPoint, Keynote
ou PDF…** (cada página vira um slide; a conversão usa o Keynote, o PowerPoint ou o LibreOffice, o que
houver no Mac — na primeira vez o macOS pede permissão para controlar o Keynote). Vídeos tocam com
som no Palco, com os botões **Pausar vídeo** e **Do início** no inspetor.

### Fundos

O app vem com dois fundos em vídeo (*Roxo suave* e *Ondas brancas*). **Enviar fundo…** no inspetor,
arrastar arquivos para a área de fundos, ou **Usar como fundo** na biblioteca. Botão direito num fundo
enviado: **Tirar dos fundos**. Em fundos claros, aumente *Escurecer fundo* em **Texto**.

### Logo nas músicas

Enquanto a letra de uma música está no Palco, o logo da igreja (*On The Way*) aparece pequeno no
canto superior direito, com 35% de opacidade. Em **Logo nas músicas**, no inspetor: ligar/desligar,
tamanho, opacidade e **Trocar imagem…** (use um PNG com fundo transparente).

### Tradução simultânea

Legenda automática no Palco com a tradução do que está sendo falado no microfone do Mac, em
português → inglês ou inglês → português. Usa o **Microsoft Azure Speech** (precisa de internet).

1. No [portal do Azure](https://portal.azure.com), crie um recurso **Speech** (há um plano gratuito
   de 5 horas por mês; depois, cerca de US$ 2,50 por hora de áudio).
2. Em *Chaves e ponto de extremidade*, copie a **Chave** e a **Região** (ex.: `brazilsouth`).
3. No app, **Ajustes** (⌘,) → *Tradução simultânea*: cole a região e a chave. A chave fica guardada
   no chaveiro do Mac.
4. No inspetor, em **Tradução simultânea**, escolha a direção e o microfone (ex.: a entrada que vem
   da mesa de som) e clique em **Iniciar tradução** — ou use o botão **Tradução** da barra de cima
   (tecla **T**). Na primeira vez o macOS pede permissão para usar o microfone.

A legenda aparece embaixo, centralizada, em amarelo sobre fundo preto (cor do texto, cor e
opacidade do fundo, tamanho e número de linhas são editáveis). Ela continua visível mesmo com a
**Tela preta**. No inspetor, o operador vê o que foi ouvido e a tradução.

### Nuvem (Google Drive)

Em **Ajustes** (⌘,), escolha onde guardar músicas, roteiros e arquivos:

- **Neste Mac** (padrão);
- **Google Drive**: instale o [Google Drive para computador](https://www.google.com/drive/download/)
  e escolha esta opção. Tudo vai para a pasta *Projeção Igreja* no seu Drive, que o próprio Drive
  sincroniza com a nuvem e com outros Macs. Se a pasta já tiver dados (de outro Mac), o app passa a
  usá-los; senão, copia os dados atuais para lá. Use o app em um Mac por vez para não haver conflito;
- **Outra pasta** qualquer (ex.: Dropbox, iCloud Drive, um HD externo).

## Onde ficam os dados

Na pasta escolhida em **Ajustes** (por padrão `~/Library/Application Support/projecao-igreja/`):
`songs.json` (músicas), `plans.json` (roteiros), `media.json` e a pasta `media/` (imagens, vídeos,
áudios e páginas importadas). As preferências deste Mac (`settings.json`, `config.json`) ficam
sempre na pasta do app. Para fazer backup, copie a pasta de dados.

## Estrutura

- `main.js`: processo principal do Electron (janelas, telas, arquivos de dados)
- `preload.js`: ponte segura entre as janelas e o processo principal
- `src/operator.*`: tela do operador
- `src/projection.*`: tela do Palco · `src/stage.*` e `src/lib/stage-view.js`: tela de Retorno
- `src/lib/icons.js`: ícones da interface
- `src/lib/lyrics.js`: divisão da letra em slides (testes em `test/`, rode `npm test`)
- `src/lib/screen-view.js`: desenha o telão; usado na projeção e na prévia do operador
- `src/vendor/azure-speech/`: SDK de voz da Microsoft 1.52 (MIT), para a tradução simultânea
- `src/vendor/pdfjs/`: [pdf.js](https://mozilla.github.io/pdf.js/) 3.11 (Apache-2.0), para
  transformar páginas de PDF em imagens
- `assets/backgrounds/`: fundos em vídeo que acompanham o app · `assets/logo/`: logo padrão

## Próximos passos

- fundo próprio por música, logo da igreja
- Bíblia, avisos, controle pelo celular
