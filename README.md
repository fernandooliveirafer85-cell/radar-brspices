# Book de Vendas BR Spices — Painel Comercial Web

Dashboard comercial para gestão, gerentes e vendedores, com acesso por e-mail e dados privados.

- **Painel (produção):** https://bookdevendasbrspices.pages.dev (Cloudflare Pages)
- **Gestão de acessos:** ver [MANUAL-ADMINISTRATIVO.md](MANUAL-ADMINISTRATIVO.md)

> Este repositório (`bookdevendasbrspices.github.io`) foi **aposentado** — serve apenas um
> redirecionamento para o novo endereço. O código de produção está na pasta [`cf/`](cf/).

## Arquitetura (Rota B — Cloudflare)
```
BASE PROTHEUS (xlsx) → tools/export_radar.py → tools/kv_bulk.local.json
   → wrangler kv bulk put --remote → cofre KV (privado)
Usuário → Cloudflare Access (login por e-mail / código) → cf/functions/api/dados.js
   → entrega só o escopo do e-mail autenticado (mapa em KV "usuarios")
```
- **Sem senha:** login por código de 6 dígitos no e-mail (Cloudflare Access).
- **Dados privados:** vivem no KV da Cloudflare, nunca no repositório público.
- **Perfis:** visão completa (diretoria) · gerente (sua equipe) · vendedor (sua carteira).
- **Gestão de usuários:** página `/admin.html` (restrita a administradores).

## Atualizar os dados (enquanto a automação não entra)
```powershell
$py = "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe"
& $py tools\export_radar.py            # gera tools/kv_bulk.local.json (dados) + senhas locais
cd cf
wrangler kv bulk put ..\tools\kv_bulk.local.json --namespace-id <ID_DO_KV> --remote
```
> `--remote` é obrigatório (sem ele o wrangler grava num simulador local e o site vê dados vazios).

## Estrutura
```
index.html                redirecionamento para o novo endereço
MANUAL-ADMINISTRATIVO.md   guia do setor administrativo
tools/export_radar.py      ETL: BASE PROTHEUS → dados agregados
cf/                        CÓDIGO DE PRODUÇÃO (Cloudflare Pages)
  public/                  index.html (painel), admin.html, assets
  functions/api/           dados.js, usuarios.js, escopos.js, _lib.js
  wrangler.jsonc           config do projeto (binding do KV)
```

## Páginas
1. Overview (KPIs, evolução 12 meses, semáforo, filtros de período)
2. Metas vs Realizado (gerente → vendedor → cliente, gaps)
3. Positivados (semáforo de recência, valor em risco)
4. Rankings (gerentes, vendedores, clientes, famílias)
+ exportação PDF/Excel por visão.

## Backlog
- Automação: rodar o ETL na nuvem sem PC ligado (upload da planilha → GitHub Actions/Worker → KV).
- Páginas Clientes, Carteira/Pedidos, Anotações.
