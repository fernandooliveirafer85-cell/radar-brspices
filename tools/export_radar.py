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
                           dtype={"ID_CLIENTE": str, "CNPJ": str, "ID_PRODUTO": str,
                                  "ID_VENDEDOR": str, "ID_GERENTE": str})
        for c in ("segmento", "ID_PRODUTO", "NOME PRODUTO"):
            if c not in df.columns:
                df[c] = ""
        df = df[["CNPJ", "EMISSAO", "TIPO", "ID_CLIENTE", "NOME CLIENTE", "ESTADO",
                 "NOME FAMILIA", "QUANTIDADE", "TOTAL", "segmento", "ID_PRODUTO",
                 "NOME PRODUTO"]].copy()
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


norm_pid = lambda s: str(s or "").strip().lstrip("0")


def ler_produtos():
    """Base de produtos do painel: ID → (categoria, família, produto, curva ABC, EAN)."""
    df = pd.read_excel(os.path.join(BASE, "Ajustes_Base_Produtos.xlsx"),
                       sheet_name="PRODUTOS", header=1, dtype={"ID_PRODUTO": str, "EAN-13": str})
    df = df[df["ID_PRODUTO"].notna()].copy()
    for c in ["CATEGORIA PAINEL", "FAMILIA PAINEL", "PRODUTOS PAINEL", "CURVA DE VENDAS", "EAN-13"]:
        df[c] = df[c].fillna("").astype(str).str.strip()
    return {norm_pid(r["ID_PRODUTO"]): (r["CATEGORIA PAINEL"], r["FAMILIA PAINEL"],
                                        r["PRODUTOS PAINEL"], r["CURVA DE VENDAS"],
                                        r["EAN-13"].split(".")[0])
            for _, r in df.iterrows()}


def ler_metas():
    df = pd.read_excel(os.path.join(BASE, "Ajustes_Metas_CNPJ.xlsx"),
                       sheet_name="CNPJ_METAS", header=2)
    df = df[df["CNPJ"].notna()].copy()
    df["CNPJ_N"] = df["CNPJ"].map(norm_cnpj)
    df = df[df["CNPJ_N"] != ""]
    df = df.drop_duplicates(subset="CNPJ_N", keep="first")
    for c in COLS_MES_META:
        df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0.0)
    for col in ["CLIENTE - BANDEIRA", "NOME CLIENTE PROTHEUS", "VEND_BRS", "GR_BRS", "ESTADO",
                "SEGMENTO | CANAL", "FASE_INTEGRAÇÃO"]:
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
    prod_info = ler_produtos()

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

    # ---- canal (segmento) por CNPJ: metas mandam; faturamento cobre quem falta
    MAPA_SEG = {"SUPERMERCADOS": "SUPERMERCADO", "CASH CARRY": "CASH AND CARRY",
                "LOJISTAS": "LOJISTA", "DISTR FOOD": "DIST FOOD",
                "FUNCIONARIOS": "FUNCIONÁRIOS"}
    # estrutura (1º nível da hierarquia): BRS / KHC / HÍBRIDO (FASE_INTEGRAÇÃO das metas)
    MAPA_ESTR = {"BR SPICES": "BRS", "KHC": "KHC", "HÍBRIDO": "HÍBRIDO", "HIBRIDO": "HÍBRIDO"}
    estr_de = {}
    canal_de = {}
    for _, r in metas.iterrows():
        if r["SEGMENTO | CANAL"]:
            canal_de[r["CNPJ_N"]] = r["SEGMENTO | CANAL"].upper()
        e = MAPA_ESTR.get(r["FASE_INTEGRAÇÃO"].upper())
        if e:
            estr_de[r["CNPJ_N"]] = e
    seg_fat = (fat[fat["segmento"].astype(str).str.strip() != ""]
               .sort_values("EMISSAO").groupby("CNPJ_N")["segmento"].last())
    for cnpj, s in seg_fat.items():
        if cnpj not in canal_de:
            s = str(s).strip().upper()
            canal_de[cnpj] = MAPA_SEG.get(s, s)

    # ---- séries mensais líquidas (valor) e de caixas por CNPJ; agregação por grupo (bandeira|vendedor)
    fmes = fat.groupby(["CNPJ_N", "ANO", "MES"])["TOTAL"].sum()
    dmes = dev.groupby(["CNPJ_N", "ANO", "MES"])["TOTAL"].sum()
    liq = fmes.sub(dmes, fill_value=0.0)
    qmes = (fat.groupby(["CNPJ_N", "ANO", "MES"])["QUANTIDADE"].sum()
            .sub(dev.groupby(["CNPJ_N", "ANO", "MES"])["QUANTIDADE"].sum(), fill_value=0.0))

    uf_de = lambda cnpj: (dim.get(cnpj, (None, None, None, ""))[3] or "—")
    novo_ud = lambda: {"m25": [0.0] * 12, "m26": [0.0] * 12,
                       "q25": [0.0] * 12, "q26": [0.0] * 12, "meta": [0.0] * 12,
                       "cart": 0.0, "ult": None}

    groups = {}

    def grupo(cnpj):
        band, vend, ger, uf = dim.get(cnpj, (cnpj or "(DESCONHECIDO)",
                                             "SEM CADASTRO", "SEM CADASTRO", ""))
        k = (band, vend)
        g = groups.get(k)
        if g is None:
            g = groups[k] = {"cliente": band, "vend": vend, "ger": ger, "canal": "",
                             "ufs": set(), "cnpjs": set(), "ult": None,
                             "m24": [0.0] * 12, "m25": [0.0] * 12, "m26": [0.0] * 12,
                             "d25": [0.0] * 12, "d26": [0.0] * 12,
                             "q26": [0.0] * 12, "meta": [0.0] * 12, "uf_det": {}}
        if uf:
            g["ufs"].add(uf)
        if not g["canal"]:
            g["canal"] = canal_de.get(cnpj, "")
        if not g.get("estr"):
            g["estr"] = estr_de.get(cnpj, "")
        g["cnpjs"].add(cnpj)
        return g

    for (cnpj, ano, mes), v in liq.items():
        g = grupo(cnpj); a, m = int(ano), int(mes)
        g[f"m{a % 100}"][m - 1] += float(v)
        if a in (2025, 2026):
            g["uf_det"].setdefault(uf_de(cnpj), novo_ud())[f"m{a % 100}"][m - 1] += float(v)
    # devolução mensal por grupo (p/ card Devolução dinâmico)
    for (cnpj, ano, mes), v in dmes.items():
        a, m = int(ano), int(mes)
        if a in (2025, 2026):
            grupo(cnpj)[f"d{a % 100}"][m - 1] += float(v)
    for (cnpj, ano, mes), v in qmes.items():
        g = grupo(cnpj); a, m = int(ano), int(mes)
        if a == 2026:
            g["q26"][m - 1] += float(v)
        if a in (2025, 2026):
            g["uf_det"].setdefault(uf_de(cnpj), novo_ud())[f"q{a % 100}"][m - 1] += float(v)
    for _, r in metas.iterrows():
        g = grupo(r["CNPJ_N"])
        ud = g["uf_det"].setdefault(uf_de(r["CNPJ_N"]), novo_ud())
        for i, c in enumerate(COLS_MES_META):
            g["meta"][i] += float(r[c])
            ud["meta"][i] += float(r[c])
    for cnpj, ts in fat.groupby("CNPJ_N")["EMISSAO"].max().items():
        g = grupo(cnpj)
        if g["ult"] is None or ts > g["ult"]:
            g["ult"] = ts
        ud = g["uf_det"].setdefault(uf_de(cnpj), novo_ud())
        if ud["ult"] is None or ts > ud["ult"]:
            ud["ult"] = ts
    # pedidos em carteira (pendentes de faturar) somados na UF do CNPJ
    for cnpj, v in cart.groupby("CNPJ_N")["TOTAL"].sum().items():
        g = grupo(cnpj)
        g["uf_det"].setdefault(uf_de(cnpj), novo_ud())["cart"] += float(v)

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
            "canal": g["canal"] or "SEM CANAL",
            "estr": g.get("estr") or "",
            "uf": ufs[0] if len(ufs) == 1 else (f"{len(ufs)} UFs" if ufs else ""),
            "cnpjs": len(g["cnpjs"]),
            "ult": g["ult"].strftime("%Y-%m-%d") if g["ult"] is not None else None,
            "meses_sem": int(meses_sem), "status": status,
            "media": round(media, 2),
            "perdido": round(media * meses_sem, 2) if meses_sem >= 1 and media > 0 else 0,
            "m24": [round(v) for v in g["m24"]], "m25": [round(v) for v in g["m25"]],
            "m26": [round(v) for v in g["m26"]], "q26": [round(v, 1) for v in g["q26"]],
            "d25": [round(v) for v in g["d25"]], "d26": [round(v) for v in g["d26"]],
            "meta": [round(v) for v in g["meta"]],
        }
        # cubo de faturamento por UF (servido sob demanda p/ a página Faturamento)
        ufs_det = [{"uf": u,
                    "m25": [round(x) for x in d["m25"]], "m26": [round(x) for x in d["m26"]],
                    "q25": [round(x) for x in d["q25"]], "q26": [round(x) for x in d["q26"]],
                    "meta": [round(x) for x in d["meta"]],
                    "cart": round(d["cart"]),
                    "ult": d["ult"].strftime("%Y-%m-%d") if d["ult"] is not None else None}
                   for u, d in sorted(g["uf_det"].items(), key=lambda kv: -sum(kv[1]["m26"]))]
        fatrec = {"cliente": g["cliente"], "vend": g["vend"], "ger": g["ger"],
                  "meta": [round(v) for v in g["meta"]], "ufs": ufs_det}
        clientes.append((rec, g["cnpjs"], fatrec))
    clientes.sort(key=lambda t: -sum(t[0]["m26"]))
    print(f"Clientes-bandeira: {len(clientes)} (de {len(dim)} CNPJs)")

    meta_empresa = [round(metas[c].sum()) for c in COLS_MES_META[:6]] + \
                   [METAS_EMPRESA_S2[m] for m in range(7, 13)]

    # ================= cubo MIX (categorias × cliente e produtos × vendedor) =================
    pinfo = lambda pid: prod_info.get(pid, ("", "", "", "", ""))
    fat["PID"] = fat["ID_PRODUTO"].map(norm_pid)
    fat["CAT"] = fat["PID"].map(lambda p: pinfo(p)[0] or "OUTROS")
    fat["PRODP"] = [pinfo(p)[2] or str(n).strip() for p, n in zip(fat["PID"], fat["NOME PRODUTO"])]
    fat["CURVA"] = fat["PID"].map(lambda p: pinfo(p)[3])
    fat["FAMP"] = [(pinfo(p)[1] or str(f)).strip() for p, f in zip(fat["PID"], fat["NOME FAMILIA"])]
    fat["BAND"] = fat["CNPJ_N"].map(lambda c: dim.get(c, ("(DESCONHECIDO)",) * 4)[0])
    fat["VEND"] = fat["CNPJ_N"].map(lambda c: dim.get(c, ("", "SEM CADASTRO", "SEM CADASTRO", ""))[1])
    fat["GER"] = fat["CNPJ_N"].map(lambda c: dim.get(c, ("", "SEM CADASTRO", "SEM CADASTRO", ""))[2])
    # identificação dos itens (ID/EAN): quando o mesmo produto do painel tem VÁRIOS SKUs
    # (recadastro), vale o SKU com venda MAIS RECENTE (desempate: maior venda no ano)
    ult_pid = fat.groupby("PID")["EMISSAO"].max()
    val_pid = fat[fat["ANO"] >= ano_atual - 1].groupby("PID")["TOTAL"].sum()
    _cand = {}
    for pid, (cat, fam, prodp, curva, ean) in prod_info.items():
        nome = prodp or f"ID {pid}"
        chave = (ult_pid.get(pid, pd.Timestamp.min), float(val_pid.get(pid, 0.0)))
        if nome not in _cand or chave > _cand[nome][0]:
            _cand[nome] = (chave, {"id": pid, "ean": ean})
    prod_ids = {n: d for n, (_, d) in _cand.items()}
    tem_dev_prod = "ID_PRODUTO" in dev.columns
    if tem_dev_prod:
        dev["PID"] = dev["ID_PRODUTO"].map(norm_pid)
        dev["CAT"] = dev["PID"].map(lambda p: pinfo(p)[0] or "OUTROS")
        dev["VEND"] = dev["CNPJ_N"].map(lambda c: dim.get(c, ("", "SEM CADASTRO", "SEM CADASTRO", ""))[1])
    f2 = fat[fat["ANO"].isin([2025, 2026])]

    # categorias × cliente-bandeira × vendedor (mensal, líquido qdo possível)
    mix_rows = {}

    def mix_add(cnpj, cat, ano, mes, val, qtd, sinal):
        band, vend, ger, _ = dim.get(cnpj, (cnpj or "(DESCONHECIDO)", "SEM CADASTRO", "SEM CADASTRO", ""))
        k = (band, vend, cat)
        e = mix_rows.get(k)
        if e is None:
            e = mix_rows[k] = {"cliente": band, "vend": vend, "ger": ger, "cat": cat,
                               "m25": [0.0] * 12, "m26": [0.0] * 12,
                               "q25": [0.0] * 12, "q26": [0.0] * 12}
        e[f"m{ano % 100}"][mes - 1] += sinal * val
        e[f"q{ano % 100}"][mes - 1] += sinal * qtd

    gm = f2.groupby(["CNPJ_N", "CAT", "ANO", "MES"])[["TOTAL", "QUANTIDADE"]].sum()
    for (cnpj, cat, ano, mes), r in gm.iterrows():
        mix_add(cnpj, cat, int(ano), int(mes), float(r["TOTAL"]), float(r["QUANTIDADE"]), 1)
    if tem_dev_prod:
        d2 = dev[dev["ANO"].isin([2025, 2026])]
        gd = d2.groupby(["CNPJ_N", "CAT", "ANO", "MES"])[["TOTAL", "QUANTIDADE"]].sum()
        for (cnpj, cat, ano, mes), r in gd.iterrows():
            mix_add(cnpj, cat, int(ano), int(mes), float(r["TOTAL"]), float(r["QUANTIDADE"]), -1)

    # produtos × CLIENTE-BANDEIRA (mensal) — permite análise de produto por cliente
    prod_rows = {}

    def prod_add(band, pid, prodp, cat, curva, ano, mes, val, qtd, sinal):
        k = (band, pid)
        e = prod_rows.get(k)
        if e is None:
            e = prod_rows[k] = {"cliente": band, "prod": prodp or f"ID {pid}",
                                "cat": cat, "curva": curva,
                                "m25": [0.0] * 12, "m26": [0.0] * 12,
                                "q25": [0.0] * 12, "q26": [0.0] * 12}
        e[f"m{ano % 100}"][mes - 1] += sinal * val
        e[f"q{ano % 100}"][mes - 1] += sinal * qtd

    gp = f2.groupby(["BAND", "PID", "PRODP", "CAT", "CURVA", "ANO", "MES"])[["TOTAL", "QUANTIDADE"]].sum()
    for (band, pid, prodp, cat, curva, ano, mes), r in gp.iterrows():
        prod_add(band, pid, prodp, cat, curva, int(ano), int(mes),
                 float(r["TOTAL"]), float(r["QUANTIDADE"]), 1)
    if tem_dev_prod:
        dev["BAND"] = dev["CNPJ_N"].map(lambda c: dim.get(c, ("(DESCONHECIDO)",) * 4)[0])
        gdp = dev[dev["ANO"].isin([2025, 2026])].groupby(["BAND", "PID", "ANO", "MES"])[["TOTAL", "QUANTIDADE"]].sum()
        for (band, pid, ano, mes), r in gdp.iterrows():
            pi = pinfo(pid)
            prod_add(band, pid, pi[2], pi[0] or "OUTROS", pi[3], int(ano), int(mes),
                     float(r["TOTAL"]), float(r["QUANTIDADE"]), -1)

    arr = lambda v: [round(x) for x in v]
    arrq = lambda v: [round(x, 1) for x in v]
    mix_cats = [{**{k: e[k] for k in ("cliente", "vend", "ger", "cat")},
                 "m25": arr(e["m25"]), "m26": arr(e["m26"]),
                 "q25": arrq(e["q25"]), "q26": arrq(e["q26"])}
                for e in mix_rows.values() if any(e["m25"]) or any(e["m26"])]
    mix_prods = [{**{k: e[k] for k in ("cliente", "prod", "cat", "curva")},
                  "m25": arr(e["m25"]), "m26": arr(e["m26"]),
                  "q25": arrq(e["q25"]), "q26": arrq(e["q26"])}
                 for e in prod_rows.values() if any(e["m25"]) or any(e["m26"])]
    # base compradora por PRODUTO (bandeiras distintas comprando nos últimos 6 meses fechados)
    idx_abs = ano_atual * 12 + mes_atual                       # mês corrente (aberto)
    fat["ABS"] = fat["ANO"] * 12 + fat["MES"]
    f6 = fat[(fat["ABS"] >= idx_abs - 6) & (fat["ABS"] < idx_abs)]
    prod_cli6 = f6.groupby("PRODP")["BAND"].apply(set)
    # mix por CLIENTE-BANDEIRA × UF × item (base da visão Mix por Cliente: S/N, share, cx, valor)
    gufs = f6.groupby(["BAND", "ESTADO", "PRODP"])[["QUANTIDADE", "TOTAL"]].sum()
    mix_ufs = []
    for (b, u, p), r in gufs.iterrows():
        q, t = float(r["QUANTIDADE"]), float(r["TOTAL"])
        if q <= 0 and t <= 0:
            continue
        mix_ufs.append({"c": b, "u": str(u).strip() or "—", "p": p,
                        "cx": round(q, 1), "vl": round(t)})
    print(f"MIX-UF: {len(mix_ufs)} células cliente×UF×item (janela 6m fechados)")
    print(f"MIX: {len(mix_cats)} linhas categoria×cliente | {len(mix_prods)} linhas produto×vendedor "
          f"| dev por produto: {'sim' if tem_dev_prod else 'NÃO (mix bruto)'}")

    # ================= análise WHITESPACE (contas-chave) =================
    MESES_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]
    jan_ini = max(1, mes_atual - 5)
    meses_jan = list(range(jan_ini, mes_atual))           # últimos 5 meses FECHADOS
    fj = fat[(fat["ANO"] == ano_atual) & (fat["MES"].isin(meses_jan))]
    top30 = fj.groupby("BAND")["TOTAL"].sum().nlargest(30)
    fj30 = fj[fj["BAND"].isin(top30.index)]
    tab = fj30.groupby(["FAMP", "BAND"])["TOTAL"].sum().unstack(fill_value=0.0) \
              .reindex(columns=top30.index, fill_value=0.0)
    fam_cat = {}
    for cat, famp, _, _, _ in prod_info.values():
        fam_cat.setdefault(famp, cat)
    ws_lista = []
    for famp, linha in tab.iterrows():
        if not famp or famp.upper() == "OUTROS":
            continue
        compradores = linha[linha > 0]
        n_c, n_sem = len(compradores), len(linha) - len(compradores)
        if n_c < 3 or n_sem < 1:                          # lista completa (o site recorta na tela)
            continue
        giro = float(compradores.median())
        sem = [b for b in top30.index if linha[b] <= 0]
        ws_lista.append({"fam": famp, "cat": fam_cat.get(famp, ""),
                         "compradores": n_c, "contas_sem": n_sem,
                         "giro": round(giro), "potencial": round(giro * n_sem),
                         "alvo": sem[:6]})
    ws_lista.sort(key=lambda x: -x["potencial"])
    ws_top = [w for w in ws_lista if w["compradores"] >= 5 and w["contas_sem"] >= 5][:12]
    conta_gaps = {}
    for w in ws_top[:10]:
        for b in w["alvo"]:
            conta_gaps[b] = conta_gaps.get(b, 0) + 1
    contas_alvo = sorted(conta_gaps.items(), key=lambda kv: -kv[1])[:8]
    analitica = {
        "janela": f"{MESES_PT[jan_ini - 1]}–{MESES_PT[mes_atual - 2]}/{ano_atual % 100}",
        "criterio": "famílias com 5+ contas compradoras e 5+ contas em aberto no top 30 · "
                    "potencial = giro mediano por conta compradora × contas em aberto",
        "whitespace": ws_top,
        "whitespace_full": ws_lista,
        "contas_alvo": [{"cliente": c, "abertas": n} for c, n in contas_alvo],
        "pot_total": round(sum(w["potencial"] for w in ws_top)),
    }
    print(f"WHITESPACE: {len(ws_lista)} famílias com lacuna | potencial top10 = "
          f"{sum(w['potencial'] for w in ws_top[:10]):,.0f}")

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
    kv_entries = {}          # chave de escopo -> payload aberto (p/ o cofre KV da Cloudflare)
    fat_entries = {}         # chave de escopo -> cubo de faturamento por UF (lazy)
    mix_entries = {}         # chave de escopo -> cubo categorias/produtos (lazy)
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
                "carteira_pedidos": int(cart[cart["CNPJ_N"].isin(cnpjs_escopo)]["PEDIDO"].nunique()),
                "devolucao": round(float(d_sc[d_sc["ANO"] == ano_atual]["TOTAL"].sum()), 2),
                "fat_liq_ly_mp": round(float(ly_mp), 2),
            },
            "clientes": [t[0] for t in cls],
            "familias": [{"nome": k, "fat": round(float(v), 2)} for k, v in fam.items()],
        }
        if perfil == "gestor":
            payload["meta_empresa_mensal"] = meta_empresa
            payload["analitica"] = analitica

        # versão p/ o cofre KV (Cloudflare): 1 entrada por escopo (visão completa é única)
        kv_key = "gestor" if perfil == "gestor" else f"{perfil}|{nome}"
        if kv_key not in kv_entries:
            kv_payload = dict(payload)
            kv_payload["escopo"] = {"perfil": perfil,
                                    "nome": "VISÃO COMPLETA" if perfil == "gestor" else nome}
            kv_entries[kv_key] = json.dumps(kv_payload, ensure_ascii=False,
                                            separators=(",", ":"))
            # cubo de faturamento por UF (chave separada, lazy-load na página Faturamento)
            fat_cube = {"mes_atual": mes_atual,
                        "clientes": [t[2] for t in cls]}
            fat_entries[kv_key] = json.dumps(fat_cube, ensure_ascii=False, separators=(",", ":"))
            # cubo mix (categorias × cliente + produtos × cliente) do escopo
            bands_escopo = {t[0]["cliente"] for t in cls}
            if filtro is None:
                mc, mp = mix_cats, mix_prods
            else:
                campo, valor = filtro
                mc = [e for e in mix_cats if e[campo] == valor]
                mp = [e for e in mix_prods if e["cliente"] in bands_escopo]
            # base compradora por produto (bandeiras do ESCOPO comprando nos últimos 6 meses fechados)
            ncli_prod = {p: len(bs & bands_escopo) for p, bs in prod_cli6.items()
                         if len(bs & bands_escopo)}
            mu = [e for e in mix_ufs if e["c"] in bands_escopo]
            mix_entries[kv_key] = json.dumps({"mes_atual": mes_atual, "cats": mc, "prods": mp,
                                              "ncli_prod": ncli_prod, "ids": prod_ids, "ufs": mu},
                                             ensure_ascii=False, separators=(",", ":"))

        chave = f"{perfil}|{nome}"
        if chave not in senhas:
            senhas[chave] = {"senha": gerar_senha(), "perfil": perfil, "nome": nome}
        if extra:
            senhas[chave].update(extra)
        # login: sempre nome.sobrenome (e-mail é só informação de contato, nada é enviado)
        login = gerar_login(nome)
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

    # arquivo de carga em lote p/ o KV (wrangler kv bulk put) — NUNCA commitado
    kv_bulk = [{"key": "dados:" + k, "value": v} for k, v in sorted(kv_entries.items())]
    kv_bulk += [{"key": "fat:" + k, "value": v} for k, v in sorted(fat_entries.items())]
    kv_bulk += [{"key": "mix:" + k, "value": v} for k, v in sorted(mix_entries.items())]
    with open(os.path.join(TOOLS_DIR, "kv_bulk.local.json"), "w", encoding="utf-8") as fh:
        json.dump(kv_bulk, fh, ensure_ascii=False)
    kb = sum(len(e['value']) for e in kv_bulk) // 1024
    fatkb = sum(len(v) for v in fat_entries.values()) // 1024
    mixkb = sum(len(v) for v in mix_entries.values()) // 1024
    print(f"KV: {len(kv_bulk)} chaves em tools/kv_bulk.local.json ({kb} KB; fat={fatkb} KB, "
          f"mix={mixkb} KB, maior mix={max((len(v) for v in mix_entries.values()), default=0)//1024} KB)")

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
