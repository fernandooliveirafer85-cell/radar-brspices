# -*- coding: utf-8 -*-
"""
Book de Vendas BR Spices — ETL de exportação (schema 2)
========================================================
Lê as fontes da BASE PROTHEUS (xlsx), aplica as regras de negócio do Book de
Vendas e gera JSONs POR PERFIL (visão completa / gerente / vendedor),
criptografados com AES-GCM (compatível com WebCrypto do navegador).

Regras de negócio (validadas contra o Book/PBI em 02/07/2026):
  - Venda = linhas TIPO "1-Venda"; excluir funcionários (ID_CLIENTE inicia 4/5)
    e famílias MAQUINA/SACOS/USO E CONSUMO; líquido = venda - devolução.
  - Metas por CNPJ: Ajustes_Metas_CNPJ.xlsx aba CNPJ_METAS, cabeçalho linha 3.
  - Hierarquia: GR_BRS (gerente) > VEND_BRS (vendedor).

Schema 2 (03/07/2026):
  - Cliente = CLIENTE - BANDEIRA agregado por vendedor (não CNPJ) — pedido do
    Fernando (ex.: FORT/MS loja-a-loja vira 1 linha).
  - Séries MENSAIS por cliente: m24/m25/m26 (fat líquido), q26 (caixas líq.),
    meta (12 meses) → o app calcula YTD/mês/quarter e ano anterior no período.
  - meta_empresa_mensal: jan-jun = soma das metas por CNPJ; jul-dez = metas
    totais da empresa (METAS_EMPRESA_S2) até o Fernando preencher a planilha.

Saída: data/<sha256(senha)[:16]>.enc.json por perfil; senhas persistem em
tools/senhas.local.json|txt (NUNCA commitados).
Uso: python tools/export_radar.py
"""
import base64
import hashlib
import json
import os
import re
import secrets
import sys
import unicodedata
from datetime import datetime

import pandas as pd
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

# ---------------------------------------------------------------- configuração
BASE = r"C:\Users\Fernando\Desktop\BASE PROTHEUS"
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(REPO, "data")
TOOLS_DIR = os.path.join(REPO, "tools")
SENHAS_JSON = os.path.join(TOOLS_DIR, "senhas.local.json")
SENHAS_TXT = os.path.join(TOOLS_DIR, "senhas.local.txt")

FAM_EXCLUIDAS = {"MAQUINA", "SACOS", "USO E CONSUMO"}
ANO_MIN = 2024              # 2024 entra p/ o "ano anterior" do gráfico de 12 meses
PBKDF2_ITER = 310_000
COLS_MES_META = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN",
                 "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"]

# Metas totais da empresa jul-dez/2026 (informadas pelo Fernando em 03/07/2026;
# quando as metas por gerente/vendedor entrarem na planilha, elas assumem)
METAS_EMPRESA_S2 = {7: 15_200_000, 8: 15_400_000, 9: 16_500_000,
                    10: 17_000_000, 11: 17_500_000, 12: 14_200_000}

# Acessos de visão completa (nome, cargo exibido, e-mail de referência)
ACESSO_TOTAL = [
    ("FERNANDO OLIVEIRA", "ADMINISTRADOR", "fernando.oliveira.fer85@gmail.com"),
    ("RICARDO GOBATTO", "DIRETOR COMERCIAL", "rgobatto@brspices.com.br"),
    ("GABRIEL DANIEL", "CEO", "gabriel@brspices.com.br"),
]

norm_cnpj = lambda s: re.sub(r"\D", "", str(s or ""))


def eh_funcionario(df):
    return df["ID_CLIENTE"].fillna("").astype(str).str.strip().str.startswith(("4", "5"))


# ---------------------------------------------------------------- leitura
def ler_faturamento():
    pasta = os.path.join(BASE, "@faturamento")
    frames = []
    for nome in sorted(os.listdir(pasta)):
        if not nome.lower().endswith(".xlsx") or nome.startswith("~$"):
            continue
        m = re.search(r"@fat_(\d{4})", nome)
        if m and int(m.group(1)) < ANO_MIN:
            continue
        print(f"  lendo {nome} ...")
        df = pd.read_excel(os.path.join(pasta, nome), sheet_name=0,
                           dtype={"ID_CLIENTE": str, "CNPJ": str,
                                  "ID_VENDEDOR": str, "ID_GERENTE": str})
        df = df[["CNPJ", "EMISSAO", "TIPO", "ID_CLIENTE", "NOME CLIENTE",
                 "ESTADO", "NOME FAMILIA", "QUANTIDADE", "TOTAL"]].copy()
        frames.append(df)
    fat = pd.concat(frames, ignore_index=True)
    fat["EMISSAO"] = pd.to_datetime(fat["EMISSAO"], errors="coerce")
    fat = fat[fat["EMISSAO"].dt.year >= ANO_MIN]
    fat = fat[fat["TIPO"] == "1-Venda"]
    fat = fat[~eh_funcionario(fat)]
    fat = fat[~fat["NOME FAMILIA"].isin(FAM_EXCLUIDAS)]
    fat["CNPJ_N"] = fat["CNPJ"].map(norm_cnpj)
    fat["TOTAL"] = pd.to_numeric(fat["TOTAL"], errors="coerce").fillna(0.0)
    fat["QUANTIDADE"] = pd.to_numeric(fat["QUANTIDADE"], errors="coerce").fillna(0.0)
    fat["ANO"] = fat["EMISSAO"].dt.year
    fat["MES"] = fat["EMISSAO"].dt.month
    return fat


def ler_devolucao():
    df = pd.read_excel(os.path.join(BASE, "@devolução", "@devolução.xlsx"),
                       sheet_name=0, dtype={"ID_CLIENTE": str, "CNPJ": str})
    df["EMISSAO"] = pd.to_datetime(df["EMISSAO"], errors="coerce")
    df = df[df["EMISSAO"].dt.year >= ANO_MIN]
    df = df[~eh_funcionario(df)]
    df["CNPJ_N"] = df["CNPJ"].map(norm_cnpj)
    df["TOTAL"] = pd.to_numeric(df["TOTAL"], errors="coerce").fillna(0.0)
    df["QUANTIDADE"] = pd.to_numeric(df["QUANTIDADE"], errors="coerce").fillna(0.0)
    df["ANO"] = df["EMISSAO"].dt.year
    df["MES"] = df["EMISSAO"].dt.month
    return df


def ler_carteira():
    df = pd.read_excel(os.path.join(BASE, "@carteira", "@carteira.xlsx"),
                       sheet_name=0, dtype={"CNPJ": str})
    df = df[pd.to_numeric(df["Atendido"], errors="coerce").fillna(0) == 0]
    df["CNPJ_N"] = df["CNPJ"].map(norm_cnpj)
    df["TOTAL"] = pd.to_numeric(df["TOTAL"], errors="coerce").fillna(0.0)
    return df


def ler_metas():
    df = pd.read_excel(os.path.join(BASE, "Ajustes_Metas_CNPJ.xlsx"),
                       sheet_name="CNPJ_METAS", header=2)
    df = df[df["CNPJ"].notna()].copy()
    df["CNPJ_N"] = df["CNPJ"].map(norm_cnpj)
    df = df[df["CNPJ_N"] != ""]
    df = df.drop_duplicates(subset="CNPJ_N", keep="first")
    for c in COLS_MES_META:
        df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0.0)
    for col in ["CLIENTE - BANDEIRA", "NOME CLIENTE PROTHEUS", "VEND_BRS", "GR_BRS", "ESTADO"]:
        df[col] = df[col].fillna("").astype(str).str.strip()
    return df


# ---------------------------------------------------------------- criptografia
def criptografar(obj, senha):
    salt = secrets.token_bytes(16)
    iv = secrets.token_bytes(12)
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt,
                     iterations=PBKDF2_ITER)
    chave = kdf.derive(senha.encode("utf-8"))
    dados = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    cifrado = AESGCM(chave).encrypt(iv, dados, None)
    b64 = lambda b: base64.b64encode(b).decode("ascii")
    return {"v": 1, "alg": "AES-GCM", "kdf": "PBKDF2-SHA256",
            "iter": PBKDF2_ITER, "salt": b64(salt), "iv": b64(iv),
            "data": b64(cifrado)}


def gerar_login(nome):
    """'042 - WAGNER TORTELLI' → 'wagner.tortelli' (sem prefixo numérico/acentos)."""
    s = re.sub(r"^\s*\d+\s*-\s*", "", str(nome))
    s = unicodedata.normalize("NFD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", ".", s.lower()).strip(".")


def nome_arquivo(login, senha):
    """O arquivo é localizado pela combinação login+senha (nada de lista aberta)."""
    return hashlib.sha256(f"{login}|{senha}".encode("utf-8")).hexdigest()[:16] + ".enc.json"


def gerar_senha():
    alfa = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "RADAR-" + "-".join("".join(secrets.choice(alfa) for _ in range(4)) for _ in range(3))


# ---------------------------------------------------------------- main
def main():
    inicio = datetime.now()
    print("== Book de Vendas BR Spices — exportação (schema 2) ==")
    fat = ler_faturamento()
    dev = ler_devolucao()
    cart = ler_carteira()
    metas = ler_metas()

    max_emissao = fat["EMISSAO"].max()
    ano_atual, mes_atual = max_emissao.year, max_emissao.month
    corte_ly = max_emissao.replace(year=ano_atual - 1)
    print(f"Faturamento: {len(fat)} linhas úteis ({ANO_MIN}-{ano_atual}) | última emissão {max_emissao:%d/%m/%Y}")

    # ---- dimensão CNPJ → (bandeira, vendedor, gerente, uf)
    dim = {}
    for _, r in metas.iterrows():
        band = r["CLIENTE - BANDEIRA"] or r["NOME CLIENTE PROTHEUS"] or "(SEM NOME)"
        dim[r["CNPJ_N"]] = (band, r["VEND_BRS"] or "SEM CADASTRO",
                            r["GR_BRS"] or "SEM CADASTRO", r["ESTADO"])
    nomes_fat = fat.sort_values("EMISSAO").groupby("CNPJ_N")[["NOME CLIENTE", "ESTADO"]].last()
    for cnpj in set(fat["CNPJ_N"]) - set(dim):
        r = nomes_fat.loc[cnpj]
        dim[cnpj] = (str(r["NOME CLIENTE"]), "SEM CADASTRO", "SEM CADASTRO", str(r["ESTADO"]))

    # ---- séries mensais líquidas por CNPJ e agregação por grupo (bandeira|vendedor)
    fmes = fat.groupby(["CNPJ_N", "ANO", "MES"])["TOTAL"].sum()
    dmes = dev.groupby(["CNPJ_N", "ANO", "MES"])["TOTAL"].sum()
    liq = fmes.sub(dmes, fill_value=0.0)
    f26, d26 = fat[fat["ANO"] == 2026], dev[dev["ANO"] == 2026]
    qmes = (f26.groupby(["CNPJ_N", "MES"])["QUANTIDADE"].sum()
            .sub(d26.groupby(["CNPJ_N", "MES"])["QUANTIDADE"].sum(), fill_value=0.0))

    groups = {}

    def grupo(cnpj):
        band, vend, ger, uf = dim.get(cnpj, (cnpj or "(DESCONHECIDO)",
                                             "SEM CADASTRO", "SEM CADASTRO", ""))
        k = (band, vend)
        g = groups.get(k)
        if g is None:
            g = groups[k] = {"cliente": band, "vend": vend, "ger": ger,
                             "ufs": set(), "cnpjs": set(), "ult": None,
                             "m24": [0.0] * 12, "m25": [0.0] * 12, "m26": [0.0] * 12,
                             "q26": [0.0] * 12, "meta": [0.0] * 12}
        if uf:
            g["ufs"].add(uf)
        g["cnpjs"].add(cnpj)
        return g

    for (cnpj, ano, mes), v in liq.items():
        grupo(cnpj)[f"m{int(ano) % 100}"][int(mes) - 1] += float(v)
    for (cnpj, mes), v in qmes.items():
        grupo(cnpj)["q26"][int(mes) - 1] += float(v)
    for _, r in metas.iterrows():
        g = grupo(r["CNPJ_N"])
        for i, c in enumerate(COLS_MES_META):
            g["meta"][i] += float(r[c])
    for cnpj, ts in fat.groupby("CNPJ_N")["EMISSAO"].max().items():
        g = grupo(cnpj)
        if g["ult"] is None or ts > g["ult"]:
            g["ult"] = ts

    # ---- registros finais por cliente-bandeira
    idx_atual = ano_atual * 12 + mes_atual
    clientes = []          # (registro_json, set_de_cnpjs)
    for g in groups.values():
        fat26, meta_ano = sum(g["m26"]), sum(g["meta"])
        if g["ult"] is None and fat26 == 0 and meta_ano == 0 and sum(g["m25"]) == 0:
            continue
        meses_sem = (idx_atual - (g["ult"].year * 12 + g["ult"].month)) if g["ult"] is not None else 99
        status = ("ok" if meses_sem <= 0 else "atencao" if meses_sem == 1
                  else "validar" if meses_sem == 2 else "acionar")
        meses_ativos = sum(1 for v in g["m26"] if v != 0)
        media = fat26 / meses_ativos if meses_ativos else 0.0
        ufs = sorted(g["ufs"] - {""})
        rec = {
            "cliente": g["cliente"], "vend": g["vend"], "ger": g["ger"],
            "uf": ufs[0] if len(ufs) == 1 else (f"{len(ufs)} UFs" if ufs else ""),
            "cnpjs": len(g["cnpjs"]),
            "ult": g["ult"].strftime("%Y-%m-%d") if g["ult"] is not None else None,
            "meses_sem": int(meses_sem), "status": status,
            "media": round(media, 2),
            "perdido": round(media * meses_sem, 2) if meses_sem >= 1 and media > 0 else 0,
            "m24": [round(v) for v in g["m24"]], "m25": [round(v) for v in g["m25"]],
            "m26": [round(v) for v in g["m26"]], "q26": [round(v, 1) for v in g["q26"]],
            "meta": [round(v) for v in g["meta"]],
        }
        clientes.append((rec, g["cnpjs"]))
    clientes.sort(key=lambda t: -sum(t[0]["m26"]))
    print(f"Clientes-bandeira: {len(clientes)} (de {len(dim)} CNPJs)")

    meta_empresa = [round(metas[c].sum()) for c in COLS_MES_META[:6]] + \
                   [METAS_EMPRESA_S2[m] for m in range(7, 13)]

    # ---- escopos
    escopos = [("gestor", nome, None, {"cargo": cargo, "email": email})
               for nome, cargo, email in ACESSO_TOTAL]
    for g in sorted(x for x in metas["GR_BRS"].unique() if x):
        escopos.append(("gerente", g, ("ger", g), None))
    for v in sorted(x for x in metas["VEND_BRS"].unique() if x):
        escopos.append(("vendedor", v, ("vend", v), None))

    senhas = {}
    if os.path.exists(SENHAS_JSON):
        with open(SENHAS_JSON, encoding="utf-8") as fh:
            senhas = json.load(fh)
    chaves_atuais = {f"{p}|{n}" for p, n, _, _ in escopos}
    for chave in [k for k in senhas if k not in chaves_atuais]:
        print(f"  senha descartada (escopo extinto): {chave}")
        del senhas[chave]

    os.makedirs(DATA_DIR, exist_ok=True)
    arquivos_gerados = set()
    print(f"\nGerando {len(escopos)} arquivos por perfil...")
    for perfil, nome, filtro, extra in escopos:
        if filtro is None:
            cls = clientes
        else:
            campo, valor = filtro
            cls = [t for t in clientes if t[0][campo] == valor]
        if not cls and perfil != "gestor":
            continue
        cnpjs_escopo = set().union(*[t[1] for t in cls]) if cls else set()

        f_sc = fat[fat["CNPJ_N"].isin(cnpjs_escopo)]
        d_sc = dev[dev["CNPJ_N"].isin(cnpjs_escopo)]
        ly_mp = (f_sc[(f_sc["ANO"] == ano_atual - 1) & (f_sc["EMISSAO"] <= corte_ly)]["TOTAL"].sum()
                 - d_sc[(d_sc["ANO"] == ano_atual - 1) & (d_sc["EMISSAO"] <= corte_ly)]["TOTAL"].sum())
        fam = (f_sc[f_sc["ANO"] == ano_atual].groupby("NOME FAMILIA")["TOTAL"]
               .sum().sort_values(ascending=False).head(20))

        payload = {
            "schema": 2,
            "gerado_em": inicio.strftime("%Y-%m-%d %H:%M"),
            "atualizado_ate": max_emissao.strftime("%Y-%m-%d"),
            "escopo": {"perfil": perfil, "nome": nome, **(extra or {})},
            "periodo": {"ano": ano_atual, "mes_atual": mes_atual},
            "kpis": {
                "carteira": round(float(cart[cart["CNPJ_N"].isin(cnpjs_escopo)]["TOTAL"].sum()), 2),
                "devolucao": round(float(d_sc[d_sc["ANO"] == ano_atual]["TOTAL"].sum()), 2),
                "fat_liq_ly_mp": round(float(ly_mp), 2),
            },
            "clientes": [t[0] for t in cls],
            "familias": [{"nome": k, "fat": round(float(v), 2)} for k, v in fam.items()],
        }
        if perfil == "gestor":
            payload["meta_empresa_mensal"] = meta_empresa

        chave = f"{perfil}|{nome}"
        if chave not in senhas:
            senhas[chave] = {"senha": gerar_senha(), "perfil": perfil, "nome": nome}
        if extra:
            senhas[chave].update(extra)
        # login: e-mail p/ visão completa; nome.sobrenome p/ gerentes e vendedores
        login = (extra or {}).get("email") or gerar_login(nome)
        login = login.strip().lower()
        senhas[chave]["login"] = login
        payload["escopo"]["login"] = login
        senha = senhas[chave]["senha"]
        arq = nome_arquivo(login, senha)
        senhas[chave]["arquivo"] = arq
        with open(os.path.join(DATA_DIR, arq), "w", encoding="utf-8") as fh:
            json.dump(criptografar(payload, senha), fh)
        arquivos_gerados.add(arq)
        if perfil == "gestor":
            tot26 = sum(sum(t[0]["m26"]) for t in cls)
            print(f"  [VALIDAÇÃO {nome}] fat26={tot26:,.0f} ly_mp={ly_mp:,.2f} "
                  f"clientes={len(cls)} meta_emp={sum(meta_empresa):,.0f}")
        print(f"  {perfil:9s} {nome:32s} -> data/{arq}")

    for f in os.listdir(DATA_DIR):
        if f.endswith(".enc.json") and f not in arquivos_gerados:
            os.remove(os.path.join(DATA_DIR, f))
            print(f"  removido órfão: data/{f}")

    with open(SENHAS_JSON, "w", encoding="utf-8") as fh:
        json.dump(senhas, fh, ensure_ascii=False, indent=1)
    with open(SENHAS_TXT, "w", encoding="utf-8") as fh:
        fh.write("BOOK DE VENDAS BR SPICES — SENHAS DE ACESSO (CONFIDENCIAL — não commitar)\n")
        fh.write(f"Gerado em {inicio:%d/%m/%Y %H:%M}\n\n")
        ordem = {"gestor": 0, "gerente": 1, "vendedor": 2}
        for chave in sorted(senhas, key=lambda k: (ordem.get(senhas[k]["perfil"], 9), senhas[k]["nome"])):
            s = senhas[chave]
            rotulo = s.get("cargo", s["perfil"].upper())
            fh.write(f"{rotulo:18s} {s['nome']:32s} login: {s.get('login',''):38s} senha: {s['senha']}\n")
    print(f"\nSenhas em: {SENHAS_TXT}")
    print(f"Concluído em {(datetime.now() - inicio).total_seconds():.0f}s")


if __name__ == "__main__":
    sys.exit(main())
