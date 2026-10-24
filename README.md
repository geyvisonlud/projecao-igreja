# Projeção Igreja

Software de apresentação para o telão da igreja (macOS). Versão 0.1: **banco de músicas**,
**projeção de letras**, **timer** e **fundos em vídeo/imagem**.

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

**Telão:** ligue o projetor/TV no Mac, escolha a tela em *Telão* e clique em **Abrir projeção**.
A projeção ocupa a tela externa inteira; o operador continua no Mac. Sem tela externa, ela abre
numa janela para testes. Enquanto a projeção está aberta, o Mac não apaga a tela.

**Músicas:** clique em **+ Nova** (⌘N), cole a letra e salve. As regras de divisão:

- linha em branco → novo slide;
- `[Verso 1]`, `[Refrão]`, `[Ponte]` (ou `Refrão:`) → dá nome à parte;
- uma linha só com `[Refrão]` → repete o refrão já cadastrado;
- blocos maiores que o limite de *Linhas por slide* são divididos automaticamente;
- cifras e tablaturas coladas de sites de cifra são removidas.

A busca (⌘F) procura no título, artista, tags e no texto da letra, sem diferenciar acentos.

**Durante o culto:** clique num slide para mandá-lo ao telão.

| Tecla | Ação |
| --- | --- |
| → ↓ espaço PageDown | próximo slide |
| ← ↑ PageUp | slide anterior |
| B | tela preta (liga/desliga) |
| C ou Esc | ocultar letra, deixando só o fundo |

Passadores de slide (controle remoto) funcionam, pois enviam PageDown/PageUp.

**Timer:** escolha a duração (ou "até as 19:00"), clique em **Iniciar** e depois em
**Projetar timer no telão**. Dá para pausar e somar/subtrair 1 minuto com o timer no ar. No
último minuto os números ficam amarelos; ao zerar aparece a *mensagem ao terminar*, se houver.

**Fundos:** **+ Adicionar vídeo ou imagem** (mp4, mov, m4v, webm, jpg, png…). Vídeos tocam em
loop, sem som. Os arquivos não são copiados: se você mover ou apagar o arquivo original, ele
aparece apagado na lista. Prefira vídeos em H.264 (`.mp4`); `.mov` em ProRes não toca.

## Onde ficam os dados

Em `~/Library/Application Support/projecao-igreja/`: `songs.json` (músicas), `media.json`
(fundos) e `settings.json` (preferências). Para fazer backup do banco de músicas, copie o
`songs.json`.

## Estrutura

- `main.js`: processo principal do Electron (janelas, telas, arquivos de dados)
- `preload.js`: ponte segura entre as janelas e o processo principal
- `src/operator.*`: tela do operador
- `src/projection.*`: janela do telão
- `src/lib/lyrics.js`: divisão da letra em slides (testes em `test/`, rode `npm test`)
- `src/lib/screen-view.js`: desenha o telão; usado na projeção e na prévia do operador

## Próximos passos

- tela de palco (próximo slide, relógio, cronômetro da pregação)
- roteiro do culto (lista de músicas e itens na ordem)
- fundo próprio por música, logo da igreja
- Bíblia, avisos, controle pelo celular
