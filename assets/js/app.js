/* Book de Vendas BR Spices — app v2 (schema 2: séries mensais por CLIENTE-BANDEIRA)
   Login: senha → SHA-256 → data/<hash>.enc.json → PBKDF2 + AES-GCM (WebCrypto). */
"use strict";

const S = { data: null, fGer: "", fVend: "", ano: 2026, per: "ytd",
            nPos: 100, nCli: 50, fStatus: "", busca: "", buscaMeta: "", fracMes: 1 };
const $ = (id) => document.getElementById(id);
const MESES = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];

/* ---------------- formatação ---------------- */
const fmtBR = (v, d = 0) => (v ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
function fmtM(v) {
  if (v == null) return "—";
  const a = Math.abs(v);
  if (a >= 1e6) return "R$ " + fmtBR(v / 1e6, 1) + "M";
  if (a >= 1e3) return "R$ " + fmtBR(v / 1e3, 0) + "K";
  return "R$ " + fmtBR(v, 0);
}
function fmtNum(v) {
  if (v == null) return "—";
  const a = Math.abs(v);
  if (a >= 1e6) return fmtBR(v / 1e6, 1) + "M";
  if (a >= 1e3) return fmtBR(v / 1e3, 1) + "K";
  return fmtBR(v, 0);
}
const fmtPct = (x, d = 1) => x == null ? "—" : fmtBR(x * 100, d) + "%";
function fmtData(iso) {
  if (!iso) return "—";
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nomeVend = (v) => String(v ?? "").replace(/^\s*\d+\s*-\s*/, "");

/* ---------------- criptografia ---------------- */
const b64d = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function sha256hex(txt) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(txt));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function decriptar(payload, senha) {
  const km = await crypto.subtle.importKey("raw", new TextEncoder().encode(senha), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: b64d(payload.salt), iterations: payload.iter, hash: "SHA-256" },
    km, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64d(payload.iv) }, key, b64d(payload.data));
  return JSON.parse(new TextDecoder().decode(plain));
}

async function entrar() {
  const login = $("lg").value.trim().toLowerCase();
  const senha = $("pw").value.trim();
  const err = $("lerr"), btn = $("lbtn");
  err.style.display = "none";
  if (!login || !senha) { err.textContent = "Informe login e senha."; err.style.display = "block"; return; }
  btn.disabled = true; btn.textContent = "Abrindo…";
  try {
    if (!crypto.subtle) throw new Error("Este navegador não suporta criptografia (use HTTPS).");
    const hash = await sha256hex(login + "|" + senha);
    const res = await fetch("data/" + hash.slice(0, 16) + ".enc.json", { cache: "no-store" });
    if (!res.ok) throw new Error("Login ou senha não conferem. Confira e tente de novo.");
    S.data = await decriptar(await res.json(), senha);
    if (S.data.schema !== 2) throw new Error("Dados desatualizados — peça ao Fernando para republicar.");
    sessionStorage.setItem("bv_dados", JSON.stringify(S.data));
    boot();
  } catch (e) {
    err.textContent = e.name === "OperationError" ? "Senha incorreta." : (e.message || "Falha ao abrir os dados.");
    err.style.display = "block";
  } finally {
    btn.disabled = false; btn.textContent = "Entrar no Book de Vendas";
  }
}

function sair() {
  sessionStorage.removeItem("bv_dados");
  location.reload();
}

/* ---------------- período ---------------- */
function mesesSel() {
  const mAtual = S.data.periodo.mes_atual;
  if (S.per === "ytd") return Array.from({ length: mAtual }, (_, i) => i + 1);
  if (S.per === "ano") return Array.from({ length: 12 }, (_, i) => i + 1);
  const q = /^q([1-4])$/.exec(S.per);
  if (q) { const b = (q[1] - 1) * 3; return [b + 1, b + 2, b + 3]; }
  return [parseInt(S.per, 10)];
}
const rotuloPer = () => S.per === "ytd" ? `YTD (jan–${MESES[S.data.periodo.mes_atual - 1]})`
  : S.per === "ano" ? "Ano completo"
  : /^q\d$/.test(S.per) ? S.per.toUpperCase()
  : MESES[S.per - 1];

function serie(c, ano) { return ano === 2026 ? c.m26 : ano === 2025 ? c.m25 : ano === 2024 ? c.m24 : null; }

function somaPer(rows, ano, meses) {
  let s = 0;
  for (const c of rows) { const a = serie(c, ano); if (a) for (const m of meses) s += a[m - 1] || 0; }
  return s;
}
/* ano anterior no mesmo período; mês corrente entra pro-rata (dias decorridos) */
function somaLY(rows, meses) {
  const { ano, mes_atual } = S.data.periodo;
  let s = 0;
  for (const c of rows) {
    const a = serie(c, S.ano - 1); if (!a) continue;
    for (const m of meses) {
      let v = a[m - 1] || 0;
      if (S.ano === ano && m === mes_atual) v *= S.fracMes;
      s += v;
    }
  }
  return s;
}
function metaPer(rows, meses) {
  if (S.ano !== 2026) return null;
  /* no YTD, a meta do mês corrente entra pro-rata (dias decorridos) */
  const peso = (m) => (S.per === "ytd" && S.ano === S.data.periodo.ano &&
                       m === S.data.periodo.mes_atual) ? S.fracMes : 1;
  const me = S.data.meta_empresa_mensal;
  if (me && !filtrado()) return meses.reduce((s, m) => s + (me[m - 1] || 0) * peso(m), 0);
  let s = 0;
  for (const c of rows) for (const m of meses) s += (c.meta[m - 1] || 0) * peso(m);
  return s;
}

/* ---------------- boot ---------------- */
function boot() {
  const d = S.data;
  $("login").style.display = "none";
  $("app").classList.add("on");

  const perfilTxt = d.escopo.cargo ||
    ({ gestor: "GESTÃO — VÊ TUDO", gerente: "GERENTE — SUA EQUIPE", vendedor: "VENDEDOR — SUA CARTEIRA" }[d.escopo.perfil] || d.escopo.perfil);
  $("who-nome").textContent = d.escopo.nome;
  $("who-email").textContent = d.escopo.email || d.escopo.login || "";
  $("who-pill").textContent = "PERFIL: " + perfilTxt;
  $("hchip").innerHTML = `📅 dados até <b>${fmtData(d.atualizado_ate)}</b>`;

  // fração do mês corrente decorrida (p/ comparar 2025 pro-rata)
  const dt = new Date(d.atualizado_ate + "T12:00:00");
  S.fracMes = dt.getDate() / new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate();

  // seletor de período
  $("f-per").innerHTML =
    `<option value="ytd">YTD (jan–${MESES[d.periodo.mes_atual - 1]})</option>` +
    `<option value="ano">Ano completo</option>` +
    ["q1", "q2", "q3", "q4"].map((q) => `<option value="${q}">${q.toUpperCase()}</option>`).join("") +
    MESES.map((m, i) => `<option value="${i + 1}">${m}</option>`).join("");
  $("f-ano").innerHTML = `<option>2026</option><option>2025</option>`;

  const gers = [...new Set(d.clientes.map((p) => p.ger))].filter(Boolean).sort();
  if (d.escopo.perfil === "gestor") preencherSelect("f-ger", gers);
  else $("f-ger-wrap").style.display = "none";
  if (d.escopo.perfil === "vendedor") $("f-vend-wrap").style.display = "none";
  else atualizarVendSelect();

  renderAll();
}

function preencherSelect(id, itens, labelFn) {
  $(id).innerHTML = '<option value="">Todos</option>' +
    itens.map((x) => `<option value="${esc(x)}">${esc(labelFn ? labelFn(x) : x)}</option>`).join("");
}

function atualizarVendSelect() {
  if ($("f-vend-wrap").style.display === "none") return;
  const base = S.fGer ? S.data.clientes.filter((p) => p.ger === S.fGer) : S.data.clientes;
  const vends = [...new Set(base.map((p) => p.vend))].filter(Boolean)
    .sort((a, b) => nomeVend(a).localeCompare(nomeVend(b), "pt-BR"));
  preencherSelect("f-vend", vends, nomeVend);
  $("f-vend").value = vends.includes(S.fVend) ? S.fVend : "";
  S.fVend = $("f-vend").value;
}

function onFiltro() {
  S.fGer = $("f-ger-wrap").style.display === "none" ? "" : $("f-ger").value;
  S.fVend = $("f-vend-wrap").style.display === "none" ? "" : $("f-vend").value;
  S.ano = parseInt($("f-ano").value, 10);
  S.per = $("f-per").value;
  atualizarVendSelect();
  S.nPos = 100; S.nCli = 50;
  renderAll();
}

function limparFiltros() {
  if ($("f-ger")) $("f-ger").value = "";
  if ($("f-vend")) $("f-vend").value = "";
  $("f-ano").value = "2026"; $("f-per").value = "ytd";
  S.fStatus = ""; S.busca = ""; S.buscaMeta = "";
  $("busca-pos").value = ""; $("busca-meta").value = "";
  document.querySelectorAll(".fchip[data-st]").forEach((x) => x.classList.remove("on"));
  onFiltro();
}

function linhas() {
  let r = S.data.clientes;
  if (S.fGer) r = r.filter((p) => p.ger === S.fGer);
  if (S.fVend) r = r.filter((p) => p.vend === S.fVend);
  return r;
}
const filtrado = () => !!(S.fGer || S.fVend);

/* ---------------- render ---------------- */
function renderAll() {
  const rows = linhas(), meses = mesesSel();
  renderChips();
  renderKpis(rows, meses);
  renderEvolucao(rows);
  renderSemaforo(rows);
  renderFamilias();
  renderMetas(rows, meses);
  renderPositivados(rows);
  renderRankings(rows, meses);
}

function renderChips() {
  $("chip-periodo").textContent = `${S.ano} · ${rotuloPer()} · dados até ${fmtData(S.data.atualizado_ate)}`;
  const f = [];
  if (S.fGer) f.push("Gerente: " + S.fGer);
  if (S.fVend) f.push("Vendedor: " + nomeVend(S.fVend));
  $("chip-filtro").textContent = f.join(" · ");
  $("chip-filtro").style.display = f.length ? "" : "none";
}

function kpiCard(icone, cor, titulo, valor, detalhe) {
  return `<div class="kpi"><div class="hd"><div class="ic" style="background:${cor}22">${icone}</div>
    <div class="t">${titulo}</div></div><div class="v">${valor}</div><div class="d">${detalhe}</div></div>`;
}

const IC = {
  fat: '<svg viewBox="0 0 24 24" fill="none" stroke="#2f7d7c" stroke-width="2"><path d="M3 17l5-5 4 4 8-8"/><path d="M14 8h6v6"/></svg>',
  meta: '<svg viewBox="0 0 24 24" fill="none" stroke="#b57f22" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/></svg>',
  vol: '<svg viewBox="0 0 24 24" fill="none" stroke="#7d7a2e" stroke-width="2"><path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/></svg>',
  cart: '<svg viewBox="0 0 24 24" fill="none" stroke="#4f9aa0" stroke-width="2"><path d="M4 7h16v13H4zM8 7V4h8v3"/></svg>',
  dev: '<svg viewBox="0 0 24 24" fill="none" stroke="#C96643" stroke-width="2"><path d="M9 14l-4-4 4-4"/><path d="M5 10h11a4 4 0 010 8h-2"/></svg>',
  pos: '<svg viewBox="0 0 24 24" fill="none" stroke="#5d8756" stroke-width="2"><circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 11l2 2 4-4"/></svg>',
};

function renderKpis(rows, meses) {
  const d = S.data, k = d.kpis;
  const fat = somaPer(rows, S.ano, meses);
  const ly = somaLY(rows, meses);
  const cresc = ly > 0 ? (fat - ly) / ly : null;
  const meta = metaPer(rows, meses);
  const ating = meta ? fat / meta : null;
  const gap = meta ? fat - meta : null;

  const ehYtd = S.per === "ytd", noMes = ehYtd && S.ano === d.periodo.ano;
  const positivados = noMes
    ? rows.filter((p) => p.status === "ok").length
    : rows.filter((p) => { const a = serie(p, S.ano); return a && meses.some((m) => a[m - 1]); }).length;
  const base = rows.filter((p) => p.meta.some((v) => v) || p.m26.some((v) => v) ||
    (S.ano === 2025 && p.m25.some((v) => v))).length;
  const vol = S.ano === 2026 ? rows.reduce((s, p) => s + meses.reduce((t, m) => t + (p.q26[m - 1] || 0), 0), 0) : null;
  const ativosPer = rows.filter((p) => { const a = serie(p, S.ano); return a && meses.some((m) => a[m - 1]); }).length;
  const ticket = ativosPer ? fat / ativosPer : null;

  const crescPill = cresc == null ? "" :
    `<span class="dl ${cresc >= 0 ? "up" : "dn"}">${cresc >= 0 ? "▲" : "▼"} ${fmtPct(Math.abs(cresc))}</span> `;
  const atingCor = ating == null ? "var(--soft)" : ating >= 1 ? "var(--ok)" : ating >= 0.9 ? "var(--warn)" : "var(--bad)";
  const escT = '<span style="color:var(--soft)">escopo total (sem filtro)</span>';

  $("kpis").innerHTML =
    kpiCard(IC.fat, "#2f7d7c", `Faturamento<br>líquido · ${rotuloPer()}`, fmtM(fat),
      crescPill + `vs ${S.ano - 1} mesmo período (${fmtM(ly)})`) +
    kpiCard(IC.meta, "#E0A339", "Atingimento<br>da meta", `<span style="color:${atingCor}">${fmtPct(ating)}</span>`,
      meta ? `meta ${fmtM(meta)} · ${gap >= 0 ? "sobra" : "falta"} <b style="color:${gap >= 0 ? "var(--ok)" : "var(--bad)"}">${fmtM(Math.abs(gap))}</b>`
           : "sem meta no período/seleção") +
    kpiCard(IC.vol, "#9B9741", "Volume<br>(caixas)", vol == null ? "—" : fmtNum(vol),
      ticket ? `Ticket médio <b>${fmtM(ticket)}</b>` : "Ticket médio —") +
    kpiCard(IC.cart, "#4f9aa0", "Pedidos<br>em carteira", filtrado() ? "—" : fmtM(k.carteira),
      filtrado() ? escT : "snapshot " + fmtData(d.atualizado_ate)) +
    kpiCard(IC.dev, "#C96643", `Devolução<br>${d.periodo.ano} YTD`, filtrado() ? "—" : fmtM(k.devolucao),
      filtrado() ? escT : "já abatida do líquido") +
    kpiCard(IC.pos, "#8AAB83", `Positivados<br>${noMes ? "no mês" : "no período"}`,
      `${fmtBR(positivados)}<small>/${fmtBR(base)}</small>`,
      base ? `<b style="color:var(--teal-d)">${fmtPct(positivados / base)}</b> da base` : "");
}

/* ---------- evolução: sempre os últimos 12 meses ---------- */
function renderEvolucao(rows) {
  const { ano, mes_atual } = S.data.periodo;
  const itens = [];
  for (let k = 11; k >= 0; k--) {
    const idx = ano * 12 + mes_atual - 1 - k;
    const y = Math.floor(idx / 12), m = (idx % 12) + 1;
    let fat = 0, ly = 0;
    for (const c of rows) {
      const a = serie(c, y), b = serie(c, y - 1);
      if (a) fat += a[m - 1] || 0;
      if (b) ly += b[m - 1] || 0;
    }
    itens.push({ label: `${MESES[m - 1]}/${String(y).slice(2)}`, fat, ly,
                 parcial: y === ano && m === mes_atual });
  }
  $("evo-titulo").innerHTML = `Últimos 12 meses — Realizado × Ano anterior <span class="rg">R$</span>`;
  $("evo-chart").innerHTML = svgEvolucao(itens);
  $("evo-leg").innerHTML =
    `<span><i style="background:linear-gradient(180deg,#74AFAE,#2f7d7c)"></i>Realizado</span>` +
    `<span><i style="background:#dde3e5"></i>Mesmo mês do ano anterior</span>` +
    `<span><i style="background:#2e9e63"></i>▲▼ crescimento vs ano anterior</span>` +
    `<span style="margin-left:auto">${MESES[mes_atual - 1]}/${String(ano).slice(2)} = parcial</span>`;
}

function svgEvolucao(itens) {
  const W = 720, H = 258, base = 214, topo = 50;
  const n = itens.length, passo = W / n;
  const max = Math.max(1, ...itens.map((i) => Math.max(i.fat, i.ly)));
  const y = (v) => base - (v / max) * (base - topo);
  const wB = Math.min(17, passo * 0.32);
  let s = `<svg viewBox="0 0 ${W} ${H}" style="width:100%">`;
  s += '<g stroke="#eef1f2" stroke-width="1">';
  for (let i = 1; i <= 4; i++) s += `<line x1="0" y1="${topo + (base - topo) * i / 4}" x2="${W}" y2="${topo + (base - topo) * i / 4}"/>`;
  s += "</g>";
  s += '<g font-size="10" fill="#8a979d" text-anchor="middle">';
  itens.forEach((it, i) => { s += `<text x="${passo * i + passo / 2}" y="${H - 8}">${esc(it.label)}</text>`; });
  s += "</g>";
  s += '<defs><linearGradient id="gt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#74AFAE"/><stop offset="1" stop-color="#2f7d7c"/></linearGradient></defs>';
  itens.forEach((it, i) => {
    const cx = passo * i + passo / 2;
    if (it.ly > 0)
      s += `<rect x="${cx - wB - 1}" y="${y(it.ly)}" width="${wB}" height="${base - y(it.ly)}" rx="2.5" fill="#dde3e5"><title>${esc(it.label)} ano anterior: ${fmtM(it.ly)}</title></rect>`;
    if (it.fat > 0)
      s += `<rect x="${cx + 1}" y="${y(it.fat)}" width="${wB}" height="${base - y(it.fat)}" rx="2.5" fill="url(#gt)"><title>${esc(it.label)}: ${fmtM(it.fat)}</title></rect>`;
    /* rótulos empilhados acima do par de barras:
       crescimento ▲/▼ (topo) → realizado (meio) → ano anterior (base, cinza) */
    const yTop = y(Math.max(it.fat, it.ly));
    if (it.ly > 0)
      s += `<text x="${cx}" y="${yTop - 4}" font-size="8.5" fill="#8a979d" text-anchor="middle">${fmtNum(it.ly)}</text>`;
    if (it.fat > 0)
      s += `<text x="${cx}" y="${yTop - 15}" font-size="9.5" font-weight="700" fill="#182226" text-anchor="middle">${fmtNum(it.fat)}${it.parcial ? "*" : ""}</text>`;
    if (it.fat > 0 && it.ly > 0 && !it.parcial) {  /* mês parcial não compara (1 dia vs mês cheio) */
      const g = (it.fat - it.ly) / it.ly;
      const cor = g >= 0 ? "#2e9e63" : "#cc4b41";
      s += `<text x="${cx}" y="${yTop - 27}" font-size="9" font-weight="700" fill="${cor}" text-anchor="middle">${g >= 0 ? "▲" : "▼"} ${fmtBR(Math.abs(g) * 100, 0)}%</text>`;
    }
  });
  return s + "</svg>";
}

/* ---------- semáforo / famílias ---------- */
const ST = {
  ok: { pill: "p-ok", nome: "Comprou no mês" },
  atencao: { pill: "p-warn", nome: "Atenção · 1 mês" },
  validar: { pill: "p-val", nome: "Validar · 2 meses" },
  acionar: { pill: "p-bad", nome: "Acionar agora" },
};

function renderSemaforo(rows) {
  const c = { ok: 0, atencao: 0, validar: 0, acionar: 0 };
  let risco = 0;
  for (const p of rows) { c[p.status]++; risco += p.perdido || 0; }
  const tot = rows.length || 1;
  $("semaforo").innerHTML = ["ok", "atencao", "validar", "acionar"].map((st) =>
    `<tr><td><span class="pill ${ST[st].pill}">${ST[st].nome}</span></td>
     <td class="r"><b>${fmtBR(c[st])}</b></td>
     <td class="r" style="color:var(--soft)">${fmtPct(c[st] / tot, 0)}</td></tr>`).join("");
  $("nota-risco").innerHTML = risco > 0
    ? `💡 <b>${fmtM(risco)}</b> estimados em risco nos clientes parados — priorize a página <b>Positivados</b>.`
    : "✅ Sem valor relevante em risco no momento.";
}

function renderFamilias() {
  $("familias-mini").innerHTML = (S.data.familias || []).slice(0, 3).map((f, i) =>
    `<li><span class="n">${i + 1}</span><span class="nm">${esc(f.nome)}</span><span class="vl">${fmtM(f.fat)}</span></li>`).join("");
}

/* ---------- Metas ---------- */
function agrupar(rows, campo, meses) {
  const g = {};
  for (const p of rows) {
    const k = p[campo] || "SEM CADASTRO";
    const o = (g[k] ??= { nome: k, meta: 0, realizado: 0, ly: 0, clientes: 0, positivados: 0 });
    for (const m of meses) {
      o.meta += p.meta[m - 1] || 0;
      const a = serie(p, S.ano); if (a) o.realizado += a[m - 1] || 0;
      const b = serie(p, S.ano - 1); if (b) o.ly += b[m - 1] || 0;
    }
    o.clientes++; if (p.status === "ok") o.positivados++;
  }
  return Object.values(g).map((o) => (o.ating = o.meta ? o.realizado / o.meta : null, o))
    .sort((a, b) => b.realizado - a.realizado);
}

function linhaMetaTabela(o) {
  const at = o.ating;
  const cor = at == null ? "var(--soft)" : at >= 1 ? "var(--ok)" : at >= 0.9 ? "var(--txt)" : at >= 0.8 ? "var(--warn)" : "var(--bad)";
  const cls = at == null ? "" : at >= 0.9 ? "" : at >= 0.8 ? "gold" : "red";
  const w = at == null ? 0 : Math.min(100, at * 100);
  const gap = o.meta ? o.realizado - o.meta : null;
  return `<tr><td><b>${esc(nomeVend(o.nome))}</b></td>
    <td class="r">${o.meta ? fmtM(o.meta) : "—"}</td><td class="r">${fmtM(o.realizado)}</td>
    <td><div class="bar"><i class="${cls}" style="width:${w}%"></i></div></td>
    <td class="r" style="color:${cor}"><b>${at == null ? "—" : fmtPct(at, 0)}</b></td>
    <td class="r" style="color:${gap == null ? "var(--soft)" : gap >= 0 ? "var(--ok)" : "var(--bad)"}">${gap == null ? "—" : (gap >= 0 ? "+" : "−") + fmtM(Math.abs(gap))}</td></tr>`;
}

function renderMetas(rows, meses) {
  const d = S.data;
  let titulo, grupos;
  if (d.escopo.perfil === "gestor" && !S.fGer && !S.fVend) {
    titulo = `Por gerente — ${rotuloPer()} ${S.ano}`; grupos = agrupar(rows, "ger", meses);
  } else if (d.escopo.perfil !== "vendedor" && !S.fVend) {
    titulo = `Por vendedor — ${rotuloPer()} ${S.ano}`; grupos = agrupar(rows, "vend", meses);
  } else {
    titulo = `Por cliente — ${rotuloPer()} ${S.ano}`;
    grupos = agrupar(rows, "cliente", meses).slice(0, 60);
  }
  $("metas-n1-titulo").textContent = titulo;
  $("metas-n1").innerHTML = grupos.map(linhaMetaTabela).join("") || '<tr><td colspan="6" class="empty">Sem dados.</td></tr>';

  const busca = S.buscaMeta.toLowerCase();
  let cli = rows.map((p) => {
    let meta = 0, real = 0;
    for (const m of meses) { meta += p.meta[m - 1] || 0; const a = serie(p, S.ano); if (a) real += a[m - 1] || 0; }
    return { ...p, metaP: meta, realP: real, gap: real - meta };
  }).filter((p) => p.metaP > 0);
  if (busca) cli = cli.filter((p) => p.cliente.toLowerCase().includes(busca));
  cli.sort((a, b) => a.gap - b.gap);
  $("metas-gaps").innerHTML = cli.slice(0, S.nCli).map((p) => {
    const at = p.metaP ? p.realP / p.metaP : null;
    return `<tr><td><b>${esc(p.cliente)}</b></td><td>${esc(nomeVend(p.vend))}</td>
      <td class="r">${fmtM(p.metaP)}</td><td class="r">${fmtM(p.realP)}</td>
      <td class="r" style="color:${at >= 1 ? "var(--ok)" : at >= 0.8 ? "var(--warn)" : "var(--bad)"}"><b>${fmtPct(at, 0)}</b></td>
      <td class="r" style="color:${p.gap >= 0 ? "var(--ok)" : "var(--bad)"}">${(p.gap >= 0 ? "+" : "−") + fmtM(Math.abs(p.gap))}</td></tr>`;
  }).join("") || '<tr><td colspan="6" class="empty">Nenhum cliente com meta na seleção.</td></tr>';
  $("metas-mais").style.display = cli.length > S.nCli ? "" : "none";
}

/* ---------- Positivados (recência = foto atual; não muda com o período) ---------- */
function sparkHtml(p) {
  const { ano, mes_atual } = S.data.periodo;
  const vals = [];
  for (let k = 6; k >= 0; k--) {
    const idx = ano * 12 + mes_atual - 1 - k;
    const y = Math.floor(idx / 12), m = (idx % 12) + 1;
    const a = serie(p, y);
    vals.push(a ? Math.max(0, a[m - 1] || 0) : 0);
  }
  const max = Math.max(1, ...vals);
  return '<div class="spark">' + vals.map((v) =>
    v > 0 ? `<i style="height:${Math.max(4, Math.round((v / max) * 26))}px"></i>` : '<i class="z"></i>').join("") + "</div>";
}

function renderPositivados(rows) {
  const d = S.data;
  const busca = S.busca.toLowerCase();
  let r = rows;
  if (S.fStatus) r = r.filter((p) => p.status === S.fStatus);
  if (busca) r = r.filter((p) => p.cliente.toLowerCase().includes(busca));
  r = [...r].sort((a, b) => (b.perdido || 0) - (a.perdido || 0) || sum26(b) - sum26(a));

  const mostraVend = d.escopo.perfil !== "vendedor";
  $("pos-head").innerHTML = `<tr><th>Cliente</th>${mostraVend ? "<th>Vendedor</th>" : ""}<th>Últ. compra</th>
    <th>Últimos 7 meses</th><th class="r">Média/mês</th><th class="r">Em risco</th><th>Status / Ação</th></tr>`;
  $("pos-body").innerHTML = r.slice(0, S.nPos).map((p) => {
    const st = ST[p.status] || ST.acionar;
    const stTxt = p.status === "acionar" && p.meses_sem < 99 ? `Acionar agora · ${p.meses_sem} meses` : st.nome;
    const subs = [p.uf, p.cnpjs > 1 ? `${p.cnpjs} CNPJs` : ""].filter(Boolean).join(" · ");
    return `<tr><td><b>${esc(p.cliente)}</b><span style="display:block;font-size:10.5px;color:var(--soft)">${esc(subs)}</span></td>
      ${mostraVend ? `<td>${esc(nomeVend(p.vend))}</td>` : ""}
      <td>${fmtData(p.ult)}</td><td>${sparkHtml(p)}</td>
      <td class="r">${fmtM(p.media)}</td>
      <td class="r">${p.perdido > 0 ? `<b style="color:var(--bad)">${fmtM(p.perdido)}</b>` : '<span style="color:var(--soft)">—</span>'}</td>
      <td><span class="pill ${st.pill}">${stTxt}</span></td></tr>`;
  }).join("") || `<tr><td colspan="7" class="empty">Nenhum cliente encontrado.</td></tr>`;
  $("pos-mais").style.display = r.length > S.nPos ? "" : "none";
  $("pos-info").textContent = `${fmtBR(Math.min(S.nPos, r.length))} de ${fmtBR(r.length)} clientes`;
}
const sum26 = (p) => p.m26.reduce((s, v) => s + v, 0);

/* ---------- Rankings ---------- */
function liRank(i, nome, sub, valor) {
  return `<li><span class="n">${i + 1}</span><span class="nm">${esc(nome)}${sub ? `<span class="sb">${esc(sub)}</span>` : ""}</span><span class="vl">${valor}</span></li>`;
}

function renderRankings(rows, meses) {
  const d = S.data;
  if (d.escopo.perfil !== "vendedor") {
    const v = agrupar(rows, "vend", meses).slice(0, 10);
    $("rk-vend").innerHTML = v.map((o, i) => liRank(i, nomeVend(o.nome), null, fmtM(o.realizado))).join("");
    $("rk-vend-card").style.display = "";
  } else $("rk-vend-card").style.display = "none";
  if (d.escopo.perfil === "gestor" && !S.fGer) {
    const g = agrupar(rows, "ger", meses).slice(0, 10);
    $("rk-ger").innerHTML = g.map((o, i) => liRank(i, o.nome, null, fmtM(o.realizado))).join("");
    $("rk-ger-card").style.display = "";
  } else $("rk-ger-card").style.display = "none";
  const c = rows.map((p) => {
    let f = 0; const a = serie(p, S.ano);
    if (a) for (const m of meses) f += a[m - 1] || 0;
    return { p, f };
  }).sort((x, y) => y.f - x.f).slice(0, 10);
  $("rk-cli").innerHTML = c.map(({ p, f }, i) => liRank(i, p.cliente, `${nomeVend(p.vend)} · ${p.uf}`, fmtM(f))).join("");
  const fm = (d.familias || []).slice(0, 10);
  $("rk-fam").innerHTML = fm.map((o, i) => liRank(i, o.nome, null, fmtM(o.fat))).join("");
  $("rk-fam-nota").style.display = (filtrado() || S.per !== "ytd" || S.ano !== 2026) ? "" : "none";
}

/* ---------------- exportação PDF / Excel ---------------- */
const viewAtiva = () => document.querySelector(".view.on").id.slice(2);
const NOMES_VIEW = { geral: "Overview", metas: "Metas vs Realizado", posit: "Positivados", rank: "Rankings" };

function contextoTxt() {
  const f = [];
  if (S.fGer) f.push("Gerente: " + S.fGer);
  if (S.fVend) f.push("Vendedor: " + nomeVend(S.fVend));
  return `${S.ano} · ${rotuloPer()}${f.length ? " · " + f.join(" · ") : ""} · dados até ${fmtData(S.data.atualizado_ate)}`;
}
const arquivoNome = (ext) =>
  `book-vendas-${viewAtiva()}-${S.ano}-${S.per}${S.fGer ? "-" + S.fGer.toLowerCase().replace(/\W+/g, "_") : ""}${S.fVend ? "-" + nomeVend(S.fVend).toLowerCase().replace(/\W+/g, "_") : ""}.${ext}`;

function exportPDF() {
  $("print-head").innerHTML =
    `<div class="ph-t">Book de Vendas BR Spices — ${NOMES_VIEW[viewAtiva()]}</div>
     <div class="ph-s">${esc(contextoTxt())} · gerado em ${new Date().toLocaleString("pt-BR")} por ${esc(S.data.escopo.nome)}</div>
     <div class="ph-b"></div>`;
  const nPos0 = S.nPos, nCli0 = S.nCli;
  S.nPos = 1e6; S.nCli = 1e6;           // imprime as tabelas completas
  renderAll();
  const restaurar = () => { S.nPos = nPos0; S.nCli = nCli0; renderAll(); window.onafterprint = null; };
  window.onafterprint = restaurar;
  window.print();
  setTimeout(restaurar, 2000);          // fallback (Safari/afterprint ausente)
}

let _exceljs = null;
function comExcelJS() {
  if (_exceljs) return Promise.resolve(_exceljs);
  return new Promise((ok, ko) => {
    const sc = document.createElement("script");
    sc.src = "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js";
    sc.onload = () => ok(_exceljs = window.ExcelJS);
    sc.onerror = () => ko(new Error("Sem internet para carregar o gerador de Excel."));
    document.head.appendChild(sc);
  });
}

const XL = {
  ink: "FF183A3F", teal: "FF4F9AA0", zebra: "FFF3F7F7", borda: "FFE4E9EA",
  money: '"R$" #,##0', pct: "0.0%", num: "#,##0",
};

function xlTitulo(ws, txt, sub) {
  ws.addRow([txt]).font = { bold: true, size: 15, color: { argb: XL.ink } };
  ws.addRow([sub]).font = { size: 10, color: { argb: "FF64737A" } };
  ws.addRow([]);
}

function xlTabela(ws, titulo, headers, rows, fmts, widths) {
  if (titulo) ws.addRow([titulo]).font = { bold: true, size: 12, color: { argb: XL.ink } };
  const h = ws.addRow(headers);
  h.eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: XL.ink } };
    c.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    c.alignment = { vertical: "middle" };
    c.border = { bottom: { style: "thin", color: { argb: XL.borda } } };
  });
  rows.forEach((r, i) => {
    const row = ws.addRow(r);
    row.eachCell((c, col) => {
      if (fmts && fmts[col - 1]) c.numFmt = fmts[col - 1];
      if (i % 2) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: XL.zebra } };
      c.border = { bottom: { style: "thin", color: { argb: XL.borda } } };
      c.font = { size: 10 };
    });
  });
  if (widths) widths.forEach((w, i) => { ws.getColumn(i + 1).width = Math.max(ws.getColumn(i + 1).width || 0, w); });
  ws.addRow([]);
}

async function exportExcel() {
  const btn = $("btn-xls");
  btn.disabled = true; btn.textContent = "Gerando…";
  try {
    const ExcelJS = await comExcelJS();
    const wb = new ExcelJS.Workbook();
    const rows = linhas(), meses = mesesSel();
    const v = viewAtiva();
    const ws = wb.addWorksheet(NOMES_VIEW[v], { views: [{ showGridLines: false }] });
    xlTitulo(ws, `Book de Vendas BR Spices — ${NOMES_VIEW[v]}`, contextoTxt() +
      ` · gerado em ${new Date().toLocaleString("pt-BR")} por ${S.data.escopo.nome}`);

    if (v === "geral") {
      const fat = somaPer(rows, S.ano, meses), ly = somaLY(rows, meses);
      const meta = metaPer(rows, meses);
      const vol = S.ano === 2026 ? rows.reduce((s, p) => s + meses.reduce((t, m) => t + (p.q26[m - 1] || 0), 0), 0) : null;
      const ativos = rows.filter((p) => { const a = serie(p, S.ano); return a && meses.some((m) => a[m - 1]); }).length;
      xlTabela(ws, "Indicadores", ["Indicador", "Valor"], [
        ["Faturamento líquido", Math.round(fat)],
        [`${S.ano - 1} mesmo período`, Math.round(ly)],
        ["Crescimento", ly > 0 ? (fat - ly) / ly : null],
        ["Meta do período", meta ? Math.round(meta) : null],
        ["Atingimento", meta ? fat / meta : null],
        ["Volume (caixas)", vol == null ? null : Math.round(vol)],
        ["Ticket médio", ativos ? Math.round(fat / ativos) : null],
        ["Pedidos em carteira (escopo)", S.data.kpis.carteira],
        ["Devolução YTD (escopo)", S.data.kpis.devolucao],
        ["Clientes ativos no período", ativos],
      ], [null, XL.money], [34, 18]);
      /* linhas: 6 fat, 7 ly, 8 cresc, 9 meta, 10 ating, 11 volume, 12 ticket, 13 carteira, 14 dev, 15 ativos */
      ws.getCell("B8").numFmt = XL.pct; ws.getCell("B10").numFmt = XL.pct;
      ws.getCell("B11").numFmt = XL.num; ws.getCell("B15").numFmt = XL.num;
      const { ano, mes_atual } = S.data.periodo, me = S.data.meta_empresa_mensal;
      const evo = [];
      for (let k = 11; k >= 0; k--) {
        const idx = ano * 12 + mes_atual - 1 - k, y = Math.floor(idx / 12), m = (idx % 12) + 1;
        let f = 0, l = 0;
        for (const c of rows) { const a = serie(c, y), b = serie(c, y - 1); if (a) f += a[m - 1] || 0; if (b) l += b[m - 1] || 0; }
        const mt = y === 2026 ? ((me && !filtrado()) ? me[m - 1] || 0 : rows.reduce((s, c) => s + (c.meta[m - 1] || 0), 0)) : null;
        evo.push([`${MESES[m - 1]}/${String(y).slice(2)}`, Math.round(f), Math.round(l), mt ? Math.round(mt) : null]);
      }
      xlTabela(ws, "Últimos 12 meses", ["Mês", "Realizado", "Ano anterior", "Meta"], evo,
        [null, XL.money, XL.money, XL.money], [12, 16, 16, 16]);
      const c = { ok: 0, atencao: 0, validar: 0, acionar: 0 };
      rows.forEach((p) => c[p.status]++);
      xlTabela(ws, "Semáforo da base", ["Status", "Clientes"],
        [["Comprou no mês", c.ok], ["1 mês sem compra", c.atencao], ["2 meses — validar", c.validar], ["3+ meses — acionar", c.acionar]],
        [null, XL.num], [24, 12]);
      xlTabela(ws, "Top famílias (YTD escopo)", ["Família", "Faturamento"],
        (S.data.familias || []).slice(0, 10).map((f) => [f.nome, Math.round(f.fat)]), [null, XL.money], [26, 16]);

    } else if (v === "metas") {
      const nivel = (S.data.escopo.perfil === "gestor" && !S.fGer && !S.fVend) ? "ger"
        : (S.data.escopo.perfil !== "vendedor" && !S.fVend) ? "vend" : "cliente";
      const grupos = agrupar(rows, nivel, meses);
      xlTabela(ws, `Por ${nivel === "ger" ? "gerente" : nivel === "vend" ? "vendedor" : "cliente"} — ${rotuloPer()} ${S.ano}`,
        ["Nome", "Meta", "Realizado", "Ating.", "Gap"],
        grupos.map((o) => [nomeVend(o.nome), o.meta ? Math.round(o.meta) : null, Math.round(o.realizado),
          o.ating, o.meta ? Math.round(o.realizado - o.meta) : null]),
        [null, XL.money, XL.money, XL.pct, XL.money], [34, 15, 15, 10, 15]);
      const cli = rows.map((p) => {
        let mt = 0, re = 0;
        for (const m of meses) { mt += p.meta[m - 1] || 0; const a = serie(p, S.ano); if (a) re += a[m - 1] || 0; }
        return { p, mt, re };
      }).filter((x) => x.mt > 0).sort((a, b) => (a.re - a.mt) - (b.re - b.mt));
      xlTabela(ws, "Gaps por cliente (todos)", ["Cliente", "Vendedor", "Meta", "Realizado", "Ating.", "Gap"],
        cli.map(({ p, mt, re }) => [p.cliente, nomeVend(p.vend), Math.round(mt), Math.round(re), re / mt, Math.round(re - mt)]),
        [null, null, XL.money, XL.money, XL.pct, XL.money], [34, 24, 15, 15, 10, 15]);

    } else if (v === "posit") {
      let r = rows;
      if (S.fStatus) r = r.filter((p) => p.status === S.fStatus);
      if (S.busca) r = r.filter((p) => p.cliente.toLowerCase().includes(S.busca.toLowerCase()));
      r = [...r].sort((a, b) => (b.perdido || 0) - (a.perdido || 0) || sum26(b) - sum26(a));
      xlTabela(ws, `Positivados — semáforo de recência (${r.length} clientes)`,
        ["Cliente", "Vendedor", "Gerente", "UF", "CNPJs", "Últ. compra", "Meses sem compra", "Status", "Média/mês", "Em risco", "Fat 2026 YTD"],
        r.map((p) => [p.cliente, nomeVend(p.vend), p.ger, p.uf, p.cnpjs,
          p.ult ? fmtData(p.ult) : "—", p.meses_sem >= 99 ? null : p.meses_sem,
          (ST[p.status] || ST.acionar).nome, Math.round(p.media), p.perdido ? Math.round(p.perdido) : null, Math.round(sum26(p))]),
        [null, null, null, null, XL.num, null, XL.num, null, XL.money, XL.money, XL.money],
        [34, 24, 22, 8, 8, 12, 10, 20, 14, 14, 15]);

    } else if (v === "rank") {
      if (S.data.escopo.perfil === "gestor" && !S.fGer)
        xlTabela(ws, "Gerentes", ["#", "Gerente", "Faturamento"],
          agrupar(rows, "ger", meses).map((o, i) => [i + 1, o.nome, Math.round(o.realizado)]),
          [XL.num, null, XL.money], [5, 30, 16]);
      if (S.data.escopo.perfil !== "vendedor")
        xlTabela(ws, "Vendedores", ["#", "Vendedor", "Faturamento"],
          agrupar(rows, "vend", meses).map((o, i) => [i + 1, nomeVend(o.nome), Math.round(o.realizado)]),
          [XL.num, null, XL.money], [5, 30, 16]);
      const cli = rows.map((p) => { let f = 0; const a = serie(p, S.ano); if (a) for (const m of meses) f += a[m - 1] || 0; return { p, f }; })
        .sort((x, y) => y.f - x.f).slice(0, 50);
      xlTabela(ws, "Clientes (top 50)", ["#", "Cliente", "Vendedor", "UF", "Faturamento"],
        cli.map(({ p, f }, i) => [i + 1, p.cliente, nomeVend(p.vend), p.uf, Math.round(f)]),
        [XL.num, null, null, null, XL.money], [5, 34, 24, 8, 16]);
      xlTabela(ws, "Famílias (YTD escopo)", ["#", "Família", "Faturamento"],
        (S.data.familias || []).map((f, i) => [i + 1, f.nome, Math.round(f.fat)]),
        [XL.num, null, XL.money], [5, 28, 16]);
    }

    const buf = await wb.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([buf],
      { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    const a = document.createElement("a");
    a.href = url; a.download = arquivoNome("xlsx"); a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert("Não foi possível gerar o Excel: " + (e.message || e));
  } finally {
    btn.disabled = false; btn.textContent = "⬇ Excel";
  }
}

/* ---------------- navegação e eventos ---------------- */
function trocarView(v) {
  document.querySelectorAll(".nav-i[data-v]").forEach((x) => x.classList.toggle("act", x.dataset.v === v));
  document.querySelectorAll(".view").forEach((x) => x.classList.toggle("on", x.id === "v-" + v));
  window.scrollTo({ top: 0 });
}

document.addEventListener("DOMContentLoaded", () => {
  $("pw").addEventListener("keydown", (e) => { if (e.key === "Enter") entrar(); });
  $("lg").addEventListener("keydown", (e) => { if (e.key === "Enter") $("pw").focus(); });
  $("lbtn").addEventListener("click", entrar);
  document.querySelectorAll(".nav-i[data-v]").forEach((el) => el.addEventListener("click", () => trocarView(el.dataset.v)));
  ["f-ger", "f-vend", "f-ano", "f-per"].forEach((id) => $(id)?.addEventListener("change", onFiltro));
  $("btn-reset").addEventListener("click", limparFiltros);
  $("btn-pdf").addEventListener("click", exportPDF);
  $("btn-xls").addEventListener("click", exportExcel);
  $("who-sair").addEventListener("click", sair);
  $("btn-atualizar").addEventListener("click", () =>
    alert("Atualização automática entra na próxima fase.\nPor enquanto os dados são republicados pelo administrador."));
  $("busca-pos").addEventListener("input", (e) => { S.busca = e.target.value; S.nPos = 100; renderPositivados(linhas()); });
  $("busca-meta").addEventListener("input", (e) => { S.buscaMeta = e.target.value; S.nCli = 50; renderMetas(linhas(), mesesSel()); });
  $("pos-mais").addEventListener("click", () => { S.nPos += 200; renderPositivados(linhas()); });
  $("metas-mais").addEventListener("click", () => { S.nCli += 100; renderMetas(linhas(), mesesSel()); });
  document.querySelectorAll(".fchip[data-st]").forEach((el) => el.addEventListener("click", () => {
    S.fStatus = S.fStatus === el.dataset.st ? "" : el.dataset.st;
    document.querySelectorAll(".fchip[data-st]").forEach((x) => x.classList.toggle("on", x.dataset.st === S.fStatus));
    S.nPos = 100; renderPositivados(linhas());
  }));

  const salvo = sessionStorage.getItem("bv_dados");
  if (salvo) {
    try {
      const d = JSON.parse(salvo);
      if (d.schema === 2) { S.data = d; boot(); } else sessionStorage.removeItem("bv_dados");
    } catch { sessionStorage.removeItem("bv_dados"); }
  }
});
