/* Book de Vendas BR Spices — app v2 (schema 2: séries mensais por CLIENTE-BANDEIRA)
   Login: senha → SHA-256 → data/<hash>.enc.json → PBKDF2 + AES-GCM (WebCrypto). */
"use strict";

const S = { data: null, fGer: "", fVend: "", ano: 2026, meses: [],
            nPos: 100, nCli: 50, fStatus: "", busca: "", buscaMeta: "", fracMes: 1,
            numModo: localStorage.getItem("bv_num") || "detalhado" };
const $ = (id) => document.getElementById(id);
const MESES = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
const seq = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/* ---------------- formatação ---------------- */
const fmtBR = (v, d = 0) => (v ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
function fmtM(v) {  /* KPIs/resumo executivo: compacto, 1 casa, sem R$ */
  if (v == null) return "—";
  const a = Math.abs(v);
  if (a >= 1e6) return fmtBR(v / 1e6, 1) + "M";
  if (a >= 1e3) return fmtBR(v / 1e3, 0) + "K";
  return fmtBR(v, 0);
}
function fmtV(v) {  /* valores em TABELAS de cliente: detalhado (1,264M) ou completo (1.264.489) */
  if (v == null) return "—";
  if (S.numModo === "completo") return fmtBR(v, 0);
  const a = Math.abs(v);
  if (a >= 1e6) return fmtBR(v / 1e6, 3) + "M";
  if (a >= 1e3) return fmtBR(v / 1e3, 0) + "K";
  return fmtBR(v, 0);
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

/* ---------------- autenticação (login + senha, sessão persistente) ---------------- */
function mostrarLogin(msg) {
  $("gate-load").style.display = "none";
  $("gate-forgot").style.display = "none";
  $("gate-form").style.display = "";
  const err = $("gate-err");
  if (msg) { err.textContent = msg; err.style.display = "block"; }
  else err.style.display = "none";
  setTimeout(() => $("lg-email").focus(), 50);
}

async function init() {
  try {
    const res = await fetch("/api/dados", { cache: "no-store" });
    if (res.status === 401) return mostrarLogin();          // sem sessão → tela de login
    if (res.status === 403) return mostrarLogin("Seu acesso ainda não foi liberado. Fale com o administrativo.");
    if (!res.ok) return mostrarLogin("Dados indisponíveis no momento. Tente novamente.");
    S.data = await res.json();
    if (S.data.schema !== 2) return mostrarLogin("Dados em atualização — tente novamente em instantes.");
    boot();
  } catch {
    mostrarLogin("Falha de conexão. Verifique a internet e tente de novo.");
  }
}

async function fazerLogin(ev) {
  ev.preventDefault();
  const btn = $("lg-btn"), err = $("gate-err");
  const email = $("lg-email").value.trim().toLowerCase();
  const senha = $("lg-senha").value;
  err.style.display = "none";
  if (!email || !senha) return;
  btn.disabled = true; btn.textContent = "Entrando…";
  try {
    const res = await fetch("/api/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, senha }),
    });
    if (res.ok) { $("lg-senha").value = ""; await init(); return; }
    const c = await res.json().catch(() => ({}));
    err.textContent = res.status === 429 ? "Muitas tentativas. Aguarde uns minutos e tente de novo."
      : c.erro === "credenciais" ? "E-mail ou senha incorretos." : "Não foi possível entrar.";
    err.style.display = "block";
  } catch {
    err.textContent = "Falha de conexão."; err.style.display = "block";
  } finally {
    btn.disabled = false; btn.textContent = "Entrar";
  }
}

async function sair() {
  try { await fetch("/api/logout", { method: "POST" }); } catch {}
  location.reload();
}

async function trocarSenha() {
  const atual = prompt("Senha atual:");
  if (atual == null) return;
  const nova = prompt("Nova senha (mínimo 6 caracteres):");
  if (nova == null) return;
  if (nova.length < 6) { alert("A nova senha precisa ter ao menos 6 caracteres."); return; }
  const res = await fetch("/api/senha", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ senhaAtual: atual, senhaNova: nova }),
  });
  const c = await res.json().catch(() => ({}));
  alert(res.ok ? "Senha alterada com sucesso." :
    c.erro === "senha_atual_incorreta" ? "A senha atual está incorreta." : "Não foi possível alterar a senha.");
}

/* ---------------- período (multi-seleção de meses) ---------------- */
function mesesSel() { return [...S.meses].sort((a, b) => a - b); }

function rotuloPer() {
  const m = mesesSel(), mAtual = S.data.periodo.mes_atual;
  const eq = (arr) => arr.length === m.length && arr.every((x, i) => x === m[i]);
  if (!m.length) return "Selecione…";
  if (eq(seq(1, mAtual)) && S.ano === S.data.periodo.ano) return `YTD (jan–${MESES[mAtual - 1]})`;
  if (m.length === 12) return "Ano completo";
  if (eq(seq(1, 6))) return "H1";
  if (eq(seq(7, 12))) return "H2";
  for (let q = 0; q < 4; q++) if (eq(seq(q * 3 + 1, q * 3 + 3))) return "Q" + (q + 1);
  if (m.length === 1) return MESES[m[0] - 1];
  const contig = m.every((x, i) => i === 0 || x === m[i - 1] + 1);
  if (contig) return `${MESES[m[0] - 1]}–${MESES[m[m.length - 1] - 1]}`;
  return m.map((x) => MESES[x - 1]).join(", ");
}

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
  /* o mês corrente (parcial) entra pro-rata pelos dias decorridos */
  const peso = (m) => (S.ano === S.data.periodo.ano && m === S.data.periodo.mes_atual) ? S.fracMes : 1;
  const me = S.data.meta_empresa_mensal;
  if (me && !filtrado()) return meses.reduce((s, m) => s + (me[m - 1] || 0) * peso(m), 0);
  let s = 0;
  for (const c of rows) for (const m of meses) s += (c.meta[m - 1] || 0) * peso(m);
  return s;
}

/* ---------------- boot ---------------- */
function boot() {
  const d = S.data;
  $("gate").style.display = "none";
  $("app").classList.add("on");
  if (d.escopo.admin) { $("sec-admin").style.display = ""; $("nav-admin").style.display = ""; }

  const perfilTxt = d.escopo.cargo ||
    ({ gestor: "GESTÃO — VÊ TUDO", gerente: "GERENTE — SUA EQUIPE", vendedor: "VENDEDOR — SUA CARTEIRA" }[d.escopo.perfil] || d.escopo.perfil);
  $("who-nome").textContent = d.escopo.nome;
  $("who-email").textContent = d.escopo.email || d.escopo.login || "";
  $("who-pill").textContent = "PERFIL: " + perfilTxt;
  $("foot-data").innerHTML = `📅 Atualizado em: <b>${fmtData(d.atualizado_ate)}</b>`;

  // fração do mês corrente decorrida (p/ comparar 2025 pro-rata)
  const dt = new Date(d.atualizado_ate + "T12:00:00");
  S.fracMes = dt.getDate() / new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate();

  // período: YTD por padrão + meses com checkbox
  S.meses = seq(1, d.periodo.mes_atual);
  $("per-meses").innerHTML = MESES.map((m, i) =>
    `<label class="permes"><input type="checkbox" data-mes="${i + 1}"><span>${m}</span></label>`).join("");
  atualizarPerBtns();
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
  atualizarVendSelect();
  S.nPos = 100; S.nCli = 50;
  renderAll();
}

/* ---- painel de período ---- */
function atualizarPerBtns() {
  document.querySelectorAll("#per-meses input[data-mes]").forEach((cb) =>
    cb.checked = S.meses.includes(+cb.dataset.mes));
  $("per-btn").textContent = rotuloPer();
}
function aplicarPeriodo(meses) {
  S.meses = [...new Set(meses)].filter((m) => m >= 1 && m <= 12);
  S.nPos = 100; S.nCli = 50;
  atualizarPerBtns();
  renderAll();
}
function togglePerPanel(abrir) {
  const p = $("per-panel");
  p.classList.toggle("on", abrir != null ? abrir : !p.classList.contains("on"));
}
function periodoRapido(q) {
  const mA = S.data.periodo.mes_atual;
  const mapa = { ytd: seq(1, mA), ano: seq(1, 12), h1: seq(1, 6), h2: seq(7, 12),
                 q1: seq(1, 3), q2: seq(4, 6), q3: seq(7, 9), q4: seq(10, 12), limpar: [] };
  aplicarPeriodo(mapa[q] || seq(1, mA));
}

function limparFiltros() {
  if ($("f-ger")) $("f-ger").value = "";
  if ($("f-vend")) $("f-vend").value = "";
  $("f-ano").value = "2026";
  S.fStatus = ""; S.busca = ""; S.buscaMeta = "";
  $("busca-pos").value = ""; $("busca-meta").value = "";
  document.querySelectorAll(".fchip[data-st]").forEach((x) => x.classList.remove("on"));
  S.ano = 2026;
  S.meses = seq(1, S.data.periodo.mes_atual);
  atualizarVendSelect(); atualizarPerBtns();
  S.nPos = 100; S.nCli = 50;
  renderAll();
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
  if (FAT.cube && $("v-fat").classList.contains("on")) desenharFat();
}

function renderChips() {
  $("per-btn").textContent = rotuloPer();
  const f = [S.ano + " · " + rotuloPer()];
  if (S.fGer) f.push("Gerente: " + S.fGer);
  if (S.fVend) f.push("Vendedor: " + nomeVend(S.fVend));
  $("chip-filtro").textContent = f.join(" · ");
  $("chip-filtro").style.display = "";
}

function kpiCard(icone, cor, titulo, valor, detalhe, nav) {
  const cls = nav ? ' klick" data-nav="' + nav : "";
  return `<div class="kpi${cls}"><div class="hd"><div class="ic" style="background:${cor}22">${icone}</div>
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

  const noMes = S.ano === d.periodo.ano && meses.includes(d.periodo.mes_atual);
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
      crescPill + `vs ${S.ano - 1} mesmo período (${fmtM(ly)})`, "fat") +
    kpiCard(IC.meta, "#E0A339", "Atingimento<br>da meta", `<span style="color:${atingCor}">${fmtPct(ating)}</span>`,
      meta ? `meta ${fmtM(meta)} · ${gap >= 0 ? "sobra" : "falta"} <b style="color:${gap >= 0 ? "var(--ok)" : "var(--bad)"}">${fmtM(Math.abs(gap))}</b>`
           : "sem meta no período/seleção", "metas") +
    kpiCard(IC.vol, "#9B9741", "Volume<br>(caixas)", vol == null ? "—" : fmtNum(vol),
      ticket ? `Ticket médio <b>${fmtM(ticket)}</b>` : "Ticket médio —", "vol") +
    kpiCard(IC.cart, "#4f9aa0", "Pedidos<br>em carteira", filtrado() ? "—" : fmtM(k.carteira),
      filtrado() ? escT : "snapshot " + fmtData(d.atualizado_ate)) +
    kpiCard(IC.dev, "#C96643", `Devolução<br>${d.periodo.ano} YTD`, filtrado() ? "—" : fmtM(k.devolucao),
      filtrado() ? escT : "já abatida do líquido") +
    kpiCard(IC.pos, "#8AAB83", `Positivados<br>${noMes ? "no mês" : "no período"}`,
      `${fmtBR(positivados)}<small>/${fmtBR(base)}</small>`,
      base ? `<b style="color:var(--teal-d)">${fmtPct(positivados / base)}</b> da base` : "", "posit");

  document.querySelectorAll("#kpis .kpi.klick").forEach((el) =>
    el.addEventListener("click", () => trocarView(el.dataset.nav)));
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
    <td class="r">${o.meta ? fmtV(o.meta) : "—"}</td><td class="r">${fmtV(o.realizado)}</td>
    <td><div class="bar"><i class="${cls}" style="width:${w}%"></i></div></td>
    <td class="r" style="color:${cor}"><b>${at == null ? "—" : fmtPct(at, 0)}</b></td>
    <td class="r" style="color:${gap == null ? "var(--soft)" : gap >= 0 ? "var(--ok)" : "var(--bad)"}">${gap == null ? "—" : (gap >= 0 ? "+" : "−") + fmtV(Math.abs(gap))}</td></tr>`;
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
      <td class="r">${fmtV(p.metaP)}</td><td class="r">${fmtV(p.realP)}</td>
      <td class="r" style="color:${at >= 1 ? "var(--ok)" : at >= 0.8 ? "var(--warn)" : "var(--bad)"}"><b>${fmtPct(at, 0)}</b></td>
      <td class="r" style="color:${p.gap >= 0 ? "var(--ok)" : "var(--bad)"}">${(p.gap >= 0 ? "+" : "−") + fmtV(Math.abs(p.gap))}</td></tr>`;
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
      <td class="r">${fmtV(p.media)}</td>
      <td class="r">${p.perdido > 0 ? `<b style="color:var(--bad)">${fmtV(p.perdido)}</b>` : '<span style="color:var(--soft)">—</span>'}</td>
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
    $("rk-vend").innerHTML = v.map((o, i) => liRank(i, nomeVend(o.nome), null, fmtV(o.realizado))).join("");
    $("rk-vend-card").style.display = "";
  } else $("rk-vend-card").style.display = "none";
  if (d.escopo.perfil === "gestor" && !S.fGer) {
    const g = agrupar(rows, "ger", meses).slice(0, 10);
    $("rk-ger").innerHTML = g.map((o, i) => liRank(i, o.nome, null, fmtV(o.realizado))).join("");
    $("rk-ger-card").style.display = "";
  } else $("rk-ger-card").style.display = "none";
  const c = rows.map((p) => {
    let f = 0; const a = serie(p, S.ano);
    if (a) for (const m of meses) f += a[m - 1] || 0;
    return { p, f };
  }).sort((x, y) => y.f - x.f).slice(0, 10);
  $("rk-cli").innerHTML = c.map(({ p, f }, i) => liRank(i, p.cliente, `${nomeVend(p.vend)} · ${p.uf}`, fmtV(f))).join("");
  const fm = (d.familias || []).slice(0, 10);
  $("rk-fam").innerHTML = fm.map((o, i) => liRank(i, o.nome, null, fmtV(o.fat))).join("");
  $("rk-fam-nota").style.display = (filtrado() || S.ano !== 2026) ? "" : "none";
}

/* ---------------- exportação PDF / Excel ---------------- */
const viewAtiva = () => document.querySelector(".view.on").id.slice(2);
const NOMES_VIEW = { geral: "Dashboard", fat: "Faturamento", vol: "Volume / Mix",
                     metas: "Metas vs Realizado", posit: "Positivados", rank: "Rankings" };

function contextoTxt() {
  const f = [];
  if (S.fGer) f.push("Gerente: " + S.fGer);
  if (S.fVend) f.push("Vendedor: " + nomeVend(S.fVend));
  return `${S.ano} · ${rotuloPer()}${f.length ? " · " + f.join(" · ") : ""} · dados até ${fmtData(S.data.atualizado_ate)}`;
}
const arquivoNome = (ext) =>
  `book-vendas-${viewAtiva()}-${S.ano}-${rotuloPer().toLowerCase().replace(/\W+/g, "_")}${S.fGer ? "-" + S.fGer.toLowerCase().replace(/\W+/g, "_") : ""}${S.fVend ? "-" + nomeVend(S.fVend).toLowerCase().replace(/\W+/g, "_") : ""}.${ext}`;

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

const _libs = {};
function carregarLib(url, global) {
  if (_libs[global]) return Promise.resolve(window[global]);
  return new Promise((ok, ko) => {
    const sc = document.createElement("script");
    sc.src = url;
    sc.onload = () => { _libs[global] = 1; ok(window[global]); };
    sc.onerror = () => ko(new Error("Sem internet para carregar o gerador."));
    document.head.appendChild(sc);
  });
}
const comExcelJS = () => carregarLib("https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js", "ExcelJS");
const comHtml2Canvas = () => carregarLib("https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js", "html2canvas");
const comPptx = () => carregarLib("https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js", "PptxGenJS");

/* captura a visão atual como imagem (canvas) */
async function capturarView() {
  const h2c = await comHtml2Canvas();
  const alvo = document.querySelector(".view.on");
  return h2c(alvo, { backgroundColor: "#eef1f2", scale: 2, useCORS: true });
}

async function exportImagem() {
  try {
    const canvas = await capturarView();
    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url; a.download = arquivoNome("png"); a.click();
  } catch (e) { alert("Não foi possível gerar a imagem: " + (e.message || e)); }
}

async function exportPPT() {
  try {
    const [Pptx, canvas] = [await comPptx(), await capturarView()];
    const pptx = new Pptx();
    pptx.defineLayout({ name: "W", width: 13.33, height: 7.5 });
    pptx.layout = "W";
    const s = pptx.addSlide();
    s.background = { color: "FFFFFF" };
    s.addText(`Book de Vendas BR Spices — ${NOMES_VIEW[viewAtiva()]}`,
      { x: 0.4, y: 0.25, w: 12.5, h: 0.5, fontSize: 18, bold: true, color: "183A3F" });
    s.addText(contextoTxt(), { x: 0.4, y: 0.72, w: 12.5, h: 0.3, fontSize: 10, color: "64737A" });
    const rz = 6.4 / canvas.height, w = Math.min(12.5, canvas.width * rz);
    s.addImage({ data: canvas.toDataURL("image/png"), x: (13.33 - w) / 2, y: 1.05, w, h: canvas.height * (w / canvas.width) });
    await pptx.writeFile({ fileName: arquivoNome("pptx") });
  } catch (e) { alert("Não foi possível gerar o PowerPoint: " + (e.message || e)); }
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

    } else if (v === "fat") {
      if (!FAT.cube) {
        const res = await fetch("/api/fatcube", { cache: "no-store" });
        if (!res.ok) throw new Error("detalhamento indisponível");
        FAT.cube = await res.json();
      }
      const { itens, tot, totalF26 } = calcFat();
      itens.sort((a, b) => b.m.f26 - a.m.f26);
      const cab = ["#", "Cliente", "2025", "2026", "26 vs 25", "% Repr", "Vol 2025", "Vol 2026",
                   "26 vs 25 cx", "Meta", "Realizado", "% Ating", "GAP", "Ano ant."];
      const fmts = [XL.num, null, XL.money, XL.money, XL.pct, XL.pct, XL.num, XL.num,
                    XL.pct, XL.money, XL.money, XL.pct, XL.money, XL.money];
      const linha = (rk, nome, m, base) => [rk, nome, Math.round(m.f25), Math.round(m.f26), m.cr,
        m.f26 / (base || 1), Math.round(m.v25), Math.round(m.v26), m.crv,
        m.meta ? Math.round(m.meta) : null, Math.round(m.realizado), m.ating,
        m.gap == null ? null : Math.round(m.gap), Math.round(m.anoAnt)];
      xlTabela(ws, `Faturamento por cliente — 2025/2026/volumes travados no fechado · Meta em diante: ${rotuloPer()}`,
        cab, [...itens.map((x, i) => linha(i + 1, x.c.cliente, x.m, totalF26)),
              linha(null, `TOTAL GERAL (${itens.length} clientes)`, tot, totalF26)],
        fmts, [5, 36, 14, 14, 10, 9, 11, 11, 11, 13, 13, 9, 13, 14]);
      const ufRows = [];
      itens.slice(0, 20).forEach((x, i) => {
        [...x.c.ufs].map((u) => ({ u, m: metricasUF(u) })).sort((a, b) => b.m.f26 - a.m.f26)
          .forEach((y) => ufRows.push(linha(i + 1, `${x.c.cliente} — ${y.u.uf}`, y.m, x.m.f26)));
      });
      xlTabela(ws, "Abertura por UF (Top 20) — % Repr relativo ao cliente", cab, ufRows, fmts);

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
  }
}

/* ---------------- navegação e eventos ---------------- */
function trocarView(v) {
  document.querySelectorAll(".nav-i[data-v]").forEach((x) => x.classList.toggle("act", x.dataset.v === v));
  document.querySelectorAll(".view").forEach((x) => x.classList.toggle("on", x.id === "v-" + v));
  window.scrollTo({ top: 0 });
  if (v === "fat") renderFat();
  if (v === "vol") renderVol();
}

/* placeholders informativos (conteúdo real vem na expansão do pipeline de dados) */
function emConstrucao(titulo, itens) {
  return `<div style="padding:26px 8px;text-align:center;color:var(--mut)">
    <div style="font-size:34px">🚧</div>
    <div style="font-size:15px;font-weight:700;color:var(--txt);margin:8px 0 6px">${titulo}</div>
    <div style="max-width:560px;margin:0 auto;font-size:13px;line-height:1.7">${itens}</div>
    <div class="note" style="max-width:560px;margin:16px auto 0;text-align:left">Esta visão precisa de
      dados em nível de <b>produto/item</b>, que serão gerados na próxima etapa (servidos sob demanda
      para não pesar o carregamento). Assim que o pipeline for expandido, ela é preenchida automaticamente.</div>
  </div>`;
}
/* ---------------- Faturamento por cliente (drill-down UF, Top 20, ordenável) ---------------- */
const FAT = { cube: null, ordCol: "f26", ordDir: -1, abertos: {} };

async function renderFat() {
  const el = $("fat-conteudo");
  if (!FAT.cube) {
    el.innerHTML = '<div class="empty">Carregando detalhamento…</div>';
    try {
      const res = await fetch("/api/fatcube", { cache: "no-store" });
      if (!res.ok) throw new Error("indisponível");
      FAT.cube = await res.json();
    } catch { el.innerHTML = '<div class="empty">Não foi possível carregar o detalhamento.</div>'; return; }
  }
  desenharFat();
}

/* soma jan..mês-fechado (mês corrente é parcial e não entra nas colunas travadas) */
function somaFechado(arr) {
  const fim = (S.data.periodo.mes_atual - 1) || 1;
  let s = 0; for (let m = 1; m <= fim; m++) s += arr[m - 1] || 0; return s;
}
const somaMeses = (arr, meses) => meses.reduce((s, m) => s + (arr[m - 1] || 0), 0);

function metricasCliente(c) {
  // colunas travadas no YTD-fechado (jan..mês-fechado)
  const f25 = c.ufs.reduce((s, u) => s + somaFechado(u.m25), 0);
  const f26 = c.ufs.reduce((s, u) => s + somaFechado(u.m26), 0);
  const v25 = c.ufs.reduce((s, u) => s + somaFechado(u.q25), 0);
  const v26 = c.ufs.reduce((s, u) => s + somaFechado(u.q26), 0);
  // colunas que seguem o período selecionado
  const meses = mesesSel();
  const realizado = c.ufs.reduce((s, u) => s + somaMeses(u.m26, meses), 0);
  const anoAnt = c.ufs.reduce((s, u) => s + somaMeses(u.m25, meses), 0);
  const meta = somaMeses(c.meta, meses);
  return { f25, f26, cr: f25 > 0 ? (f26 - f25) / f25 : null,
           v25, v26, crv: v25 > 0 ? (v26 - v25) / v25 : null,
           realizado, anoAnt, meta, ating: meta ? realizado / meta : null, gap: meta ? realizado - meta : null };
}
function metricasUF(u) {
  const f25 = somaFechado(u.m25), f26 = somaFechado(u.m26);
  const v25 = somaFechado(u.q25), v26 = somaFechado(u.q26);
  const meses = mesesSel();
  const realizado = somaMeses(u.m26, meses), anoAnt = somaMeses(u.m25, meses);
  const meta = somaMeses(u.meta || [], meses);
  return { f25, f26, cr: f25 > 0 ? (f26 - f25) / f25 : null,
           v25, v26, crv: v25 > 0 ? (v26 - v25) / v25 : null,
           realizado, anoAnt, meta, ating: meta ? realizado / meta : null, gap: meta ? realizado - meta : null };
}

const farol = (x) => x == null ? "" : x >= 0.12 ? "cor-ok" : x >= 0 ? "cor-med" : "cor-bad";

const FAT_COLS = [
  { k: "rkg", t: "#", sort: false },
  { k: "cliente", t: "Cliente", sort: "cliente" },
  { k: "f25", t: "2025", sort: "f25" },
  { k: "f26", t: "2026", sort: "f26" },
  { k: "cr", t: "26 vs 25", sort: "cr" },
  { k: "repr", t: "% Repr", sort: "repr" },
  { k: "v25", t: "Vol 2025", sort: "v25" },
  { k: "v26", t: "Vol 2026", sort: "v26" },
  { k: "crv", t: "26 vs 25 cx", sort: "crv" },
  { k: "meta", t: "Meta", sort: "meta" },
  { k: "realizado", t: "Realizado", sort: "realizado" },
  { k: "ating", t: "% Ating", sort: "ating" },
  { k: "gap", t: "GAP", sort: "gap" },
  { k: "anoAnt", t: "Ano ant.", sort: "anoAnt" },
];

/* soma todas as fatias (vendedores) de uma mesma bandeira, unificando as UFs */
function agregarPorBandeira(linhas) {
  const map = {};
  for (const c of linhas) {
    const g = (map[c.cliente] ??= { cliente: c.cliente, meta: Array(12).fill(0), ufs: {} });
    c.meta.forEach((v, i) => g.meta[i] += v || 0);
    for (const u of c.ufs) {
      const t = (g.ufs[u.uf] ??= { uf: u.uf, m25: Array(12).fill(0), m26: Array(12).fill(0),
                                    q25: Array(12).fill(0), q26: Array(12).fill(0), meta: Array(12).fill(0) });
      for (const k of ["m25", "m26", "q25", "q26", "meta"]) (u[k] || []).forEach((v, i) => t[k][i] += v || 0);
    }
  }
  return Object.values(map).map((g) => ({ cliente: g.cliente, meta: g.meta, ufs: Object.values(g.ufs) }));
}

/* filtra por gerente/vendedor, agrega por bandeira e calcula métricas + TOTAL do escopo */
function calcFat() {
  let linhas = FAT.cube.clientes;
  if (S.fGer) linhas = linhas.filter((c) => c.ger === S.fGer);
  if (S.fVend) linhas = linhas.filter((c) => c.vend === S.fVend);
  linhas = agregarPorBandeira(linhas);
  const itens = linhas.map((c) => ({ c, m: metricasCliente(c) }));
  const totalF26 = itens.reduce((s, x) => s + x.m.f26, 0) || 1;

  // TOTAL GERAL (todos os clientes do escopo, não só o top 20)
  const tot = { f25: 0, f26: 0, v25: 0, v26: 0, realizado: 0, anoAnt: 0, meta: 0 };
  for (const x of itens) for (const k of Object.keys(tot)) tot[k] += x.m[k] || 0;
  tot.cr = tot.f25 > 0 ? (tot.f26 - tot.f25) / tot.f25 : null;
  tot.crv = tot.v25 > 0 ? (tot.v26 - tot.v25) / tot.v25 : null;
  tot.ating = tot.meta ? tot.realizado / tot.meta : null;
  tot.gap = tot.meta ? tot.realizado - tot.meta : null;
  return { itens, tot, totalF26 };
}

function desenharFat() {
  let { itens, tot, totalF26 } = calcFat();
  const nCli = itens.length;

  // ordena e pega Top 20
  const col = FAT.ordCol, dir = FAT.ordDir;
  const val = (x) => col === "cliente" ? x.c.cliente : col === "repr" ? x.m.f26 : (x.m[col] ?? -Infinity);
  itens.sort((a, b) => col === "cliente"
    ? dir * String(val(a)).localeCompare(String(val(b)), "pt-BR")
    : dir * (val(a) - val(b)));
  itens = itens.slice(0, 20);

  const th = FAT_COLS.map((c) => {
    const ativo = c.sort === FAT.ordCol;
    const seta = ativo ? (FAT.ordDir < 0 ? " ▼" : " ▲") : "";
    return `<th class="${["f25", "f26", "cr", "repr", "v25", "v26", "crv", "meta", "realizado", "ating", "gap", "anoAnt"].includes(c.k) ? "r" : ""}${c.sort ? " ord" : ""}${ativo ? " ord-on" : ""}"${c.sort ? ` data-sort="${c.sort}"` : ""}>${c.t}${seta}</th>`;
  }).join("");

  let corpo = "";
  itens.forEach((x, i) => {
    const { c, m } = x;
    const cai = m.f26 < m.f25;                 // caindo vs ano anterior → vermelho
    const aberto = !!FAT.abertos[c.cliente];
    const seta = c.ufs.length > 1 ? (aberto ? "▾" : "▸") : "·";
    corpo += `<tr class="fat-cli${cai ? " fat-cai" : ""}" data-cli="${esc(c.cliente)}">
      <td class="r"><b>${i + 1}</b></td>
      <td><span class="fat-exp">${seta}</span> <b>${esc(c.cliente)}</b></td>
      ${celFat(m, totalF26)}</tr>`;
    if (aberto) {
      const ufs = c.ufs.map((u) => ({ u, m: metricasUF(u) })).sort((a, b) => b.m.f26 - a.m.f26);
      ufs.forEach((y) => {
        corpo += `<tr class="fat-uf"><td></td><td style="padding-left:26px;color:var(--mut)">${esc(y.u.uf)}</td>
          ${celFat(y.m, m.f26 || 1, true)}</tr>`;
      });
    }
  });
  // TOTAL GERAL fecha a tabela (soma do escopo inteiro, não só o top 20)
  if (nCli > 0) corpo += `<tr class="fat-total"><td class="r">Σ</td>
    <td><b>TOTAL GERAL</b> <span style="opacity:.75;font-weight:400">· ${nCli} clientes</span></td>
    ${celFat(tot, totalF26)}</tr>`;

  $("fat-conteudo").innerHTML =
    `<div class="tctl"><span style="color:var(--soft);font-size:11.5px">Top 20 · ${rotuloPer()} · clique num cliente para abrir por UF · clique no cabeçalho para ordenar</span></div>
     <div class="twrap"><table class="fat-tab"><thead><tr>${th}</tr></thead><tbody>${corpo || '<tr><td colspan="14" class="empty">Sem dados.</td></tr>'}</tbody></table></div>`;

  document.querySelectorAll(".fat-tab th.ord").forEach((h) => h.addEventListener("click", () => {
    const s = h.dataset.sort;
    if (FAT.ordCol === s) FAT.ordDir *= -1; else { FAT.ordCol = s; FAT.ordDir = s === "cliente" ? 1 : -1; }
    desenharFat();
  }));
  document.querySelectorAll(".fat-tab tr.fat-cli").forEach((r) => r.addEventListener("click", () => {
    const k = r.dataset.cli;
    FAT.abertos[k] = !FAT.abertos[k];
    desenharFat();
  }));
}

function celFat(m, base, uf) {
  const pct = (x) => x == null ? "—" : (x >= 0 ? "" : "−") + fmtBR(Math.abs(x) * 100, 0) + "%";
  const repr = uf ? m.f26 / (base || 1) : m.f26 / (base || 1);
  const cols = [
    `<td class="r">${fmtV(m.f25)}</td>`,
    `<td class="r"><b>${fmtV(m.f26)}</b></td>`,
    `<td class="r"><span class="farolp ${farol(m.cr)}">${pct(m.cr)}</span></td>`,
    `<td class="r">${fmtBR(repr * 100, 1)}%</td>`,
    `<td class="r">${fmtBR(m.v25, 0)}</td>`,
    `<td class="r">${fmtBR(m.v26, 0)}</td>`,
    `<td class="r"><span class="farolp ${farol(m.crv)}">${pct(m.crv)}</span></td>`,
  ];
  return cols.join("") +
    `<td class="r">${m.meta ? fmtV(m.meta) : "—"}</td>` +
    `<td class="r">${fmtV(m.realizado)}</td>` +
    `<td class="r">${m.ating == null ? "—" : fmtBR(m.ating * 100, 0) + "%"}</td>` +
    `<td class="r" style="color:${m.gap == null ? "var(--soft)" : m.gap >= 0 ? "var(--ok)" : "var(--bad)"}">${m.gap == null ? "—" : (m.gap >= 0 ? "+" : "−") + fmtV(Math.abs(m.gap))}</td>` +
    `<td class="r">${fmtV(m.anoAnt)}</td>`;
}
function renderVol() {
  $("vol-conteudo").innerHTML = emConstrucao("Volume / Mix — visão “batalha naval”",
    "Matriz do macro ao micro: <b>itens nas linhas</b> (agrupados por categoria e ordenados pelo volume total da empresa, " +
    "com a <b>curva ABC</b>) × <b>clientes nas colunas</b> (cliente/estado). Em cada célula: caixas no período, valor e representatividade.");
}

document.addEventListener("DOMContentLoaded", () => {
  $("gate-form").addEventListener("submit", fazerLogin);
  $("lg-forgot").addEventListener("click", () => { $("gate-form").style.display = "none"; $("gate-forgot").style.display = ""; });
  $("fg-voltar").addEventListener("click", () => mostrarLogin());
  $("who-senha").addEventListener("click", trocarSenha);
  document.querySelectorAll(".nav-i[data-v]").forEach((el) => el.addEventListener("click", () => trocarView(el.dataset.v)));
  ["f-ger", "f-vend", "f-ano"].forEach((id) => $(id)?.addEventListener("change", onFiltro));
  $("btn-reset").addEventListener("click", limparFiltros);
  $("who-sair").addEventListener("click", sair);
  document.querySelector(".navgrp-h").addEventListener("click", () => $("grp-vc").classList.toggle("open"));

  // período (multi-seleção)
  $("per-btn").addEventListener("click", (e) => { e.stopPropagation(); togglePerPanel(); });
  $("per-panel").addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("click", () => togglePerPanel(false));
  $("per-meses").addEventListener("change", (e) => {
    const m = e.target.dataset.mes; if (!m) return;
    const n = +m;
    aplicarPeriodo(e.target.checked ? [...S.meses, n] : S.meses.filter((x) => x !== n));
  });
  document.querySelectorAll(".perquick button").forEach((b) =>
    b.addEventListener("click", () => periodoRapido(b.dataset.q)));

  // rodapé: modo de números + atualizar + baixar
  const rotuloNum = () => $("btn-num").textContent =
    S.numModo === "completo" ? "🔢 Nº: Completo" : "🔢 Nº: Detalhado";
  rotuloNum();
  $("btn-num").addEventListener("click", () => {
    S.numModo = S.numModo === "completo" ? "detalhado" : "completo";
    localStorage.setItem("bv_num", S.numModo);
    rotuloNum();
    if (S.data) renderAll();
  });
  $("btn-atualizar").addEventListener("click", () =>
    alert("Atualização automática entra na próxima fase.\nPor enquanto os dados são republicados pelo administrador."));
  $("btn-download").addEventListener("click", (e) => { e.stopPropagation(); $("download-menu").classList.toggle("on"); });
  $("download-menu").addEventListener("click", (e) => {
    const dl = e.target.dataset.dl; if (!dl) return;
    $("download-menu").classList.remove("on");
    ({ pdf: exportPDF, xls: exportExcel, ppt: exportPPT, img: exportImagem }[dl] || (() => {}))();
  });
  document.addEventListener("click", () => $("download-menu").classList.remove("on"));
  $("busca-pos").addEventListener("input", (e) => { S.busca = e.target.value; S.nPos = 100; renderPositivados(linhas()); });
  $("busca-meta").addEventListener("input", (e) => { S.buscaMeta = e.target.value; S.nCli = 50; renderMetas(linhas(), mesesSel()); });
  $("pos-mais").addEventListener("click", () => { S.nPos += 200; renderPositivados(linhas()); });
  $("metas-mais").addEventListener("click", () => { S.nCli += 100; renderMetas(linhas(), mesesSel()); });
  document.querySelectorAll(".fchip[data-st]").forEach((el) => el.addEventListener("click", () => {
    S.fStatus = S.fStatus === el.dataset.st ? "" : el.dataset.st;
    document.querySelectorAll(".fchip[data-st]").forEach((x) => x.classList.toggle("on", x.dataset.st === S.fStatus));
    S.nPos = 100; renderPositivados(linhas());
  }));

  init();
});
