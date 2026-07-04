# Manual — Gestão de acessos do Book de Vendas BR Spices

Guia rápido para o setor administrativo incluir ou remover pessoas no painel.

## Como as pessoas acessam
- Endereço do painel: **https://bookdevendasbrspices.pages.dev**
- **Não existe senha.** A pessoa digita o **e-mail dela** e recebe um **código de 6 dígitos**
  no próprio e-mail. Digita o código e entra. (O código vale por alguns minutos; se expirar,
  é só pedir outro.)
- Só entra quem estiver **cadastrado** (veja abaixo). Quem não está cadastrado consegue fazer
  a verificação do e-mail, mas cai numa tela dizendo *"peça acesso ao administrativo"*.

## Quem pode gerenciar usuários
Apenas quem tem o perfil **Administrador**. Ao entrar no painel, essas pessoas veem no menu
lateral um item extra: **"Gestão de usuários"**. Hoje são administradores:
Fernando Oliveira, Ricardo Gobatto e Gabriel Daniel.

## Incluir uma pessoa nova (novo vendedor, gerente, etc.)
1. Entre no painel e clique em **"Gestão de usuários"** (menu lateral).
2. No quadro **"Incluir usuário"**, preencha:
   - **Nome completo** — ex.: `Maria Silva`
   - **E-mail** — o e-mail que a pessoa vai usar para entrar (de preferência o corporativo)
   - **O que pode ver** — escolha na lista:
     - **Visão completa** = enxerga a empresa toda (para diretoria/gestão)
     - **Gerente — [Nome]** = enxerga só a equipe daquele gerente
     - **Vendedor — [Nome]** = enxerga só a carteira daquele vendedor
   - **Cargo** (opcional) — um rótulo que aparece no rodapé, ex.: `GERENTE SUL`
   - Marque **"também administra usuários"** apenas se essa pessoa também for gerenciar acessos.
3. Clique em **"+ Incluir"**.
4. **Avise a pessoa**: "entre em bookdevendasbrspices.pages.dev, digite seu e-mail e o código
   que chegar". Pronto — ela já entra.

## Remover uma pessoa (saiu da empresa, trocou de função)
1. Em **"Gestão de usuários"**, ache a pessoa na lista.
2. Clique em **"Remover"** na linha dela e confirme.
3. A partir daí ela não consegue mais entrar.

## Trocar o que uma pessoa vê (mudou de equipe)
Basta **incluir de novo** com o mesmo e-mail e o novo escopo — o cadastro é atualizado.

## Perguntas comuns
- **A pessoa esqueceu a senha?** Não existe senha — é sempre código por e-mail. Não há o que resetar.
- **A pessoa não recebe o código?** Confira se o e-mail cadastrado está certo (sem erro de
  digitação) e peça para olhar a caixa de spam.
- **Os e-mails recebem algum arquivo/aviso do sistema?** Não. O sistema só envia o código de
  acesso quando a própria pessoa pede para entrar. Nada mais é enviado.
