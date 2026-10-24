# Projeção Igreja

Software de apresentação para o telão da igreja (macOS). Versão 0.3: **banco de músicas**,
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

**Roteiro do culto:** na parte de cima da coluna da esquerda. Monte antes do culto:

- **+** ao lado de uma música da biblioteca (ou arrastar a música para o roteiro) coloca a música
  no roteiro. Se ainda não houver roteiro, um "Culto" é criado automaticamente;
- **+ Timer**: contagem regressiva com duração e mensagem próprias (ex.: "Estudo da Lição", 35 min);
- **+ Telas**: uma sequência de slides que mistura **texto** (versículos, avisos, títulos),
  **imagens**, **vídeos** e páginas de **PowerPoint, Keynote ou PDF**. Serve para momento de
  fidelidade, adoração infantil, oração, sermão, avisos…;
- arraste os itens para mudar a ordem; **✕** tira do roteiro; duplo clique edita;
- **Novo**, **Editar** (nome e data), **Duplicar** (bom para repetir o culto da semana anterior)
  e **✕** (excluir o roteiro) ficam no cabeçalho.

Durante o culto, ao chegar no último slide de um item, **→** seleciona o próximo item do roteiro
sem projetá-lo; o próximo **→** projeta o primeiro slide dele. Assim dá para fazer uma pausa entre
as músicas. Selecionar um timer do roteiro carrega a duração e as mensagens dele na aba Timer;
depois é só **Iniciar** e **Projetar**. Se um timer já estiver correndo (por exemplo o da Lição),
selecionar o próximo não mexe nele: aparece o botão **Carregar** para trocar na hora certa.

Exemplo de culto montado assim: Timer "Estudo da Lição" 35 min → Timer "O culto começa em" 5 min →
Música 1 → Telas "Momento de fidelidade" → Música 2 → Telas "Adoração infantil" (vídeo) → Música 3 →
Telas "Momento de oração" → Telas "Sermão" (PowerPoint + versículos) → Música 4 → Telas "Avisos".

**Telas:** no editor (**+ Telas**), use **+ Texto**, **+ Imagem ou vídeo** e
**+ PowerPoint / Keynote / PDF**, ou arraste arquivos do Finder para a lista. Cada página da
apresentação vira uma imagem. Para converter PowerPoint/Keynote o app usa o **Keynote** (vem
grátis no Mac), o PowerPoint ou o LibreOffice, o que estiver instalado. Na primeira vez o macOS
pergunta se o app pode controlar o Keynote: responda **OK**. Se nada disso funcionar, exporte a
apresentação como PDF e importe o PDF. Vídeos das telas tocam **com som** no telão (a prévia fica
muda); enquanto um vídeo está no ar aparecem os botões **Pausar vídeo** e **Do início**. Marque
*Repetir em loop* no editor para vídeos que devem ficar rodando.

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

**Fundos:** o app já vem com dois fundos em vídeo (*Roxo suave* e *Ondas brancas*). Para enviar
outros, use **+ Enviar vídeo ou imagem** ou arraste arquivos do Finder para o painel de fundos
(mp4, mov, m4v, webm, jpg, png…). Os arquivos são **copiados para dentro do app**, então pode
apagar ou mover o original. Vídeos de fundo tocam em loop, sem som. Prefira vídeos em H.264
(`.mp4`); `.mov` em ProRes não toca. Em fundos claros como *Ondas brancas*, aumente
*Escurecer fundo* para a letra branca continuar legível.

## Onde ficam os dados

Em `~/Library/Application Support/projecao-igreja/`: `songs.json` (músicas), `plans.json`
(roteiros), `media.json` e a pasta `media/` (fundos, imagens, vídeos e páginas importadas) e
`settings.json` (preferências). Para fazer backup do banco de músicas, copie o
`songs.json`.

## Estrutura

- `main.js`: processo principal do Electron (janelas, telas, arquivos de dados)
- `preload.js`: ponte segura entre as janelas e o processo principal
- `src/operator.*`: tela do operador
- `src/projection.*`: janela do telão
- `src/lib/lyrics.js`: divisão da letra em slides (testes em `test/`, rode `npm test`)
- `src/lib/screen-view.js`: desenha o telão; usado na projeção e na prévia do operador
- `src/vendor/pdfjs/`: [pdf.js](https://mozilla.github.io/pdf.js/) 3.11 (Apache-2.0), para
  transformar páginas de PDF em imagens
- `assets/backgrounds/`: fundos em vídeo que acompanham o app

## Próximos passos

- tela de palco (próximo slide, relógio, cronômetro da pregação)
- fundo próprio por música, logo da igreja
- Bíblia, avisos, controle pelo celular
