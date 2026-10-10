# FormScript

Extensao de navegador para Chrome e Brave, baseada no Manifest V3.

## Estrutura

```text
formscript/
|-- assets/
|   `-- icons/          # Icones da extensao
|-- src/
|   |-- background/     # Service worker e eventos do navegador
|   |-- content/        # Scripts executados nas paginas
|   |-- consent/        # Janela de confirmacao de salvamento
|   |-- options/        # Pagina de configuracoes
|   `-- popup/          # Interface do botao da extensao
|-- manifest.json       # Metadados e configuracao da extensao
`-- README.md
```

## Carregar para desenvolvimento

1. Abra `chrome://extensions` no Chrome ou `brave://extensions` no Brave.
2. Ative o modo do desenvolvedor.
3. Selecione **Carregar sem compactacao** e escolha a pasta raiz deste projeto.

## Testar a extensao

Use o formulario de demonstracao do httpbin: [https://httpbin.org/forms/post](https://httpbin.org/forms/post).

1. Abra a pagina em uma aba com o FormScript instalado e ativado.
2. Preencha alguns campos com dados ficticios, como `Teste FormScript` e `teste@example.com`. Nao use senhas, dados reais ou informacoes pessoais.
3. Envie o formulario. A janela central do FormScript deve perguntar se deseja salvar os campos compativeis.
4. Selecione **Salvar**. O site exibira a resposta do envio.
5. Abra novamente [https://httpbin.org/forms/post](https://httpbin.org/forms/post). O icone do FormScript deve mostrar o badge `1`.
6. Clique no icone da extensao e selecione **Preencher formulario**. Os valores salvos devem aparecer; o formulario nao sera enviado automaticamente.

Se a pagina de teste nao abrir ou mudar seu formulario, confira tambem em `chrome://extensions` ou `brave://extensions` se a extensao esta ativa e sem erros.

## Funcionalidades

- Ao enviar um formulario, a extensao abre uma janela do FormScript no canto inferior direito. **OK** salva os dados; `Esc` descarta e fecha a janela.
- Se um formulario ja salvo for enviado novamente com valores diferentes, a janela oferece atualizar o registro; `Esc` mantem os valores anteriores. Com **Perguntar antes de salvar** desativado, os novos valores substituem os anteriores automaticamente.
- O botao da extensao preenche manualmente um formulario correspondente ao site atual. O preenchimento nao envia o formulario.
- Quando a pagina atual tem um formulario correspondente ja salvo, o icone da extensao mostra o badge `1` naquela aba. A verificacao acontece ao carregar a pagina e ao voltar para a aba.
- As configuracoes e os formularios aceitos ficam no armazenamento local do perfil do navegador (`chrome.storage.local`); nao sao enviados a um servidor.
- Em **Configuracoes e backup**, e possivel baixar um backup JSON ou restaurar um arquivo FormScript. Restaurar substitui os formularios e configuracoes FormScript existentes neste navegador, apos confirmacao.
- Em **Formularios armazenados**, e possivel excluir os dados de um site ou apagar todos os formularios salvos.
- Desativar **Perguntar antes de salvar** salva automaticamente os formularios novos enviados.

## Privacidade e limites

- Campos de senha, nome de usuario, codigo de uso unico, dados de cartao e campos com autocomplete de credenciais/pagamento nao sao capturados nem preenchidos.
- A captura ocorre no evento de envio da pagina. Sites que enviam formularios sem um evento `submit` padrao podem nao ser detectados.
- O preenchimento usa o site (origem), caminho da acao e nomes/tipos dos campos para encontrar o formulario correspondente. Formularios que mudam dinamicamente podem nao corresponder ao salvo.
- O arquivo de backup pode conter dados pessoais dos formularios. Proteja-o como protegeria esses dados.
- O acesso a paginas e concedido pelo navegador para que o content script detecte envios e preencha formularios.
