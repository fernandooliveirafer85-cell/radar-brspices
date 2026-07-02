# Radar BR Spices — Painel Comercial Web

Dashboard comercial em HTML/JS para gestão, gerentes e vendedores, com acesso controlado por perfil.

## Como funciona
```
BASE PROTHEUS (xlsx) → script de exportação → JSONs criptografados por perfil → git push → site atualiza
```

- **Perfis:** gestor (tudo) · gerente (sua equipe) · vendedor (sua carteira)
- **Proteção v1:** dados criptografados no navegador com senha por pessoa (AES). Nenhum dado aberto é commitado.
- **Backlog:** migrar autenticação para Cloudflare Pages + Access.

## Estrutura
```
index.html          página principal (SPA)
assets/css, js      estilos e lógica
data/               SOMENTE JSONs criptografados (nunca dados abertos)
tools/              scripts de exportação/publicação (não publicados no site)
```

## Regra de ouro
**Nunca** commitar dados abertos (CNPJ, faturamento). O `.gitignore` bloqueia `*.xlsx` e `data/*.json` não criptografados.

## Páginas v1
1. Visão Geral (KPIs mês/YTD)
2. Metas vs Realizado
3. Positivados (semáforo de recência)
4. Rankings (vendedores/clientes)
