/* Book de Vendas BR Spices — app v2 (schema 2: séries mensais por CLIENTE-BANDEIRA)
   Login: senha → SHA-256 → data/<hash>.enc.json → PBKDF2 + AES-GCM (WebCrypto). */
"use strict";

const S = { data: null, fGer: "", fVend: "", fCanal: "", fCat: "", fEstr: "", ano: 2026, meses: [],
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
const fmtDataCurta = (iso) => iso ? fmtData(iso).replace(/\/20(\d\d)$/, "/$1") : "—";
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
/* último mês FECHADO do ano corrente (o mês em andamento é parcial) */
const mesFechado = () => (S.data.periodo.mes_atual - 1) || 1;

function rotuloPer() {
  const m = mesesSel(), mF = mesFechado();
  const eq = (arr) => arr.length === m.length && arr.every((x, i) => x === m[i]);
  if (!m.length) return "Selecione…";
  if (eq(seq(1, mF)) && S.ano === S.data.periodo.ano) return `YTD (jan–${MESES[mF - 1]})`;
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

  // período: YTD (até o mês fechado) por padrão + meses com checkbox
  S.meses = seq(1, (d.periodo.mes_atual - 1) || 1);
  $("per-meses").innerHTML = MESES.map((m, i) =>
    `<label class="permes"><input type="checkbox" data-mes="${i + 1}"><span>${m}</span></label>`).join("");
  atualizarPerBtns();
  $("f-ano").innerHTML = `<option>2026</option><option>2025</option><option>2024</option>`;

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
  const mF = mesFechado();
  const mapa = { mes: [mF], ytd: seq(1, mF), ano: seq(1, 12), h1: seq(1, 6), h2: seq(7, 12),
                 q1: seq(1, 3), q2: seq(4, 6), q3: seq(7, 9), q4: seq(10, 12), limpar: [] };
  aplicarPeriodo(mapa[q] || seq(1, mF));
}
function filtrarEstr(e) {
  S.fEstr = S.fEstr === e ? "" : e;
  document.querySelectorAll("#estr-btns button").forEach((b) =>
    b.classList.toggle("on", b.dataset.e === S.fEstr));
  S.nPos = 100; S.nCli = 50;
  renderAll();
}

function limparFiltros() {
  S.fGer = ""; S.fVend = ""; S.fCanal = ""; S.fCat = ""; S.fEstr = "";  // zera o ESTADO, não só a tela
  document.querySelectorAll("#estr-btns button").forEach((b) => b.classList.remove("on"));
  if ($("f-ger")) $("f-ger").value = "";
  if ($("f-vend")) $("f-vend").value = "";
  $("f-ano").value = "2026";
  S.fStatus = ""; S.busca = ""; S.buscaMeta = ""; FAT.busca = "";
  for (const id of ["busca-pos", "busca-meta", "busca-fat"]) if ($(id)) $(id).value = "";
  document.querySelectorAll(".fchip[data-st]").forEach((x) => x.classList.remove("on"));
  S.ano = 2026;
  S.meses = seq(1, mesFechado());
  atualizarVendSelect(); atualizarPerBtns();
  S.nPos = 100; S.nCli = 50;
  renderAll();
}

function linhas() {
  let r = S.data.clientes;
  if (S.fEstr) r = r.filter((p) => (p.estr || "") === S.fEstr);
  if (S.fGer) r = r.filter((p) => p.ger === S.fGer);
  if (S.fVend) r = r.filter((p) => p.vend === S.fVend);
  if (S.fCanal) r = r.filter((p) => (p.canal || "SEM CANAL") === S.fCanal);
  return r;
}
const filtrado = () => !!(S.fGer || S.fVend || S.fCanal || S.fCat || S.fEstr);

/* cliente ativo = comprou em algum dos últimos 6 meses FECHADOS */
function ativo6(p) {
  const { ano, mes_atual } = S.data.periodo;
  const base = ano * 12 + (mes_atual - 1);
  for (let k = 6; k >= 1; k--) {
    const idx = base - k, y = Math.floor(idx / 12), m = (idx % 12) + 1;
    const a = serie(p, y);
    if (a && (a[m - 1] || 0) > 0) return true;
  }
  return false;
}

/* pseudo-linhas a partir do cubo MIX quando há filtro de CATEGORIA
   (o cubo principal não abre por categoria; meta/recência não existem nesse recorte) */
const Z12 = () => Array(12).fill(0);
function canalLookup() {
  if (S._canalMap) return S._canalMap;
  const m = {};
  for (const p of S.data.clientes) m[p.cliente + "|" + p.vend] = p.canal || "SEM CANAL";
  return (S._canalMap = m);
}
function linhasMix() {
  const cm = canalLookup();
  let r = MIX.cube.cats.filter((c) => c.cat === S.fCat);
  if (S.fEstr) { const em = estrLookup(); r = r.filter((c) => (em[c.cliente + "|" + c.vend] || "") === S.fEstr); }
  if (S.fGer) r = r.filter((c) => c.ger === S.fGer);
  if (S.fVend) r = r.filter((c) => c.vend === S.fVend);
  if (S.fCanal) r = r.filter((c) => (cm[c.cliente + "|" + c.vend] || "SEM CANAL") === S.fCanal);
  return r.map((c) => ({ cliente: c.cliente, vend: c.vend, ger: c.ger,
    canal: cm[c.cliente + "|" + c.vend] || "SEM CANAL",
    m24: Z12(), m25: c.m25, m26: c.m26, q26: c.q26, meta: Z12(),
    status: "", ult: null, perdido: 0, media: 0, meses_sem: 99 }));
}

/* ---------------- render ---------------- */
function renderAll() {
  const rows = linhas(), meses = mesesSel();
  renderChips();
  // com filtro de CATEGORIA os números vêm do cubo MIX (pseudo-linhas)
  const rowsK = (S.fCat && MIX.cube) ? linhasMix() : rows;
  renderKpis(rowsK, meses);
  renderEvolucao(rowsK);
  renderDashRank();
  renderSemaforo(rows);
  renderFamilias();
  renderParados(rows);
  renderAnalitica();
  renderMetas(rows, meses);
  renderPositivados(rows);
  if (FAT.cube && $("v-fat").classList.contains("on")) desenharFat();
}

/* cross-filter: clicar filtra a página toda; clicar de novo desfaz */
function filtrarGer(g) {
  S.fGer = S.fGer === g ? "" : g;
  if ($("f-ger")) $("f-ger").value = S.fGer;
  atualizarVendSelect();
  S.nPos = 100; S.nCli = 50;
  renderAll();
}
function filtrarVend(v) {
  S.fVend = S.fVend === v ? "" : v;
  atualizarVendSelect();
  S.nPos = 100; S.nCli = 50;
  renderAll();
}
function filtrarCanal(c) {
  S.fCanal = S.fCanal === c ? "" : c;
  S.nPos = 100; S.nCli = 50;
  renderAll();
}
function filtrarCat(c) {
  S.fCat = S.fCat === c ? "" : c;
  S.nPos = 100; S.nCli = 50;
  renderAll();
}

function renderChips() {
  $("per-btn").textContent = rotuloPer();
  const f = [S.ano + " · " + rotuloPer()];
  if (S.fEstr) f.push("Estrutura: " + S.fEstr);
  if (S.fGer) f.push("Gerente: " + S.fGer);
  if (S.fVend) f.push("Vendedor: " + nomeVend(S.fVend));
  if (S.fCanal) f.push("Canal: " + S.fCanal);
  if (S.fCat) f.push("Categoria: " + rotuloCat(S.fCat));
  $("chip-filtro").textContent = "Filtrando: " + f.join(" · ");
}
/* categoria sem o prefixo numérico ("07. QUERO | FOOD" → "QUERO | FOOD") */
const rotuloCat = (c) => String(c || "").replace(/^\s*\d+\.\s*/, "");

function kpiCard(icone, cor, titulo, valor, detalhe, nav) {
  const cls = nav ? ' klick" data-nav="' + nav : "";
  return `<div class="kpi${cls}"><div class="hd"><div class="ic">${icone}</div>
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
    : rows.filter((p) => { const a = serie(p, S.ano); return a && meses.some((m) => (a[m - 1] || 0) > 0); }).length;
  const base = rows.filter(ativo6).length;   // ativos = compra nos últimos 6 meses fechados
  const vol = S.ano === 2026 ? rows.reduce((s, p) => s + meses.reduce((t, m) => t + (p.q26[m - 1] || 0), 0), 0) : null;
  const ativosPer = rows.filter((p) => { const a = serie(p, S.ano); return a && meses.some((m) => a[m - 1]); }).length;
  const ticket = ativosPer ? fat / ativosPer : null;

  const crescPill = cresc == null ? "" :
    `<span class="dl ${cresc >= 0 ? "up" : "dn"}">${cresc >= 0 ? "▲" : "▼"} ${fmtPct(Math.abs(cresc))}</span> `;
  const atingCor = ating == null ? "var(--soft)" : ating >= 1 ? "var(--ok)" : ating >= 0.9 ? "var(--warn)" : "var(--bad)";
  const escT = '<span style="color:var(--soft)">escopo total (sem filtro)</span>';

  $("kpis").innerHTML =
    kpiCard(IC.meta, "#E0A339", "Meta", meta ? fmtM(meta) : "—",
      meta ? `<b style="color:${atingCor}">${fmtPct(ating)}</b> atingido · ${gap >= 0 ? "sobra" : "falta"} <b style="color:${gap >= 0 ? "var(--ok)" : "var(--bad)"}">${fmtM(Math.abs(gap))}</b>`
           : "sem meta no período/seleção", "metas") +
    kpiCard(IC.fat, "#2f7d7c", "Faturamento", fmtM(fat),
      crescPill + `vs ${S.ano - 1} mesmo período (${fmtM(ly)})`, "fat") +
    kpiCard(IC.cart, "#4f9aa0", "Pedidos<br>em carteira", filtrado() ? "—" : fmtM(k.carteira),
      filtrado() ? escT : `Qtde de pedidos: <b>${fmtBR(k.carteira_pedidos || 0)}</b>`) +
    kpiCard(IC.pos, "#8AAB83", "Clientes<br>positivados",
      S.fCat ? "—" : `${fmtBR(positivados)}<small>/${fmtBR(base)}</small>`,
      S.fCat ? '<span style="color:var(--soft)">sem recorte por categoria</span>'
             : (base ? `<b style="color:var(--teal-d)">${fmtPct(positivados / base)}</b> da base ativa (6 m)` : ""), "posit") +
    kpiCard(IC.dev, "#C96643", `Devolução<br>${d.periodo.ano} YTD`, filtrado() ? "—" : fmtM(k.devolucao),
      filtrado() ? escT : "já abatida do líquido") +
    kpiCard(IC.vol, "#9B9741", "Volume<br>(caixas)", vol == null ? "—" : fmtNum(vol),
      ticket ? `Ticket médio <b>${fmtM(ticket)}</b>` : "Ticket médio —", "vol");

  document.querySelectorAll("#kpis .kpi.klick").forEach((el) =>
    el.addEventListener("click", () => trocarView(el.dataset.nav)));
}

/* ---------- evolução: sempre os últimos 12 meses ---------- */
function renderEvolucao(rows) {
  const { ano, mes_atual } = S.data.periodo;
  const me = S.data.meta_empresa_mensal;
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
    const meta = y === 2026 ? ((me && !filtrado()) ? me[m - 1] || 0
                                                   : rows.reduce((s, c) => s + (c.meta[m - 1] || 0), 0)) : 0;
    itens.push({ label: `${MESES[m - 1]}/${String(y).slice(2)}`, fat, ly, meta,
                 parcial: y === ano && m === mes_atual });
  }
  $("evo-titulo").innerHTML = `Últimos 12 meses — Realizado × Ano anterior × Meta <span class="rg">R$</span>`;
  $("evo-chart").innerHTML = svgEvolucao(itens);
  $("evo-leg").innerHTML =
    `<span><i style="background:linear-gradient(180deg,#74AFAE,#2f7d7c)"></i>Realizado</span>` +
    `<span><i style="background:#dde3e5"></i>Mesmo mês do ano anterior</span>` +
    `<span><i style="background:#14325c;height:3px;border-radius:2px"></i>Meta 2026</span>` +
    `<span><i style="background:#2e9e63"></i>▲▼ crescimento vs ano anterior</span>` +
    `<span style="margin-left:auto">${MESES[mes_atual - 1]}/${String(ano).slice(2)} = parcial</span>`;
}

function svgEvolucao(itens) {
  const W = 1140, H = 268, base = 224, topo = 52;
  const n = itens.length, passo = W / n;
  const max = Math.max(1, ...itens.map((i) => Math.max(i.fat, i.ly, i.meta || 0)));
  const y = (v) => base - (v / max) * (base - topo);
  const wB = Math.min(34, passo * 0.42);          // barras grossas
  let s = `<svg viewBox="0 0 ${W} ${H}" style="width:100%">`;
  s += '<g stroke="#eef1f2" stroke-width="1">';
  for (let i = 1; i <= 4; i++) s += `<line x1="0" y1="${topo + (base - topo) * i / 4}" x2="${W}" y2="${topo + (base - topo) * i / 4}"/>`;
  s += "</g>";
  s += '<g font-size="11" fill="#8a979d" text-anchor="middle">';
  itens.forEach((it, i) => { s += `<text x="${passo * i + passo / 2}" y="${H - 6}">${esc(it.label)}</text>`; });
  s += "</g>";
  s += '<defs><linearGradient id="gt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#74AFAE"/><stop offset="1" stop-color="#2f7d7c"/></linearGradient></defs>';
  itens.forEach((it, i) => {
    const cx = passo * i + passo / 2, dl = `animation-delay:${i * 40}ms`;
    if (it.ly > 0)
      s += `<rect x="${cx - wB - 2}" y="${y(it.ly)}" width="${wB}" height="${base - y(it.ly)}" rx="4" fill="#dde3e5" style="${dl}"><title>${esc(it.label)} ano anterior: ${fmtM(it.ly)}</title></rect>`;
    if (it.fat > 0)
      s += `<rect x="${cx + 2}" y="${y(it.fat)}" width="${wB}" height="${base - y(it.fat)}" rx="4" fill="url(#gt)" style="${dl}"><title>${esc(it.label)}: ${fmtM(it.fat)}</title></rect>`;
    /* rótulos empilhados acima do par de barras */
    const yTop = y(Math.max(it.fat, it.ly));
    if (it.ly > 0)
      s += `<text x="${cx}" y="${yTop - 4}" font-size="10.5" fill="#8a979d" text-anchor="middle">${fmtNum(it.ly)}</text>`;
    if (it.fat > 0)
      s += `<text x="${cx}" y="${yTop - 17}" font-size="12" font-weight="700" fill="#182226" text-anchor="middle">${fmtNum(it.fat)}${it.parcial ? "*" : ""}</text>`;
    if (it.fat > 0 && it.ly > 0 && !it.parcial) {  /* mês parcial não compara */
      const g = (it.fat - it.ly) / it.ly;
      const cor = g >= 0 ? "#2e9e63" : "#cc4b41";
      s += `<text x="${cx}" y="${yTop - 31}" font-size="11" font-weight="700" fill="${cor}" text-anchor="middle">${g >= 0 ? "▲" : "▼"} ${fmtBR(Math.abs(g) * 100, 0)}%</text>`;
    }
  });
  /* linha de META: curva suave, azul-marinho, valores ABAIXO da linha */
  const NAVY = "#14325c";
  const pts = [];
  itens.forEach((it, i) => { if (it.meta) pts.push({ x: passo * i + passo / 2, y: y(it.meta), it }); });
  if (pts.length) {
    let path = `M${pts[0].x},${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], mx = (a.x + b.x) / 2;
      path += ` C${mx},${a.y} ${mx},${b.y} ${b.x},${b.y}`;
    }
    let extras = "";
    pts.forEach((p) => {
      extras += `<circle cx="${p.x}" cy="${p.y}" r="3.5" fill="${NAVY}"><title>${esc(p.it.label)} meta: ${fmtM(p.it.meta)}</title></circle>` +
        `<text x="${p.x}" y="${p.y + 15}" font-size="9.5" font-weight="700" fill="${NAVY}" text-anchor="middle">${fmtNum(p.it.meta)}</text>`;
    });
    s += `<g class="lm"><path d="${path}" fill="none" stroke="${NAVY}" stroke-width="2.5" opacity=".9"/>${extras}</g>`;
  }
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
  $("familias-mini").innerHTML = (S.data.familias || []).slice(0, 8).map((f, i) =>
    `<li><span class="n">${i + 1}</span><span class="nm">${esc(f.nome)}</span><span class="vl">${fmtM(f.fat)}</span></li>`).join("");
}

/* ---------- Parados (Acionar agora / Validar) — mesma régua do semáforo ---------- */
function renderParados(rows) {
  const bloco = (elTab, elTot, st) => {
    const r = rows.filter((p) => p.status === st && p.meses_sem < 99 && (p.media || 0) > 0)
                  .sort((a, b) => (b.perdido || 0) - (a.perdido || 0)).slice(0, 12);
    const tot = r.reduce((s, p) => s + (p.perdido || 0), 0);
    $(elTab).innerHTML = r.length ? `<table class="fat-tab"><thead><tr>
        <th>CLIENTE</th><th>Canal</th><th>Vendedor</th><th>Últ. Compra</th>
        <th class="r">R$/mês</th><th class="r">Total perdido</th></tr></thead><tbody>` +
      r.map((p) => `<tr><td><b>${esc(p.cliente)}</b></td>
        <td style="color:var(--mut);font-size:10.5px">${esc(p.canal || "")}</td>
        <td style="color:var(--mut);font-size:10.5px">${esc(nomeVend(p.vend))}</td>
        <td>${fmtDataCurta(p.ult)}</td>
        <td class="r" style="color:var(--bad);font-weight:700">${fmtV(p.media)}</td>
        <td class="r"><b>${fmtV(p.perdido)}</b></td></tr>`).join("") + "</tbody></table>"
      : '<div class="empty">Nenhum cliente nesta faixa. 🎉</div>';
    $(elTot).textContent = tot > 0 ? `${fmtM(tot)} em risco` : "";
  };
  bloco("dash-acionar", "acionar-tot", "acionar");
  bloco("dash-validar", "validar-tot", "validar");
}

/* ---------- Oportunidades nas contas-chave (whitespace, calculado no ETL) ---------- */
function renderAnalitica() {
  const card = $("card-analitica");
  if (!card) return;
  const a = S.data.analitica;
  if (!a || !(a.whitespace || []).length) { card.style.display = "none"; return; }
  card.style.display = "";
  // com uma CATEGORIA selecionada, mostra as oportunidades DAQUELA categoria (lista completa)
  const porCat = S.fCat ? (a.whitespace_full || a.whitespace).filter((w) => w.cat === S.fCat) : null;
  const lista = porCat ? porCat.slice(0, 10) : a.whitespace.slice(0, 10);
  $("analitica-janela").textContent = porCat
    ? `categoria ${rotuloCat(S.fCat)} · top 30 clientes · ${a.janela}`
    : `top 30 clientes · ${a.janela} · potencial bruto ${fmtM(a.pot_total)}`;
  const corpo = lista.map((w, i) =>
    `<tr><td class="r"><b>${i + 1}</b></td><td><b>${esc(w.fam)}</b></td>
     <td style="color:var(--mut);font-size:10.5px">${esc(rotuloCat(w.cat))}</td>
     <td class="r">${w.compradores}</td><td class="r">${w.contas_sem}</td>
     <td class="r">${fmtV(w.giro)}</td>
     <td class="r"><b style="color:var(--ok)">${fmtV(w.potencial)}</b></td>
     <td style="font-size:10.5px;color:var(--mut)">${w.alvo.map(esc).join(" · ")}</td></tr>`).join("");
  $("dash-ws").innerHTML =
    `<div class="twrap"><table class="fat-tab"><thead><tr>
      <th class="r">#</th><th>FAMÍLIA</th><th>Categoria</th>
      <th class="r">Compram</th><th class="r">Contas s/</th><th class="r">Giro/conta</th>
      <th class="r">Potencial</th><th>Contas-alvo (não compram a família)</th></tr></thead><tbody>` +
    (corpo || `<tr><td colspan="8" class="empty">Sem lacunas relevantes nesta categoria — todas as contas-chave já compram. 🎉</td></tr>`) +
    `</tbody></table></div>
     <div class="note">🎯 <b>Contas-alvo</b> (mais famílias campeãs em aberto):
       ${a.contas_alvo.map((c) => `<b>${esc(c.cliente)}</b> (${c.abertas})`).join(" · ")}.<br>
       ${esc(a.criterio)}. Whitespace real: a conta não comprou <b>nenhuma gramatura</b> da família na janela.
       Análise do top 30 do escopo total — segue apenas o filtro de categoria.</div>`;
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
      // ano anterior: mês corrente (parcial) entra pro-rata p/ comparação justa
      const b = serie(p, S.ano - 1);
      if (b) o.ly += (b[m - 1] || 0) * ((S.ano === S.data.periodo.ano && m === S.data.periodo.mes_atual) ? S.fracMes : 1);
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

/* ---------- Rankings ricos dentro do Dashboard ---------- */
function liRank(i, nome, sub, valor) {
  return `<li><span class="n">${i + 1}</span><span class="nm">${esc(nome)}${sub ? `<span class="sb">${esc(sub)}</span>` : ""}</span><span class="vl">${valor}</span></li>`;
}

const DASH = { cli: { col: "f26", dir: -1 }, ger: { col: "f26", dir: -1 }, vend: { col: "f26", dir: -1 },
               canal: { col: "f26", dir: -1 }, cat: { col: "f26", dir: -1 }, prod: { col: "f26", dir: -1 },
               reg: { col: "f26", dir: -1 }, uf: { col: "f26", dir: -1 } };
const MIX = { cube: null, carregando: false };

function metDash(f25, f26, meta) {
  return { f25, f26, cr: f25 > 0 ? (f26 - f25) / f25 : (f26 > 0 ? 1 : null),
           meta, ating: meta ? f26 / meta : null, gap: meta ? f26 - meta : null };
}
/* agrega os clientes-bandeira (soma as fatias por vendedor) no período selecionado */
function dashClientes(rows, meses) {
  const { ano, mes_atual } = S.data.periodo;
  const map = {};
  for (const p of rows) {
    const g = (map[p.cliente] ??= { nome: p.cliente, f25: 0, f26: 0, meta: 0, ult: null });
    const a = serie(p, S.ano), b = serie(p, S.ano - 1);
    for (const m of meses) {
      if (a) g.f26 += a[m - 1] || 0;
      if (b) g.f25 += (b[m - 1] || 0) * ((S.ano === ano && m === mes_atual) ? S.fracMes : 1);
      if (S.ano === 2026) g.meta += p.meta[m - 1] || 0;
    }
    if (p.ult && (!g.ult || p.ult > g.ult)) g.ult = p.ult;
  }
  return Object.values(map).map((g) => ({ ...g, ...metDash(g.f25, g.f26, g.meta) }));
}

/* colunas comuns (estilo Faturamento) p/ as tabelas do Dashboard */
function colsDash(rotuloNome, totalF26) {
  const pct0 = (x) => x == null ? "—" : (x >= 0 ? "" : "−") + fmtBR(Math.abs(x) * 100, 0) + "%";
  return [
    { k: "nome", t: rotuloNome, v: (x) => x.nome, f: (x) => `<b>${esc(nomeVend(x.nome))}</b>` },
    { k: "f25", t: String(S.ano - 1), r: 1, v: (x) => x.f25, f: (x) => fmtV(x.f25) },
    { k: "f26", t: String(S.ano), r: 1, v: (x) => x.f26, f: (x) => `<b>${fmtV(x.f26)}</b>` },
    { k: "cr", t: `${S.ano % 100} Vs ${(S.ano - 1) % 100}`, r: 1, v: (x) => x.cr,
      f: (x) => `<span class="farolp ${farol(x.cr)}">${pct0(x.cr)}</span>` },
    { k: "repr", t: "% Repres.", r: 1, v: (x) => x.f26, f: (x) => fmtBR(x.f26 / (totalF26 || 1) * 100, 1) + "%" },
    { k: "meta", t: "Meta", r: 1, v: (x) => x.meta, f: (x) => x.meta ? fmtV(x.meta) : "—" },
    { k: "ating", t: "% Ating.", r: 1, v: (x) => x.ating, f: (x) => x.ating == null ? "—" : fmtBR(x.ating * 100, 0) + "%" },
    { k: "gap", t: "GAP", r: 1, v: (x) => x.gap,
      f: (x) => x.gap == null ? "—" : `<span style="color:${x.gap >= 0 ? "var(--ok)" : "var(--bad)"}">${(x.gap >= 0 ? "+" : "−") + fmtV(Math.abs(x.gap))}</span>` },
  ];
}

function tabelaDash(el, key, cols, itens, topN, onRow, ativo) {
  const st = DASH[key];
  const cdef = cols.find((c) => c.k === st.col) || cols[1];
  itens.sort((a, b) => st.col === "nome"
    ? st.dir * String(cdef.v(a)).localeCompare(String(cdef.v(b)), "pt-BR")
    : st.dir * ((cdef.v(a) ?? -Infinity) - (cdef.v(b) ?? -Infinity)));
  const top = itens.slice(0, topN);
  const th = `<th class="r">#</th>` + cols.map((c) =>
    `<th class="${c.r ? "r " : ""}ord${st.col === c.k ? " ord-on" : ""}" data-k="${c.k}">${c.t}${st.col === c.k ? (st.dir < 0 ? " ▼" : " ▲") : ""}</th>`).join("");
  const corpo = top.map((x, i) =>
    `<tr class="dlin${ativo && x.nome === ativo ? " on" : ""}" data-n="${esc(x.nome)}"><td class="r"><b>${i + 1}</b></td>` +
    cols.map((c) => `<td class="${c.r ? "r" : ""}">${c.f(x)}</td>`).join("") + "</tr>").join("");
  $(el).innerHTML = `<table class="fat-tab dash-tab"><thead><tr>${th}</tr></thead><tbody>${corpo ||
    `<tr><td colspan="${cols.length + 1}" class="empty">Sem dados na seleção.</td></tr>`}</tbody></table>`;
  $(el).querySelectorAll("th.ord").forEach((h) => h.addEventListener("click", () => {
    const k = h.dataset.k;
    if (st.col === k) st.dir *= -1; else { st.col = k; st.dir = k === "nome" ? 1 : -1; }
    renderDashRank();
  }));
  if (onRow) $(el).querySelectorAll("tr.dlin").forEach((r) =>
    r.addEventListener("click", () => onRow(r.dataset.n)));
}

function renderDashRank() {
  const rows = linhas(), meses = mesesSel(), d = S.data;

  // Top 20 clientes → clique abre o Faturamento com o cliente buscado
  const cli = dashClientes(rows, meses);
  const totCli = cli.reduce((s, x) => s + x.f26, 0);
  const colUlt = { k: "ult", t: "Últ. Compra", v: (x) => x.ult ? Date.parse(x.ult) : -Infinity,
    f: (x) => { const dd = diasSemCompra(x.ult);
      return `<span${dd != null && dd > 60 ? ' style="color:var(--bad);font-weight:700"' : ""}>${fmtDataCurta(x.ult)}</span>`; } };
  tabelaDash("dash-cli", "cli", [...colsDash("CLIENTE", totCli), colUlt], cli, 20, (n) => {
    trocarView("fat");
    if ($("busca-fat")) { $("busca-fat").value = n; FAT.busca = n; if (FAT.cube) desenharFat(); }
  });

  // Gerentes (visão do gestor) → clique filtra a página
  const extra = [
    { k: "cli", t: "Clientes", r: 1, v: (x) => x.clientes, f: (x) => fmtBR(x.clientes) },
    { k: "pos", t: "Posit. mês", r: 1, v: (x) => x.positivados, f: (x) => fmtBR(x.positivados) },
  ];
  const mapear = (o) => ({ nome: o.nome, clientes: o.clientes, positivados: o.positivados,
                           ...metDash(o.ly, o.realizado, o.meta) });
  if (d.escopo.perfil === "gestor") {
    const ger = agrupar(rows, "ger", meses).map(mapear);
    const totG = ger.reduce((s, x) => s + x.f26, 0);
    tabelaDash("dash-ger", "ger", [...colsDash("GERENTE", totG), ...extra], ger, 100, filtrarGer, S.fGer);
    $("card-dash-ger").style.display = "";
  } else $("card-dash-ger").style.display = "none";

  // Top 20 vendedores → clique filtra a página
  if (d.escopo.perfil !== "vendedor") {
    const vend = agrupar(rows, "vend", meses).map(mapear);
    const totV = vend.reduce((s, x) => s + x.f26, 0);
    tabelaDash("dash-vend", "vend", [...colsDash("VENDEDOR", totV), ...extra], vend, 20, filtrarVend, S.fVend);
    $("card-dash-vend").style.display = "";
  } else $("card-dash-vend").style.display = "none";

  // Canais → clique filtra a página (usa o recorte atual, incl. categoria)
  const rowsC = (S.fCat && MIX.cube) ? linhasMix() : rows;
  const can = agrupar(rowsC, "canal", meses).map(mapear);
  const totC = can.reduce((s, x) => s + x.f26, 0);
  tabelaDash("dash-canal", "canal", [...colsDash("CANAL", totC), ...extra], can, 15, filtrarCanal, S.fCanal);

  // base ativa (compra nos últimos 6 meses fechados) no recorte atual — denominador dos faróis
  const ativosN = rows.filter(ativo6).length || 1;
  const dotBase = (x) => {
    const p = x.ncli / ativosN;
    const cls = p >= 0.6 ? "ok" : p >= 0.3 ? "med" : "bad";
    return `<span class="dotf ${cls}"></span>${fmtBR(Math.min(1, p) * 100, 0)}%`;
  };
  const colsVolBase = (totV26) => [
    { k: "v25", t: "Vol 2025", r: 1, v: (x) => x.v25, f: (x) => fmtBR(x.v25, 0) },
    { k: "v26", t: "Vol 2026", r: 1, v: (x) => x.v26, f: (x) => `<b>${fmtBR(x.v26, 0)}</b>` },
    { k: "crv", t: "Cresc. cx", r: 1, v: (x) => x.crv,
      f: (x) => `<span class="farolp ${farol(x.crv)}">${x.crv == null ? "—" : (x.crv >= 0 ? "" : "−") + fmtBR(Math.abs(x.crv) * 100, 0) + "%"}</span>` },
    { k: "reprv", t: "% Repr. cx", r: 1, v: (x) => x.v26, f: (x) => fmtBR(x.v26 / (totV26 || 1) * 100, 1) + "%" },
    { k: "ncli", t: "Base compr.", r: 1, v: (x) => x.ncli, f: (x) => fmtBR(x.ncli) },
    { k: "pbase", t: "% da base", r: 1, v: (x) => x.ncli, f: dotBase },
  ];

  // Categorias e Produtos (cubo MIX, lazy) → clique na categoria filtra a página
  if (!MIX.cube) { carregarMix(); } else {
    const cats = dashCategorias(meses);
    const totCat = cats.reduce((s, x) => s + x.f26, 0);
    const totVCat = cats.reduce((s, x) => s + x.v26, 0);
    const colsCat = colsDash("FAMÍLIA", totCat).filter((c) => !["meta", "ating", "gap"].includes(c.k));
    colsCat[0].f = (x) => `<b>${esc(rotuloCat(x.nome))}</b>`;
    tabelaDash("dash-cat", "cat", [...colsCat, ...colsVolBase(totVCat)], cats, 30, filtrarCat, S.fCat);

    const prods = dashProdutos(meses);
    const totP = prods.reduce((s, x) => s + x.f26, 0);
    const totVP = prods.reduce((s, x) => s + x.v26, 0);
    const colsProd = colsDash("PRODUTO", totP).filter((c) => !["meta", "ating", "gap"].includes(c.k));
    colsProd.splice(1, 0,
      { k: "cat", t: "Família", v: (x) => rotuloCat(x.cat),
        f: (x) => `<span style="color:var(--mut);font-size:10.5px">${esc(rotuloCat(x.cat))}</span>` },
      { k: "curva", t: "ABC", v: (x) => x.curva || "—",
        f: (x) => x.curva ? `<span class="curva c-${esc(x.curva)}">${esc(x.curva)}</span>` : "—" });
    tabelaDash("dash-prod", "prod", [...colsProd, ...colsVolBase(totVP)], prods, 30, null);
  }

  // Regiões do Brasil (clique filtra os estados) e Estados por nome
  if (!FAT.cube) { carregarFatCube(); } else {
    const colCli = { k: "cli", t: "Clientes", r: 1, v: (x) => x.clientes, f: (x) => fmtBR(x.clientes) };
    const regs = dashRegioes(meses, true);
    const totR = regs.reduce((s, x) => s + x.f26, 0);
    tabelaDash("dash-reg", "reg", [...colsDash("REGIÃO", totR), colCli], regs, 10,
      (n) => { DASH.regSel = DASH.regSel === n ? "" : n; renderDashRank(); }, DASH.regSel);
    let ufs = dashRegioes(meses, false);
    if (DASH.regSel) ufs = ufs.filter((u) => (REGIAO_UF[u.nome] || "—") === DASH.regSel);
    $("uf-info").textContent = DASH.regSel ? `região: ${DASH.regSel} (clique na região de novo para ver todos)` : "";
    const totU = ufs.reduce((s, x) => s + x.f26, 0);
    const colsUF = colsDash("ESTADO", totU);
    colsUF[0].f = (x) => `<b>${esc(UF_NOME[x.nome] || x.nome)}</b> <span style="color:var(--soft);font-size:10px">${esc(x.nome)}</span>`;
    tabelaDash("dash-uf", "uf", [...colsUF, colCli], ufs, 30, null);
  }
}

const UF_NOME = { AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas", BA: "Bahia", CE: "Ceará",
  DF: "Distrito Federal", ES: "Espírito Santo", GO: "Goiás", MA: "Maranhão", MT: "Mato Grosso",
  MS: "Mato Grosso do Sul", MG: "Minas Gerais", PA: "Pará", PB: "Paraíba", PR: "Paraná",
  PE: "Pernambuco", PI: "Piauí", RJ: "Rio de Janeiro", RN: "Rio Grande do Norte",
  RS: "Rio Grande do Sul", RO: "Rondônia", RR: "Roraima", SC: "Santa Catarina", SE: "Sergipe",
  SP: "São Paulo", TO: "Tocantins" };

/* carregamentos lazy dos cubos (uma vez; re-renderiza ao chegar) */
function carregarMix() {
  if (MIX.carregando) return;
  MIX.carregando = true;
  $("dash-cat").innerHTML = '<div class="empty">Carregando categorias…</div>';
  fetch("/api/mixcube", { cache: "no-store" }).then((r) => r.ok ? r.json() : null)
    .then((j) => { MIX.cube = j; if (j) renderAll(); })
    .catch(() => { $("dash-cat").innerHTML = '<div class="empty">Indisponível.</div>'; });
}
function carregarFatCube() {
  if (FAT.carregando) return;
  FAT.carregando = true;
  fetch("/api/fatcube", { cache: "no-store" }).then((r) => r.ok ? r.json() : null)
    .then((j) => { FAT.cube = j; if (j) renderDashRank(); })
    .catch(() => {});
}

function estrLookup() {
  if (S._estrMap) return S._estrMap;
  const m = {};
  for (const p of S.data.clientes) m[p.cliente + "|" + p.vend] = p.estr || "";
  return (S._estrMap = m);
}
/* comprou a categoria/linha em algum dos últimos 6 meses fechados? (m26/m25 do MIX) */
function comprou6(e) {
  const { ano, mes_atual } = S.data.periodo;
  const base = ano * 12 + (mes_atual - 1);
  for (let k = 6; k >= 1; k--) {
    const idx = base - k, y = Math.floor(idx / 12), m = (idx % 12) + 1;
    const a = y === 2026 ? e.m26 : y === 2025 ? e.m25 : null;
    if (a && (a[m - 1] || 0) > 0) return true;
  }
  return false;
}
const volDash = (g) => ({ ...g, crv: g.v25 > 0 ? (g.v26 - g.v25) / g.v25 : (g.v26 > 0 ? 1 : null) });

/* Categorias: agrega o cubo MIX respeitando estrutura/gerente/vendedor/canal */
function dashCategorias(meses) {
  const cm = canalLookup(), em = estrLookup();
  let r = MIX.cube.cats;
  if (S.fEstr) r = r.filter((c) => (em[c.cliente + "|" + c.vend] || "") === S.fEstr);
  if (S.fGer) r = r.filter((c) => c.ger === S.fGer);
  if (S.fVend) r = r.filter((c) => c.vend === S.fVend);
  if (S.fCanal) r = r.filter((c) => (cm[c.cliente + "|" + c.vend] || "SEM CANAL") === S.fCanal);
  if (S.fCat) r = r.filter((c) => c.cat === S.fCat);   // isolar a categoria clicada
  const map = {};
  for (const c of r) {
    const g = (map[c.cat] ??= { nome: c.cat, f25: 0, f26: 0, v25: 0, v26: 0, _cli: new Set() });
    g.f26 += somaMeses(c.m26, meses);
    g.f25 += somaMesesPr(c.m25, meses);
    g.v26 += somaMeses(c.q26, meses);
    g.v25 += somaMesesPr(c.q25 || [], meses);
    if (comprou6(c)) g._cli.add(c.cliente);   // base compradora (6 meses fechados)
  }
  return Object.values(map).filter((g) => g.f25 || g.f26)
    .map((g) => volDash({ ...g, ncli: g._cli.size, ...metDash(g.f25, g.f26, 0) }));
}
/* Produtos: cubo MIX produto×vendedor (base compradora vem pronta do ETL, por escopo) */
function dashProdutos(meses) {
  let r = MIX.cube.prods;
  if (S.fGer) r = r.filter((p) => p.ger === S.fGer);
  if (S.fVend) r = r.filter((p) => p.vend === S.fVend);
  if (S.fCat) r = r.filter((p) => p.cat === S.fCat);
  const ncli = MIX.cube.ncli_prod || {};
  const map = {};
  for (const p of r) {
    const g = (map[p.prod] ??= { nome: p.prod, cat: p.cat, curva: p.curva,
                                 f25: 0, f26: 0, v25: 0, v26: 0, ncli: ncli[p.prod] || 0 });
    g.f26 += somaMeses(p.m26, meses);
    g.f25 += somaMesesPr(p.m25, meses);
    g.v26 += somaMeses(p.q26, meses);
    g.v25 += somaMesesPr(p.q25 || [], meses);
    if (!g.curva && p.curva) g.curva = p.curva;
  }
  return Object.values(map).filter((g) => g.f25 || g.f26)
    .map((g) => volDash({ ...g, ...metDash(g.f25, g.f26, 0) }));
}
/* Regiões/UFs: cubo de UF do Faturamento respeitando gerente/vendedor/canal */
const REGIAO_UF = { SP: "SUDESTE", RJ: "SUDESTE", MG: "SUDESTE", ES: "SUDESTE",
  PR: "SUL", SC: "SUL", RS: "SUL",
  BA: "NORDESTE", SE: "NORDESTE", AL: "NORDESTE", PE: "NORDESTE", PB: "NORDESTE",
  RN: "NORDESTE", CE: "NORDESTE", PI: "NORDESTE", MA: "NORDESTE",
  PA: "NORTE", AM: "NORTE", RO: "NORTE", RR: "NORTE", AP: "NORTE", AC: "NORTE", TO: "NORTE",
  MT: "CENTRO-OESTE", MS: "CENTRO-OESTE", GO: "CENTRO-OESTE", DF: "CENTRO-OESTE" };
function dashRegioes(meses, porRegiao) {
  const cm = canalLookup(), em = estrLookup();
  let r = FAT.cube.clientes;
  if (S.fEstr) r = r.filter((c) => (em[c.cliente + "|" + c.vend] || "") === S.fEstr);
  if (S.fGer) r = r.filter((c) => c.ger === S.fGer);
  if (S.fVend) r = r.filter((c) => c.vend === S.fVend);
  if (S.fCanal) r = r.filter((c) => (cm[c.cliente + "|" + c.vend] || "SEM CANAL") === S.fCanal);
  const map = {};
  for (const c of r) for (const u of c.ufs) {
    const chave = porRegiao ? (REGIAO_UF[u.uf] || "—") : u.uf;
    const g = (map[chave] ??= { nome: chave, f25: 0, f26: 0, meta: 0, _cli: new Set() });
    const f26 = somaMeses(u.m26, meses);
    g.f26 += f26;
    g.f25 += somaMesesPr(u.m25, meses);
    g.meta += somaMesesPr(u.meta || [], meses);
    if (f26 > 0) g._cli.add(c.cliente);
  }
  return Object.values(map).filter((g) => g.f25 || g.f26)
    .map((g) => ({ ...g, clientes: g._cli.size, ...metDash(g.f25, g.f26, g.meta) }));
}

/* ---------------- exportação PDF / Excel ---------------- */
const viewAtiva = () => document.querySelector(".view.on").id.slice(2);
const NOMES_VIEW = { geral: "Dashboard", fat: "Faturamento", vol: "Volume / Mix",
                     metas: "Metas vs Realizado", posit: "Positivados", rank: "Rankings" };

function contextoTxt() {
  const f = [];
  if (S.fGer) f.push("Gerente: " + S.fGer);
  if (S.fVend) f.push("Vendedor: " + nomeVend(S.fVend));
  if (S.fCanal) f.push("Canal: " + S.fCanal);
  if (S.fCat) f.push("Categoria: " + S.fCat);
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
      // rankings ricos (mesmas tabelas do Dashboard)
      const cabR = ["#", "Nome", String(S.ano - 1), String(S.ano), "Cresc.", "Meta", "% Ating.", "GAP"];
      const fmtsR = [XL.num, null, XL.money, XL.money, XL.pct, XL.money, XL.pct, XL.money];
      const linR = (x, i) => [i + 1, nomeVend(x.nome), Math.round(x.f25), Math.round(x.f26), x.cr,
        x.meta ? Math.round(x.meta) : null, x.ating, x.gap == null ? null : Math.round(x.gap)];
      const mapR = (o) => ({ nome: o.nome, ...metDash(o.ly, o.realizado, o.meta) });
      xlTabela(ws, "Top 20 clientes", cabR,
        dashClientes(rows, meses).sort((a, b) => b.f26 - a.f26).slice(0, 20).map(linR), fmtsR,
        [5, 34, 14, 14, 10, 13, 9, 13]);
      if (S.data.escopo.perfil === "gestor")
        xlTabela(ws, "Gerentes", cabR, agrupar(rows, "ger", meses).map(mapR).map(linR), fmtsR);
      if (S.data.escopo.perfil !== "vendedor")
        xlTabela(ws, "Top 20 vendedores", cabR, agrupar(rows, "vend", meses).map(mapR).slice(0, 20).map(linR), fmtsR);

    } else if (v === "fat") {
      if (!FAT.cube) {
        const res = await fetch("/api/fatcube", { cache: "no-store" });
        if (!res.ok) throw new Error("detalhamento indisponível");
        FAT.cube = await res.json();
      }
      const { itens, tot, totalF26 } = calcFat();
      itens.sort((a, b) => b.m.f26 - a.m.f26);
      const mesesH6 = hist6Fat(() => 0).map((p) => rotuloMes(p.y, p.m));
      const cab = ["#", "CLIENTE", "2025", "2026", "26 Vs 25", "% Repres.", "Meta", "Realizado",
                   "% Ating.", "GAP", "Últ. Compra", rotuloMesAtual(), "Carteira", ...mesesH6];
      const fmts = [XL.num, null, XL.money, XL.money, XL.pct, XL.pct, XL.money, XL.money,
                    XL.pct, XL.money, null, XL.money, XL.money, ...mesesH6.map(() => XL.money)];
      const linha = (rk, nome, m, base) => [rk, nome, Math.round(m.f25), Math.round(m.f26), m.cr,
        m.f26 / (base || 1), m.meta ? Math.round(m.meta) : null, Math.round(m.realizado), m.ating,
        m.gap == null ? null : Math.round(m.gap), m.ult ? fmtDataCurta(m.ult) : "—",
        Math.round(m.mesAtual || 0), m.cart ? Math.round(m.cart) : null,
        ...(m.h6 || []).map((p) => Math.round(p.v))];
      xlTabela(ws, `Faturamento por cliente — período: ${rotuloPer()} · últimos 6 meses fechados do antigo p/ o recente`,
        cab, [...itens.map((x, i) => linha(i + 1, x.c.cliente, x.m, totalF26)),
              linha(null, `TOTAL GERAL (${itens.length} clientes)`, tot, totalF26)],
        fmts, [5, 36, 14, 14, 10, 9, 13, 13, 9, 13, 10, 12, 12, ...mesesH6.map(() => 11)]);
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
const FAT = { cube: null, ordCol: "f26", ordDir: -1, abertos: {}, busca: "", h6: false };

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

const somaMeses = (arr, meses) => meses.reduce((s, m) => s + (arr[m - 1] || 0), 0);
/* soma p/ comparação (ano anterior/meta): o mês corrente, parcial, entra pro-rata pelos dias decorridos */
function somaMesesPr(arr, meses) {
  const mA = S.data.periodo.mes_atual;
  return meses.reduce((s, m) => s + (arr[m - 1] || 0) * (m === mA ? S.fracMes : 1), 0);
}

/* TODAS as colunas seguem o período selecionado; 2025 (ano ant.) e meta entram
   pro-rata no mês em andamento p/ comparação justa com o parcial de 2026 */
function montarMetFat(f25, f26, meta, cart, ult, mesAtual, h6) {
  // sem venda em 2025 e com venda em 2026 => crescimento de 100% (cliente novo)
  return { f25, f26, cr: f25 > 0 ? (f26 - f25) / f25 : (f26 > 0 ? 1 : null),
           realizado: f26, anoAnt: f25, meta,
           ating: meta ? f26 / meta : null, gap: meta ? f26 - meta : null,
           cart, ult, mesAtual, h6 };
}
/* últimos 6 meses FECHADOS (o mês em andamento fica de fora — vira coluna própria),
   do mais antigo (esquerda) para o mais recente (direita) */
function hist6Fat(valorMes) {
  const { ano, mes_atual } = S.data.periodo;
  const base = ano * 12 + (mes_atual - 1);
  const out = [];
  for (let k = 6; k >= 1; k--) {
    const idx = base - k;
    out.push({ y: Math.floor(idx / 12), m: (idx % 12) + 1 });
  }
  return out.map((p) => ({ ...p, v: valorMes(p.y, p.m) }));
}
const mesUF = (u, y, m) => ((y === 2026 ? u.m26 : y === 2025 ? u.m25 : null) || [])[m - 1] || 0;

function metricasCliente(c) {
  const meses = mesesSel(), { ano, mes_atual } = S.data.periodo;
  const soma = (k, pr) => c.ufs.reduce((s, u) => s + (pr ? somaMesesPr(u[k], meses) : somaMeses(u[k], meses)), 0);
  const cart = c.ufs.reduce((s, u) => s + (u.cart || 0), 0);
  const ult = c.ufs.reduce((s, u) => (u.ult && (!s || u.ult > s)) ? u.ult : s, null);
  const mesAtual = c.ufs.reduce((s, u) => s + mesUF(u, ano, mes_atual), 0);
  const h6 = hist6Fat((y, m) => c.ufs.reduce((s, u) => s + mesUF(u, y, m), 0));
  return montarMetFat(soma("m25", 1), soma("m26"), somaMesesPr(c.meta, meses), cart, ult, mesAtual, h6);
}
function metricasUF(u) {
  const meses = mesesSel(), { ano, mes_atual } = S.data.periodo;
  return montarMetFat(somaMesesPr(u.m25, meses), somaMeses(u.m26, meses), somaMesesPr(u.meta || [], meses),
                      u.cart || 0, u.ult || null, mesUF(u, ano, mes_atual), hist6Fat((y, m) => mesUF(u, y, m)));
}

const farol = (x) => x == null ? "" : x >= 0.12 ? "cor-ok" : x >= 0 ? "cor-med" : "cor-bad";

const FAT_COLS = [
  { k: "rkg", t: "#", sort: false },
  { k: "cliente", t: "CLIENTE", sort: "cliente" },
  { k: "f25", t: "2025", sort: "f25" },
  { k: "f26", t: "2026", sort: "f26" },
  { k: "cr", t: "26 Vs 25", sort: "cr" },
  { k: "repr", t: "% Repres.", sort: "repr" },
  { k: "meta", t: "Meta", sort: "meta" },
  { k: "realizado", t: "Realizado", sort: "realizado" },
  { k: "ating", t: "% Ating.", sort: "ating" },
  { k: "gap", t: "GAP", sort: "gap" },
  { k: "ult", t: "Últ. Compra", sort: "ult" },
  { k: "mesAtual", t: "", sort: "mesAtual" },   // rótulo dinâmico = mês em andamento
  { k: "cart", t: "Carteira", sort: "cart" },
  { k: "h6", t: "Últimos 6M", sort: false },
];
const FAT_COLS_R = ["f25", "f26", "cr", "repr", "meta", "realizado", "ating", "gap", "mesAtual", "cart"];
/* meses sempre abreviados em minúsculas (jul/26) */
const rotuloMes = (y, m) => `${MESES[m - 1]}/${String(y).slice(2)}`;
const rotuloMesAtual = () => rotuloMes(S.data.periodo.ano, S.data.periodo.mes_atual);

/* soma todas as fatias (vendedores) de uma mesma bandeira, unificando as UFs */
function agregarPorBandeira(linhas) {
  const map = {};
  for (const c of linhas) {
    const g = (map[c.cliente] ??= { cliente: c.cliente, meta: Array(12).fill(0), ufs: {} });
    c.meta.forEach((v, i) => g.meta[i] += v || 0);
    for (const u of c.ufs) {
      const t = (g.ufs[u.uf] ??= { uf: u.uf, m25: Array(12).fill(0), m26: Array(12).fill(0),
                                    q25: Array(12).fill(0), q26: Array(12).fill(0), meta: Array(12).fill(0),
                                    cart: 0, ult: null });
      for (const k of ["m25", "m26", "q25", "q26", "meta"]) (u[k] || []).forEach((v, i) => t[k][i] += v || 0);
      t.cart += u.cart || 0;
      if (u.ult && (!t.ult || u.ult > t.ult)) t.ult = u.ult;
    }
  }
  return Object.values(map).map((g) => ({ cliente: g.cliente, meta: g.meta, ufs: Object.values(g.ufs) }));
}

/* filtra por gerente/vendedor, agrega por bandeira e calcula métricas + TOTAL do escopo */
function calcFat() {
  let linhas = FAT.cube.clientes;
  if (S.fEstr) { const em = estrLookup(); linhas = linhas.filter((c) => (em[c.cliente + "|" + c.vend] || "") === S.fEstr); }
  if (S.fGer) linhas = linhas.filter((c) => c.ger === S.fGer);
  if (S.fVend) linhas = linhas.filter((c) => c.vend === S.fVend);
  if (S.fCanal) { const cm = canalLookup(); linhas = linhas.filter((c) => (cm[c.cliente + "|" + c.vend] || "SEM CANAL") === S.fCanal); }
  linhas = agregarPorBandeira(linhas);
  if (FAT.busca) {
    const b = FAT.busca.toLowerCase();
    linhas = linhas.filter((c) => c.cliente.toLowerCase().includes(b));
  }
  const itens = linhas.map((c) => ({ c, m: metricasCliente(c) }));
  const totalF26 = itens.reduce((s, x) => s + x.m.f26, 0) || 1;

  // TOTAL GERAL (todos os clientes do escopo/busca, não só o top 20)
  const tot = { f25: 0, f26: 0, realizado: 0, anoAnt: 0, meta: 0, cart: 0, mesAtual: 0 };
  for (const x of itens) for (const k of Object.keys(tot)) tot[k] += x.m[k] || 0;
  tot.cr = tot.f25 > 0 ? (tot.f26 - tot.f25) / tot.f25 : (tot.f26 > 0 ? 1 : null);
  tot.ating = tot.meta ? tot.realizado / tot.meta : null;
  tot.gap = tot.meta ? tot.realizado - tot.meta : null;
  tot.ult = itens.reduce((s, x) => (x.m.ult && (!s || x.m.ult > s)) ? x.m.ult : s, null);
  tot.h6 = hist6Fat((y, m) => itens.reduce((s, x) => {
    const p = x.m.h6.find((q) => q.y === y && q.m === m); return s + (p ? p.v : 0);
  }, 0));
  return { itens, tot, totalF26 };
}

function desenharFat() {
  let { itens, tot, totalF26 } = calcFat();
  const nCli = itens.length;

  // ordena e pega Top 20
  const col = FAT.ordCol, dir = FAT.ordDir;
  const val = (x) => col === "cliente" ? x.c.cliente : col === "repr" ? x.m.f26
    : col === "ult" ? (x.m.ult ? Date.parse(x.m.ult) : -Infinity) : (x.m[col] ?? -Infinity);
  itens.sort((a, b) => col === "cliente"
    ? dir * String(val(a)).localeCompare(String(val(b)), "pt-BR")
    : dir * (val(a) - val(b)));
  itens = itens.slice(0, 20);

  let th = FAT_COLS.map((c) => {
    if (c.k === "h6")
      return `<th id="fat-h6th" style="cursor:pointer" title="Clique para ${FAT.h6 ? "recolher" : "abrir"} os valores mês a mês">${c.t} ${FAT.h6 ? "◂" : "▸"}</th>`;
    const ativo = c.sort === FAT.ordCol;
    const seta = ativo ? (FAT.ordDir < 0 ? " ▼" : " ▲") : "";
    const rot = c.k === "mesAtual" ? rotuloMesAtual() : c.t;
    return `<th class="${FAT_COLS_R.includes(c.k) ? "r" : ""}${c.sort ? " ord" : ""}${ativo ? " ord-on" : ""}"${c.sort ? ` data-sort="${c.sort}"` : ""}>${rot}${seta}</th>`;
  }).join("");
  if (FAT.h6)
    th += hist6Fat(() => 0).map((p) => `<th class="r">${rotuloMes(p.y, p.m)}</th>`).join("");
  const nCols = FAT_COLS.length + (FAT.h6 ? 6 : 0);

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

  $("fat-info").textContent =
    `${FAT.busca ? `${nCli} encontrado(s)` : "Top 20"} · ${rotuloPer()} · clique num cliente para abrir por UF · clique no cabeçalho para ordenar`;
  $("fat-conteudo").innerHTML =
    `<div class="twrap"><table class="fat-tab"><thead><tr>${th}</tr></thead><tbody>${corpo || `<tr><td colspan="${nCols}" class="empty">Nenhum cliente encontrado.</td></tr>`}</tbody></table></div>`;

  document.querySelectorAll(".fat-tab th.ord").forEach((h) => h.addEventListener("click", () => {
    const s = h.dataset.sort;
    if (FAT.ordCol === s) FAT.ordDir *= -1; else { FAT.ordCol = s; FAT.ordDir = s === "cliente" ? 1 : -1; }
    desenharFat();
  }));
  const h6th = $("fat-h6th");
  if (h6th) h6th.addEventListener("click", () => { FAT.h6 = !FAT.h6; desenharFat(); });
  document.querySelectorAll(".fat-tab tr.fat-cli").forEach((r) => r.addEventListener("click", () => {
    const k = r.dataset.cli;
    FAT.abertos[k] = !FAT.abertos[k];
    desenharFat();
  }));
}

/* dias sem compra em relação à data de atualização dos dados */
function diasSemCompra(ult) {
  if (!ult) return null;
  return Math.round((Date.parse(S.data.atualizado_ate) - Date.parse(ult)) / 864e5);
}
function sparkFat(h6) {
  const vals = (h6 || []).map((p) => Math.max(0, p.v || 0));
  const max = Math.max(1, ...vals);
  return '<div class="spark">' + vals.map((v) =>
    v > 0 ? `<i style="height:${Math.max(3, Math.round((v / max) * 18))}px"></i>` : '<i class="z"></i>').join("") + "</div>";
}

function celFat(m, base) {
  const pct = (x) => x == null ? "—" : (x >= 0 ? "" : "−") + fmtBR(Math.abs(x) * 100, 0) + "%";
  const repr = m.f26 / (base || 1);
  const dias = diasSemCompra(m.ult);
  let cels =
    `<td class="r">${fmtV(m.f25)}</td>` +
    `<td class="r"><b>${fmtV(m.f26)}</b></td>` +
    `<td class="r"><span class="farolp ${farol(m.cr)}">${pct(m.cr)}</span></td>` +
    `<td class="r">${fmtBR(repr * 100, 1)}%</td>` +
    `<td class="r">${m.meta ? fmtV(m.meta) : "—"}</td>` +
    `<td class="r">${fmtV(m.realizado)}</td>` +
    `<td class="r">${m.ating == null ? "—" : fmtBR(m.ating * 100, 0) + "%"}</td>` +
    `<td class="r" style="color:${m.gap == null ? "var(--soft)" : m.gap >= 0 ? "var(--ok)" : "var(--bad)"}">${m.gap == null ? "—" : (m.gap >= 0 ? "+" : "−") + fmtV(Math.abs(m.gap))}</td>` +
    `<td${dias != null && dias > 60 ? ' style="color:var(--bad);font-weight:700"' : ""}>${fmtDataCurta(m.ult)}</td>` +
    `<td class="r">${m.mesAtual ? fmtV(m.mesAtual) : "—"}</td>` +
    `<td class="r">${m.cart ? fmtV(m.cart) : "—"}</td>` +
    `<td>${sparkFat(m.h6)}</td>`;
  if (FAT.h6) cels += (m.h6 || []).map((p) => `<td class="r">${fmtV(p.v)}</td>`).join("");
  return cels;
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
  document.querySelectorAll("#estr-btns button").forEach((b) =>
    b.addEventListener("click", () => filtrarEstr(b.dataset.e)));

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
  if ($("busca-fat"))
    $("busca-fat").addEventListener("input", (e) => { FAT.busca = e.target.value.trim(); if (FAT.cube) desenharFat(); });
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
