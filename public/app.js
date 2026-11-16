{
/* ================= utilidades ================= */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const V = $("#view"), DLG = $("#dlg");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const brl = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBR = (d) => (d ? new Date(String(d).slice(0, 10) + "T12:00:00").toLocaleDateString("pt-BR") : "");
const dataHora = (d) => (d ? new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "");
const hoje = () => new Date().toISOString().slice(0, 10);
const STATUS = { rascunho: "Rascunho", enviada: "Enviada", visualizada: "Visualizada", aceita: "Aceita", recusada: "Recusada", expirada: "Expirada" };
const badge = (p) => { const s = p.expirada ? "expirada" : p.status; return `<span class="st ${s}">${STATUS[s]}</span>`; };
const link = (p) => `${location.origin}/p/${p.token}`;

function toast(msg, err) {
  const t = $("#toast"); t.textContent = msg; t.className = err ? "err" : ""; t.style.display = "block";
  clearTimeout(t._h); t._h = setTimeout(() => (t.style.display = "none"), 3500);
}
async function api(method, url, body) {
  const r = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401) { location.href = "/login"; throw new Error("Sessão expirada"); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.erro || "Erro " + r.status);
  return j;
}
const run = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, true); } };
async function copiar(txt) { try { await navigator.clipboard.writeText(txt); toast("Link copiado"); } catch { prompt("Copie o link:", txt); } }

let EMPRESAS = [];
const empSel = () => localStorage.getItem("emp") || "";
const empNome = (id) => { const e = EMPRESAS.find((x) => x.id == id); return e ? e.fantasia || e.nome : ""; };
async function carregarEmpresas() { EMPRESAS = await api("GET", "/api/empresas"); }
function seletorEmpresa(todas = true) {
  const v = empSel() || (todas ? "" : EMPRESAS[0]?.id || "");
  return `<select id="empF" aria-label="Empresa">${todas ? `<option value="">Todas as empresas</option>` : ""}
    ${EMPRESAS.map((e) => `<option value="${e.id}" ${e.id == v ? "selected" : ""}>${esc(e.fantasia || e.nome)}</option>`).join("")}</select>`;
}
function ligarSeletor(cb) { const s = $("#empF"); if (s) s.onchange = () => { localStorage.setItem("emp", s.value); cb(); }; }
const empAtual = () => $("#empF")?.value || EMPRESAS[0]?.id;

function modal(html, onOpen) {
  DLG.innerHTML = html; DLG.showModal(); $$("[data-close]", DLG).forEach((b) => (b.onclick = () => DLG.close()));
  onOpen && onOpen(DLG);
}
const semEmpresa = () => (V.innerHTML = `<div class="card empty"><h2>Cadastre sua primeira empresa</h2><p>As propostas, clientes e produtos ficam separados por empresa.</p><a class="btn pri" href="#/empresas">Ir para Empresas</a></div>`);

/* ================= roteador ================= */
async function rota() {
  const [p0, qs] = location.hash.slice(1).split("?"), partes = p0.split("/").filter(Boolean);
  const r = partes[0] || "painel";
  if (DLG.open) DLG.close();
  $$("nav.side a").forEach((a) => a.classList.toggle("on", a.dataset.r === r));
  try {
    if (!EMPRESAS.length) await carregarEmpresas();
    if (r === "painel") await painel();
    else if (r === "propostas" && partes[1]) await editor(partes[1]);
    else if (r === "propostas") await propostas();
    else if (r === "clientes") await cadastro("clientes");
    else if (r === "produtos") await cadastro("produtos");
    else if (r === "empresas") await empresas(new URLSearchParams(qs));
    window.scrollTo(0, 0);
  } catch (e) { V.innerHTML = `<div class="card empty">${esc(e.message)}</div>`; }
  atualizarBadge();
}
async function atualizarBadge() {
  try { const l = await api("GET", "/api/propostas"); const n = l.reduce((s, p) => s + p.msgs_novas, 0); const b = $("#navMsgs"); b.hidden = !n; b.textContent = n; } catch {}
}
window.addEventListener("hashchange", rota);
$("#sair").onclick = async () => { await api("POST", "/api/logout"); location.href = "/login"; };

/* ================= painel ================= */
async function painel() {
  const emp = empSel();
  const [r, lista] = await Promise.all([api("GET", "/api/resumo?empresa_id=" + emp), api("GET", "/api/propostas?empresa_id=" + emp)]);
  const respondidas = r.aceitas + r.recusadas, taxa = respondidas ? Math.round((r.aceitas / respondidas) * 100) : 0;
  const meses = []; for (let i = 5; i >= 0; i--) { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i); meses.push(d.toISOString().slice(0, 7)); }
  const dados = meses.map((m) => r.meses.find((x) => x.mes === m) || { mes: m, total: 0, aceitas: 0 });
  const max = Math.max(1, ...dados.map((d) => d.total));
  const nomeMes = (m) => new Date(m + "-15").toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
  V.innerHTML = `
  <div class="top"><h1>Painel</h1><div class="row">${seletorEmpresa()}<a class="btn acc" href="#/propostas/nova">+ Nova proposta</a></div></div>
  <div class="grid g4">
    <div class="card kpi"><div class="l">Propostas no mês</div><div class="v">${r.mes}</div></div>
    <div class="card kpi"><div class="l">Em aberto</div><div class="v">${r.abertas}</div><div class="s">${brl(r.aberto_unico)} únicos · ${brl(r.aberto_mensal)}/mês</div></div>
    <div class="card kpi"><div class="l">Aceitas no mês</div><div class="v">${brl(r.aceito_mensal_mes)}<small style="font-size:15px">/mês</small></div><div class="s">+ ${brl(r.aceito_unico_mes)} em valores únicos</div></div>
    <div class="card kpi"><div class="l">Taxa de aceite</div><div class="v">${taxa}%</div><div class="s">${r.aceitas} aceitas · ${r.recusadas} recusadas</div></div>
  </div>
  <div class="grid g2 split" style="margin-top:14px">
    <div class="card"><h2>Últimos 6 meses</h2>
      <div class="bars">${dados.map((d) => `<div class="bar"><span>${d.total}</span><div class="t" style="height:${(d.total / max) * 120 + 2}px"><div class="a" style="height:${d.total ? (d.aceitas / d.total) * 100 : 0}%"></div></div><span>${nomeMes(d.mes)}</span></div>`).join("")}</div>
      <div class="leg"><span><i class="dot" style="background:#cfe3ea"></i>Criadas</span><span><i class="dot" style="background:var(--brand2)"></i>Aceitas</span></div>
    </div>
    <div class="card"><h2>Recentes</h2>${tabelaPropostas(lista.slice(0, 8), true)}</div>
  </div>`;
  ligarSeletor(painel); ligarLinhas();
}
function tabelaPropostas(l, curta) {
  if (!l.length) return `<div class="empty">Nenhuma proposta ainda. <a href="#/propostas/nova">Criar a primeira</a></div>`;
  return `<table class="resp"><thead><tr><th>Nº</th>${curta ? "" : "<th>Empresa</th>"}<th>Cliente</th><th class="n">Único</th><th class="n">Mensal</th><th>Status</th>${curta ? "" : "<th>Data</th>"}</tr></thead><tbody>
  ${l.map((p) => `<tr class="click" data-id="${p.id}"><td data-l="Nº">${p.numero} ${p.msgs_novas ? `<span class="pill">${p.msgs_novas} msg</span>` : ""}</td>
    ${curta ? "" : `<td data-l="Empresa"><i class="dot" style="background:${esc(p.cor_destaque)}"></i>${esc(p.fantasia || p.empresa_nome)}</td>`}
    <td data-l="Cliente">${esc(p.cliente_nome || "—")}<br><small class="hint">${esc(p.titulo)}</small></td>
    <td class="n" data-l="Único">${brl(p.total_unico)}</td><td class="n" data-l="Mensal">${brl(p.total_mensal)}</td>
    <td data-l="Status">${badge(p)}</td>${curta ? "" : `<td data-l="Data">${dataBR(p.data)}</td>`}</tr>`).join("")}</tbody></table>`;
}
const ligarLinhas = () => $$("tr.click[data-id]").forEach((tr) => (tr.onclick = () => (location.hash = "#/propostas/" + tr.dataset.id)));

/* ================= lista de propostas ================= */
async function propostas() {
  V.innerHTML = `<div class="top"><h1>Propostas</h1><a class="btn acc" href="#/propostas/nova">+ Nova proposta</a></div>
  <div class="filters">${seletorEmpresa()}<select id="stF"><option value="">Todos os status</option>${["rascunho", "enviada", "visualizada", "aceita", "recusada"].map((s) => `<option value="${s}">${STATUS[s]}</option>`).join("")}</select>
  <input id="bF" type="search" placeholder="Buscar cliente, título ou nº"></div><div class="card" id="lst"></div>`;
  const carregar = run(async () => {
    const qs = new URLSearchParams({ empresa_id: $("#empF").value, status: $("#stF").value, busca: $("#bF").value });
    $("#lst").innerHTML = tabelaPropostas(await api("GET", "/api/propostas?" + qs)); ligarLinhas();
  });
  ligarSeletor(carregar); $("#stF").onchange = carregar; let t; $("#bF").oninput = () => { clearTimeout(t); t = setTimeout(carregar, 300); };
  carregar();
}

/* ================= editor de proposta ================= */
async function editor(id) {
  if (!EMPRESAS.length) return semEmpresa();
  let P;
  if (id === "nova") {
    const e = EMPRESAS.find((x) => x.id == empSel()) || EMPRESAS[0];
    P = { empresa_id: e.id, status: "rascunho", data: hoje(), validade_dias: e.validade_padrao || 7, titulo: "", subtitulo: "", vendedor: e.responsavel || "",
      frete: 0, itens: [], condicoes: JSON.parse(JSON.stringify(e.condicoes_padrao || [])), mensagens: [], cliente: null };
  } else P = await api("GET", "/api/propostas/" + id);
  const novo = !P.id, bloqueada = ["aceita", "recusada"].includes(P.status);

  V.innerHTML = `
  <div class="top"><div><a href="#/propostas" class="hint">← Propostas</a><h1>${novo ? "Nova proposta" : `Proposta nº ${P.numero}`} ${novo ? "" : badge(P)}</h1></div>
    <div class="row">${novo ? "" : `<button class="btn" id="bCopy">Copiar link</button><a class="btn" target="_blank" href="${link(P)}">Abrir</a><button class="btn" id="bWa">WhatsApp</button><button class="btn" id="bDup">Duplicar</button>`}
    <button class="btn pri" id="bSave">Salvar</button>${P.status === "rascunho" ? `<button class="btn acc" id="bSend">Salvar e enviar</button>` : ""}</div></div>
  ${bloqueada ? `<div class="card" style="margin-bottom:14px;border-color:${P.status === "aceita" ? "var(--ok)" : "var(--no)"}"><strong>${STATUS[P.status]}</strong> por ${esc(P.resposta_nome)} em ${dataHora(P.resposta_em)}${P.resposta_motivo ? ` — “${esc(P.resposta_motivo)}”` : ""}</div>` : ""}
  ${!novo && P.visualizada_em ? `<p class="hint">Cliente abriu o link em ${dataHora(P.visualizada_em)}.</p>` : ""}
  <div class="grid" style="grid-template-columns:minmax(0,1fr) 320px;align-items:start" id="edGrid">
   <div class="grid">
    <div class="card grid g2">
      <div><label>Empresa</label><select id="fEmp" ${novo ? "" : "disabled"}>${EMPRESAS.map((e) => `<option value="${e.id}" ${e.id == P.empresa_id ? "selected" : ""}>${esc(e.fantasia || e.nome)}</option>`).join("")}</select></div>
      <div class="search"><label>Cliente</label><input id="fCli" autocomplete="off" placeholder="Buscar cliente…" value="${esc(P.cliente?.nome || "")}"><div class="drop" id="dCli"></div></div>
      <div><label>Título (capa)</label><input id="fTit" value="${esc(P.titulo)}" placeholder="Ex.: Link dedicado em fibra para sua empresa"></div>
      <div><label>Subtítulo</label><input id="fSub" value="${esc(P.subtitulo)}"></div>
      <div class="grid g3" style="grid-column:1/-1">
        <div><label>Data</label><input type="date" id="fData" value="${String(P.data).slice(0, 10)}"></div>
        <div><label>Validade (dias)</label><input type="number" min="1" id="fVal" value="${P.validade_dias}"></div>
        <div><label>Vendedor</label><input id="fVend" value="${esc(P.vendedor)}"></div>
      </div>
      <div id="cliInfo" class="hint" style="grid-column:1/-1"></div>
    </div>
    <div class="card"><div class="row" style="justify-content:space-between"><h2>Itens</h2>
      <div class="search" style="width:min(380px,100%)"><input id="fProd" autocomplete="off" placeholder="+ Adicionar produto (buscar)…"><div class="drop" id="dProd"></div></div></div>
      <table class="itens resp"><thead><tr><th>Cód.</th><th>Descrição</th><th>Cobrança</th><th class="n">Qtde</th><th class="n">Valor unit.</th><th class="n">Desc. %</th><th class="n">Total</th><th></th></tr></thead><tbody id="tItens"></tbody></table>
      <button class="btn sm" id="bLinha" style="margin-top:8px">+ Item avulso</button>
      <div class="tot" id="tot"></div>
    </div>
    <div class="card"><h2>Condições</h2><div id="conds"></div><button class="btn sm" id="bCond">+ Condição</button></div>
   </div>
   <div class="grid">
    ${novo ? "" : `<div class="card"><h2>Status</h2><select id="fSt">${["rascunho", "enviada", "aceita", "recusada"].map((s) => `<option value="${s}" ${(P.status === s || (P.status === "visualizada" && s === "enviada")) ? "selected" : ""}>${STATUS[s]}</option>`).join("")}</select>
      <p class="hint">Normalmente o cliente aceita ou recusa pelo link. Use isto para registrar manualmente.</p><div class="mono">${esc(link(P))}</div></div>
    <div class="card"><h2>Mensagens</h2><div class="msgs" id="msgs"></div><textarea id="fMsg" rows="2" placeholder="Responder ao cliente"></textarea><button class="btn sm pri" id="bMsg" style="margin-top:6px">Enviar resposta</button></div>
    <button class="btn red" id="bDel">Excluir proposta</button>`}
   </div>
  </div>`;
  if (innerWidth < 1000) $("#edGrid").style.gridTemplateColumns = "1fr";

  const totais = () => {
    let u = 0, m = 0, bruto = 0;
    P.itens.forEach((it) => { const b = (+it.qtd || 0) * (+it.unit || 0), t = b * (1 - (+it.desconto_pct || 0) / 100); bruto += b; it.tipo === "mensal" ? (m += t) : (u += t); });
    $("#tot").innerHTML = `<div><span>Subtotal</span><span>${brl(bruto)}</span></div>${bruto - u - m > 0.004 ? `<div><span>Descontos</span><span>− ${brl(bruto - u - m)}</span></div>` : ""}
      <div><span>Frete / deslocamento</span><span><input id="fFrete" type="number" step="0.01" min="0" value="${P.frete || 0}" style="width:110px;text-align:right"></span></div>
      <div><span>Total único</span><span>${brl(u + (+P.frete || 0))}</span></div><div class="big"><span>Mensalidade</span><span>${brl(m)}/mês</span></div>`;
    $("#fFrete").onchange = (e) => { P.frete = +e.target.value || 0; totais(); };
  };
  const itens = () => {
    $("#tItens").innerHTML = P.itens.map((it, i) => `<tr data-i="${i}">
      <td data-l="Cód."><input data-k="codigo" value="${esc(it.codigo)}" style="width:90px"></td>
      <td data-l="Descrição"><input data-k="descricao" value="${esc(it.descricao)}"></td>
      <td data-l="Cobrança"><select data-k="tipo"><option value="unico">Único</option><option value="mensal" ${it.tipo === "mensal" ? "selected" : ""}>Mensal</option></select></td>
      <td data-l="Qtde" class="n"><input data-k="qtd" type="number" step="any" min="0" value="${+it.qtd}" style="width:70px;text-align:right"></td>
      <td data-l="Valor unit." class="n"><input data-k="unit" type="number" step="0.01" min="0" value="${+it.unit}" style="width:105px;text-align:right"></td>
      <td data-l="Desc. %" class="n"><input data-k="desconto_pct" type="number" step="0.01" min="0" max="100" value="${+it.desconto_pct || 0}" style="width:70px;text-align:right"></td>
      <td data-l="Total" class="n">${brl((+it.qtd || 0) * (+it.unit || 0) * (1 - (+it.desconto_pct || 0) / 100))}</td>
      <td><button class="btn sm red" data-rm="${i}" aria-label="Remover item">✕</button></td></tr>`).join("") || `<tr><td colspan="8" class="empty">Busque um produto acima ou adicione um item avulso.</td></tr>`;
    $$("#tItens [data-k]").forEach((inp) => (inp.onchange = () => {
      const tr = inp.closest("tr"), it = P.itens[tr.dataset.i]; it[inp.dataset.k] = inp.value;
      tr.children[6].textContent = brl((+it.qtd || 0) * (+it.unit || 0) * (1 - (+it.desconto_pct || 0) / 100)); totais(); }));
    $$("#tItens [data-rm]").forEach((b) => (b.onclick = () => { P.itens.splice(+b.dataset.rm, 1); itens(); }));
    totais();
  };
  const conds = () => {
    $("#conds").innerHTML = P.condicoes.map(([t, d], i) => `<div class="cond" data-i="${i}"><input data-c="0" value="${esc(t)}" placeholder="Título"><textarea data-c="1" rows="2">${esc(d)}</textarea><button class="btn sm red" data-rc="${i}" aria-label="Remover">✕</button></div>`).join("");
    $$("#conds [data-c]").forEach((el) => (el.onchange = () => (P.condicoes[el.closest(".cond").dataset.i][el.dataset.c] = el.value)));
    $$("#conds [data-rc]").forEach((b) => (b.onclick = () => { P.condicoes.splice(+b.dataset.rc, 1); conds(); }));
  };
  const cliInfo = () => { const c = P.cliente; $("#cliInfo").innerHTML = c ? `${esc(c.documento || "")} · ${esc(c.email || "sem e-mail")} · ${esc(c.telefone || "")}<br>${esc([c.endereco, c.cidade, c.uf].filter(Boolean).join(" – ") || "Endereço não cadastrado")}` : ""; };
  itens(); conds(); cliInfo();

  // busca com lista suspensa
  function busca(inp, drop, url, render, escolher) {
    let t, res = [];
    const buscar = async () => { res = await api("GET", url() + encodeURIComponent(inp.value)); drop.innerHTML = res.map((r, i) => `<div data-i="${i}">${render(r)}</div>`).join("") || `<div class="hint">Nada encontrado</div>`; drop.classList.add("on");
      $$("[data-i]", drop).forEach((d) => (d.onmousedown = (e) => { e.preventDefault(); escolher(res[d.dataset.i]); drop.classList.remove("on"); })); };
    inp.oninput = () => { clearTimeout(t); t = setTimeout(run(buscar), 250); }; inp.onfocus = run(buscar); inp.onblur = () => setTimeout(() => drop.classList.remove("on"), 150);
  }
  busca($("#fCli"), $("#dCli"), () => `/api/clientes?ativos=1&limite=30&empresa_id=${$("#fEmp").value}&busca=`, (c) => `${esc(c.nome)}<small>${esc(c.documento || "")} ${c.bling_id ? "· Bling" : ""}</small>`,
    run(async (c) => { if (c.bling_id && !c.detalhado) { toast("Buscando dados completos no Bling…"); c = await api("POST", `/api/clientes/${c.id}/detalhar`); }
      P.cliente = c; P.cliente_id = c.id; $("#fCli").value = c.nome; cliInfo(); }));
  busca($("#fProd"), $("#dProd"), () => `/api/produtos?ativos=1&limite=30&empresa_id=${$("#fEmp").value}&busca=`, (p) => `${esc(p.nome)}<small>${esc(p.codigo || "")} · ${brl(p.preco)} ${p.tipo_cobranca === "mensal" ? "/mês" : ""}</small>`,
    (p) => { P.itens.push({ produto_id: p.id, codigo: p.codigo, descricao: p.nome, tipo: p.tipo_cobranca, qtd: 1, unit: p.preco, desconto_pct: 0 }); $("#fProd").value = ""; itens(); });
  $("#bLinha").onclick = () => { P.itens.push({ codigo: "", descricao: "", tipo: "unico", qtd: 1, unit: 0, desconto_pct: 0 }); itens(); $$("#tItens [data-k=descricao]").pop().focus(); };
  $("#bCond").onclick = () => { P.condicoes.push(["", ""]); conds(); };
  if (novo) $("#fEmp").onchange = () => { const e = EMPRESAS.find((x) => x.id == $("#fEmp").value); P.empresa_id = e.id; P.cliente = null; P.cliente_id = null; $("#fCli").value = ""; cliInfo();
    P.condicoes = JSON.parse(JSON.stringify(e.condicoes_padrao || [])); $("#fVal").value = e.validade_padrao || 7; conds(); };

  const coletar = () => ({ empresa_id: $("#fEmp").value, cliente_id: P.cliente_id || null, titulo: $("#fTit").value, subtitulo: $("#fSub").value, vendedor: $("#fVend").value,
    data: $("#fData").value, validade_dias: $("#fVal").value, frete: P.frete, condicoes: P.condicoes.filter(([t, d]) => t || d), itens: P.itens });
  const salvar = async (enviar) => {
    const d = coletar();
    if (enviar && !d.cliente_id) throw new Error("Escolha o cliente antes de enviar.");
    if (enviar && !d.itens.some((i) => i.descricao)) throw new Error("Adicione pelo menos um item.");
    let r = await api(novo ? "POST" : "PUT", novo ? "/api/propostas" : "/api/propostas/" + P.id, d);
    if (enviar) r = await api("POST", `/api/propostas/${r.id}/status`, { status: "enviada" });
    toast(enviar ? "Proposta enviada — copie o link ou mande pelo WhatsApp" : "Proposta salva");
    if (novo) location.hash = "#/propostas/" + r.id; else editor(r.id);
  };
  $("#bSave").onclick = run(() => salvar(false));
  if ($("#bSend")) $("#bSend").onclick = run(() => salvar(true));
  if (novo) return;

  const emp = EMPRESAS.find((e) => e.id == P.empresa_id) || {};
  $("#bCopy").onclick = () => copiar(link(P));
  $("#bWa").onclick = () => {
    const fone = String(P.cliente?.telefone || "").replace(/\D/g, ""), num = fone ? (fone.length <= 11 ? "55" + fone : fone) : "";
    const txt = `Olá${P.cliente?.contato ? " " + P.cliente.contato : ""}! Segue a proposta comercial nº ${P.numero} da ${emp.fantasia || emp.nome}: ${link(P)}`;
    window.open(`https://wa.me/${num}?text=${encodeURIComponent(txt)}`, "_blank");
  };
  $("#bDup").onclick = run(async () => { const r = await api("POST", `/api/propostas/${P.id}/duplicar`); toast("Cópia criada como rascunho"); location.hash = "#/propostas/" + r.id; });
  $("#fSt").onchange = run(async (e) => { await api("POST", `/api/propostas/${P.id}/status`, { status: e.target.value }); toast("Status atualizado"); editor(P.id); });
  $("#bDel").onclick = () => modal(`<h2>Excluir proposta nº ${P.numero}?</h2><p>Isso apaga a proposta, os itens e as mensagens. Não dá para desfazer.</p>
    <div class="row" style="justify-content:flex-end"><button class="btn" data-close>Cancelar</button><button class="btn pri" id="ok" style="background:var(--no);border-color:var(--no)">Excluir</button></div>`,
    () => ($("#ok").onclick = run(async () => { await api("DELETE", "/api/propostas/" + P.id); DLG.close(); location.hash = "#/propostas"; })));
  const msgs = (l) => { $("#msgs").innerHTML = l.map((m) => `<div class="msg ${m.autor}"><small>${esc(m.nome)} · ${dataHora(m.created_at)}</small>${esc(m.texto)}</div>`).join("") || `<p class="hint">Nenhuma mensagem.</p>`; $("#msgs").scrollTop = 1e6; };
  msgs(P.mensagens);
  $("#bMsg").onclick = run(async () => { const t = $("#fMsg").value.trim(); if (!t) return; msgs(await api("POST", `/api/propostas/${P.id}/mensagens`, { texto: t })); $("#fMsg").value = ""; });
}

/* ================= clientes / produtos ================= */
const CAD = {
  clientes: { titulo: "Clientes", cols: [["nome", "Nome"], ["documento", "CPF/CNPJ"], ["telefone", "Telefone"], ["cidade", "Cidade"]],
    campos: [["nome", "Nome / Razão social"], ["documento", "CPF/CNPJ"], ["contato", "A/C (pessoa de contato)"], ["email", "E-mail"], ["telefone", "Telefone / WhatsApp"], ["endereco", "Endereço"], ["cidade", "Cidade"], ["uf", "UF"], ["cep", "CEP"]] },
  produtos: { titulo: "Produtos e serviços", cols: [["codigo", "Código"], ["nome", "Nome"], ["preco", "Preço"], ["tipo_cobranca", "Cobrança"]],
    campos: [["codigo", "Código"], ["nome", "Nome"], ["preco", "Preço (R$)"], ["unidade", "Unidade"], ["tipo_cobranca", "Cobrança"]] },
};
async function cadastro(tipo) {
  if (!EMPRESAS.length) return semEmpresa();
  const C = CAD[tipo];
  V.innerHTML = `<div class="top"><h1>${C.titulo}</h1><div class="row"><button class="btn" id="bSync">↻ Sincronizar com Bling</button><button class="btn acc" id="bNovo">+ Novo</button></div></div>
   <div class="filters">${seletorEmpresa(false)}<input id="bF" type="search" placeholder="Buscar…"></div><p class="hint" id="info"></p><div class="card" id="lst"></div>`;
  let lista = [];
  const fmt = (r, k) => (k === "preco" ? brl(r[k]) : k === "tipo_cobranca" ? (r[k] === "mensal" ? "Mensal" : "Único") : esc(r[k] || "—"));
  const carregar = run(async () => {
    const e = EMPRESAS.find((x) => x.id == empAtual());
    $("#info").textContent = e.bling_conectado ? `Bling conectado${e.bling_sync_em ? " · última sincronização " + dataHora(e.bling_sync_em) : " · ainda não sincronizado"}` : "Esta empresa não está conectada ao Bling — conecte em Empresas, ou cadastre manualmente.";
    lista = await api("GET", `/api/${tipo}?empresa_id=${e.id}&busca=${encodeURIComponent($("#bF").value)}`);
    $("#lst").innerHTML = lista.length ? `<table class="resp"><thead><tr>${C.cols.map(([, l]) => `<th${l === "Preço" ? ' class="n"' : ""}>${l}</th>`).join("")}<th>Origem</th></tr></thead><tbody>
      ${lista.map((r, i) => `<tr class="click" data-i="${i}" style="${r.ativo ? "" : "opacity:.5"}">${C.cols.map(([k, l]) => `<td data-l="${l}"${k === "preco" ? ' class="n"' : ""}>${fmt(r, k)}</td>`).join("")}<td data-l="Origem">${r.bling_id ? "Bling" : "Manual"}</td></tr>`).join("")}</tbody></table>
      ${lista.length >= 300 ? `<p class="hint">Mostrando os 300 primeiros — use a busca.</p>` : ""}` : `<div class="empty">Nada cadastrado ainda.</div>`;
    $$("#lst tr.click").forEach((tr) => (tr.onclick = () => form(lista[tr.dataset.i])));
  });
  const form = (r = {}) => modal(`<h2>${r.id ? "Editar" : "Novo"}</h2>${r.bling_id ? `<p class="hint">Importado do Bling. Alterações aqui podem ser sobrescritas na próxima sincronização${tipo === "produtos" ? " (exceto o tipo de cobrança)" : ""}.</p>` : ""}
    <form id="fm" class="grid g2">${C.campos.map(([k, l]) => `<div><label for="c_${k}">${l}</label>${k === "tipo_cobranca" ? `<select id="c_${k}"><option value="unico">Pagamento único</option><option value="mensal" ${r[k] === "mensal" ? "selected" : ""}>Mensal (recorrente)</option></select>`
      : `<input id="c_${k}" ${k === "preco" ? 'type="number" step="0.01"' : ""} value="${esc(r[k] ?? "")}" ${k === "nome" ? "required" : ""}>`}</div>`).join("")}
      <div><label><input type="checkbox" id="c_ativo" style="width:auto" ${r.ativo === false ? "" : "checked"}> Ativo</label></div>
      <div class="row" style="grid-column:1/-1;justify-content:space-between">${r.id ? `<button type="button" class="btn red" id="del">Excluir</button>` : "<span></span>"}<div class="row"><button type="button" class="btn" data-close>Cancelar</button><button class="btn pri">Salvar</button></div></div></form>`,
    () => {
      $("#fm").onsubmit = run(async (e) => { e.preventDefault(); const d = { empresa_id: empAtual(), ativo: $("#c_ativo").checked }; C.campos.forEach(([k]) => (d[k] = $("#c_" + k).value));
        await api(r.id ? "PUT" : "POST", `/api/${tipo}${r.id ? "/" + r.id : ""}`, d); DLG.close(); toast("Salvo"); carregar(); });
      if ($("#del")) $("#del").onclick = run(async () => { await api("DELETE", `/api/${tipo}/${r.id}`); DLG.close(); carregar(); });
    });
  $("#bNovo").onclick = () => form();
  $("#bSync").onclick = run(async () => {
    const e = EMPRESAS.find((x) => x.id == empAtual());
    if (!e.bling_conectado) return (location.hash = "#/empresas");
    const b = $("#bSync"); b.disabled = true; b.textContent = "Sincronizando… pode levar alguns minutos";
    try { const r = await api("POST", `/api/empresas/${e.id}/bling/sync`, { clientes: tipo === "clientes", produtos: tipo === "produtos" }); toast(`${r[tipo]} registros importados/atualizados do Bling`); await carregarEmpresas(); carregar(); }
    finally { b.disabled = false; b.textContent = "↻ Sincronizar com Bling"; }
  });
  ligarSeletor(carregar); let t; $("#bF").oninput = () => { clearTimeout(t); t = setTimeout(carregar, 300); };
  carregar();
}

/* ================= empresas ================= */
async function empresas(qs) {
  await carregarEmpresas();
  if (qs.get("bling") === "ok") { toast("Bling conectado! Agora sincronize clientes e produtos."); history.replaceState(null, "", "#/empresas"); }
  V.innerHTML = `<div class="top"><h1>Empresas</h1><button class="btn acc" id="bNova">+ Nova empresa</button></div>
  <div class="grid">${EMPRESAS.map((e) => `<div class="card empcard"><div class="logo" style="background:${esc(e.cor_primaria)}">${e.logo ? `<img src="${esc(e.logo)}" alt="">` : esc((e.fantasia || e.nome)[0])}</div>
    <div><strong>${esc(e.fantasia || e.nome)}</strong> <span class="hint">${esc(e.cnpj || "")}</span><br><span class="hint">${e.n_clientes} clientes · ${e.n_produtos} produtos · Bling: ${e.bling_conectado ? "<b style='color:var(--ok)'>conectado</b>" : "não conectado"}</span></div>
    <div class="row">${e.bling_conectado ? `<button class="btn sm" data-sync="${e.id}">↻ Sincronizar Bling</button>` : ""}<button class="btn sm" data-ed="${e.id}">Editar</button></div></div>`).join("") || `<div class="card empty">Nenhuma empresa cadastrada.</div>`}</div>`;
  $("#bNova").onclick = () => formEmpresa({});
  $$("[data-ed]").forEach((b) => (b.onclick = () => formEmpresa(EMPRESAS.find((e) => e.id == b.dataset.ed))));
  $$("[data-sync]").forEach((b) => (b.onclick = run(async () => { b.disabled = true; b.textContent = "Sincronizando…";
    try { const r = await api("POST", `/api/empresas/${b.dataset.sync}/bling/sync`, {}); toast(`${r.clientes} clientes e ${r.produtos} produtos sincronizados`); empresas(new URLSearchParams()); } finally { b.disabled = false; } })));
}
function formEmpresa(e) {
  const campo = (k, l, extra = "") => `<div><label for="e_${k}">${l}</label><input id="e_${k}" value="${esc(e[k] ?? "")}" ${extra}></div>`;
  const dest = (e.destaques || []).map(([t, d]) => `${t} | ${d}`).join("\n");
  let conds = JSON.parse(JSON.stringify(e.condicoes_padrao || [["Forma de pagamento", ""], ["Prazo de entrega", ""], ["Observações", ""]]));
  let logo = e.logo || "";
  modal(`<h2>${e.id ? "Editar empresa" : "Nova empresa"}</h2>
  <div class="tabs"><button class="on" data-t="dados">Dados</button><button data-t="visual">Visual e textos</button><button data-t="cond">Condições padrão</button><button data-t="bling">Bling</button></div>
  <form id="fe">
   <div data-p="dados" class="grid g2">${campo("nome", "Razão social", "required")}${campo("fantasia", "Nome fantasia")}${campo("cnpj", "CNPJ")}${campo("telefone", "Telefone")}${campo("email", "E-mail")}${campo("whatsapp", "WhatsApp (com DDI e DDD, só números)")}
     <div style="grid-column:1/-1">${campo("endereco", "Endereço completo")}</div>${campo("responsavel", "Responsável / vendedor padrão")}${campo("validade_padrao", "Validade padrão (dias)", 'type="number" min="1"')}</div>
   <div data-p="visual" class="grid g2" hidden>
     <div><label for="e_cor_primaria">Cor principal</label><input type="color" id="e_cor_primaria" value="${esc(e.cor_primaria || "#0d3442")}" style="height:42px"></div>
     <div><label for="e_cor_destaque">Cor de destaque</label><input type="color" id="e_cor_destaque" value="${esc(e.cor_destaque || "#14c8dc")}" style="height:42px"></div>
     <div style="grid-column:1/-1"><label for="e_logo">Logo (PNG/JPG/SVG)</label><div class="row"><div class="logo" id="lp" style="background:#eee">${logo ? `<img src="${esc(logo)}" alt="">` : ""}</div><input type="file" id="e_logo" accept="image/*" style="width:auto"><button type="button" class="btn sm" id="lx">Remover</button></div></div>
     <div style="grid-column:1/-1"><label for="e_missao">Texto de apresentação</label><textarea id="e_missao" rows="3">${esc(e.missao || "")}</textarea></div>
     <div style="grid-column:1/-1"><label for="e_dest">Destaques — um por linha, no formato “Título | Descrição”</label><textarea id="e_dest" rows="4">${esc(dest)}</textarea></div></div>
   <div data-p="cond" hidden><p class="hint">Entram automaticamente em toda nova proposta desta empresa (dá para mudar em cada uma).</p><div id="ec"></div><button type="button" class="btn sm" id="ecAdd">+ Condição</button></div>
   <div data-p="bling" class="grid" hidden>
     <p class="hint" style="margin:0">1. No Bling, vá em <b>Preferências › Sistema › Cadastro de aplicativos</b> e crie um aplicativo com os escopos de <b>Contatos</b> e <b>Produtos</b> (leitura).<br>
     2. Em “Link de redirecionamento”, coloque:</p><div class="mono">${location.origin}/bling/callback</div>
     <p class="hint" style="margin:0">3. Copie o Client ID e o Client Secret para cá, salve e clique em Conectar.</p>
     <div class="grid g2">${campo("bling_client_id", "Client ID")}<div><label for="e_bling_client_secret">Client Secret</label><input id="e_bling_client_secret" type="password" placeholder="${e.bling_tem_secret ? "•••••• (salvo — deixe vazio para manter)" : ""}"></div></div>
     ${e.id ? `<div class="row">${e.bling_conectado ? `<b style="color:var(--ok)">Conectado</b><button type="button" class="btn sm" id="bDesc">Desconectar</button>` : ""}<button type="button" class="btn sm acc" id="bCon">${e.bling_conectado ? "Reconectar" : "Salvar e conectar ao Bling"}</button></div>` : `<p class="hint">Salve a empresa primeiro para conectar.</p>`}
   </div>
   <div class="row" style="justify-content:space-between;margin-top:18px">${e.id ? `<button type="button" class="btn red" id="eDel">Excluir</button>` : "<span></span>"}<div class="row"><button type="button" class="btn" data-close>Cancelar</button><button class="btn pri">Salvar</button></div></div>
  </form>`, () => {
    $$(".tabs button", DLG).forEach((b) => (b.onclick = () => { $$(".tabs button", DLG).forEach((x) => x.classList.toggle("on", x === b)); $$("[data-p]", DLG).forEach((p) => (p.hidden = p.dataset.p !== b.dataset.t)); }));
    const rc = () => { $("#ec").innerHTML = conds.map(([t, d], i) => `<div class="cond" data-i="${i}"><input data-c="0" value="${esc(t)}" placeholder="Título"><textarea data-c="1" rows="2">${esc(d)}</textarea><button type="button" class="btn sm red" data-rc="${i}">✕</button></div>`).join("");
      $$("#ec [data-c]").forEach((el) => (el.onchange = () => (conds[el.closest(".cond").dataset.i][el.dataset.c] = el.value)));
      $$("#ec [data-rc]").forEach((b) => (b.onclick = () => { conds.splice(+b.dataset.rc, 1); rc(); })); };
    rc(); $("#ecAdd").onclick = () => { conds.push(["", ""]); rc(); };
    $("#e_logo").onchange = (ev) => { const f = ev.target.files[0]; if (!f) return; const rd = new FileReader();
      rd.onload = () => { if (f.type === "image/svg+xml") { logo = rd.result; $("#lp").innerHTML = `<img src="${logo}" alt="">`; return; }
        const img = new Image(); img.onload = () => { const s = Math.min(1, 400 / img.width, 400 / img.height), c = document.createElement("canvas"); c.width = img.width * s; c.height = img.height * s;
          c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); logo = c.toDataURL("image/png"); $("#lp").innerHTML = `<img src="${logo}" alt="">`; }; img.src = rd.result; };
      rd.readAsDataURL(f); };
    $("#lx").onclick = () => { logo = ""; $("#lp").innerHTML = ""; };
    const dados = () => { const d = { logo, condicoes_padrao: conds.filter(([t, x]) => t || x) };
      ["nome", "fantasia", "cnpj", "telefone", "email", "whatsapp", "endereco", "responsavel", "validade_padrao", "cor_primaria", "cor_destaque", "missao", "bling_client_id", "bling_client_secret"].forEach((k) => (d[k] = $("#e_" + k).value));
      d.validade_padrao = +d.validade_padrao || 7;
      d.destaques = $("#e_dest").value.split("\n").map((l) => l.split("|").map((s) => s.trim())).filter((x) => x[0]).map(([t, x]) => [t, x || ""]);
      return d; };
    const salvar = async () => { if (!$("#e_nome").value) throw new Error("Informe a razão social (aba Dados)."); const r = await api(e.id ? "PUT" : "POST", e.id ? "/api/empresas/" + e.id : "/api/empresas", dados());
      await carregarEmpresas(); if (!empSel()) localStorage.setItem("emp", r.id); return r; };
    $("#fe").onsubmit = run(async (ev) => { ev.preventDefault(); await salvar(); DLG.close(); toast("Empresa salva"); empresas(new URLSearchParams()); });
    if ($("#bCon")) $("#bCon").onclick = run(async () => { await salvar(); const r = await api("GET", `/api/empresas/${e.id}/bling/conectar`); location.href = r.url; });
    if ($("#bDesc")) $("#bDesc").onclick = run(async () => { await api("POST", `/api/empresas/${e.id}/bling/desconectar`); DLG.close(); empresas(new URLSearchParams()); });
    if ($("#eDel")) $("#eDel").onclick = () => { if ($("#eDel").dataset.ok) return run(async () => { await api("DELETE", "/api/empresas/" + e.id); localStorage.removeItem("emp"); DLG.close(); await carregarEmpresas(); empresas(new URLSearchParams()); })();
      $("#eDel").dataset.ok = 1; $("#eDel").textContent = "Clique de novo: apaga empresa, clientes, produtos e propostas"; };
  });
}

rota();
}
