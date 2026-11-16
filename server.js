const express = require("express");
const crypto = require("crypto");
const path = require("path");
const { q, migrate, pool } = require("./db");
const bling = require("./bling");

const PORT = process.env.PORT || 3000;
const APP_URL = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const SECRET = process.env.SESSION_SECRET || "troque-este-segredo";
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

const app = express();
app.set("trust proxy", true);
app.use(express.json({ limit: "3mb" }));
const PUB = path.join(__dirname, "public");

/* ---------- sessão (cookie assinado) ---------- */
const sign = (v) => crypto.createHmac("sha256", SECRET).update(v).digest("base64url");
const cookies = (req) => Object.fromEntries((req.headers.cookie || "").split(";").filter(Boolean).map((c) => {
  const i = c.indexOf("="); return [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1))];
}));
function sessao(req) {
  const s = cookies(req).sid; if (!s) return null;
  const [v, h] = s.split("."); if (!v || !h) return null;
  const a = Buffer.from(sign(v)), b = Buffer.from(h);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const [user, exp] = Buffer.from(v, "base64url").toString().split("|");
  return Number(exp) > Date.now() ? user : null;
}
const auth = (req, res, next) => (sessao(req) ? next() : res.status(401).json({ erro: "Não autenticado" }));
const wrap = (fn) => (req, res) => fn(req, res).catch((e) => { console.error(e); res.status(500).json({ erro: e.message }); });
const igual = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

app.post("/api/login", (req, res) => {
  const { usuario, senha } = req.body || {};
  if (!ADMIN_PASSWORD) return res.status(503).json({ erro: "Defina a variável ADMIN_PASSWORD no servidor para liberar o login." });
  if (!igual(usuario || "", ADMIN_USER) || !igual(senha || "", ADMIN_PASSWORD)) return res.status(401).json({ erro: "Usuário ou senha inválidos" });
  const v = Buffer.from(`${usuario}|${Date.now() + 7 * 864e5}`).toString("base64url");
  const secure = APP_URL.startsWith("https") ? "; Secure" : "";
  res.setHeader("Set-Cookie", `sid=${v}.${sign(v)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800${secure}`);
  res.json({ ok: true });
});
app.post("/api/logout", (req, res) => { res.setHeader("Set-Cookie", "sid=; Path=/; Max-Age=0"); res.json({ ok: true }); });

/* ---------- páginas ---------- */
app.get("/", (req, res) => res.redirect(sessao(req) ? "/app" : "/login"));
app.get("/login", (req, res) => res.sendFile(path.join(PUB, "login.html")));
app.get("/app", (req, res) => (sessao(req) ? res.sendFile(path.join(PUB, "app.html")) : res.redirect("/login")));
app.get("/p/:token", (req, res) => res.sendFile(path.join(PUB, "proposta.html")));
app.use("/assets", express.static(PUB));

/* ---------- helpers ---------- */
const num = (v) => (v === "" || v == null || isNaN(Number(v)) ? 0 : Number(v));
const nulo = (v) => (v === "" || v === undefined ? null : v);
const EMP_CAMPOS = ["nome", "fantasia", "cnpj", "telefone", "email", "endereco", "responsavel", "whatsapp", "cor_primaria",
  "cor_destaque", "logo", "missao", "destaques", "condicoes_padrao", "validade_padrao", "bling_client_id", "bling_client_secret"];
const empPublica = (e) => {
  const { bling_client_secret, bling_access_token, bling_refresh_token, ...r } = e;
  return { ...r, bling_conectado: !!bling_refresh_token, bling_tem_secret: !!bling_client_secret };
};
async function empresa(id) { const { rows } = await q("SELECT * FROM empresas WHERE id=$1", [id]); return rows[0]; }
const expirada = (p) => !["aceita", "recusada"].includes(p.status) &&
  new Date(p.data).getTime() + (p.validade_dias + 1) * 864e5 < Date.now();

/* ---------- empresas ---------- */
app.get("/api/empresas", auth, wrap(async (req, res) => {
  const { rows } = await q(`SELECT e.*, (SELECT count(*) FROM clientes c WHERE c.empresa_id=e.id)::int AS n_clientes,
    (SELECT count(*) FROM produtos p WHERE p.empresa_id=e.id)::int AS n_produtos FROM empresas e ORDER BY e.id`);
  res.json(rows.map(empPublica));
}));
app.post("/api/empresas", auth, wrap(async (req, res) => {
  const b = req.body, cols = EMP_CAMPOS.filter((c) => b[c] !== undefined);
  if (!b.nome) return res.status(400).json({ erro: "Informe o nome" });
  const vals = cols.map((c) => (["destaques", "condicoes_padrao"].includes(c) ? JSON.stringify(b[c]) : nulo(b[c])));
  const { rows } = await q(`INSERT INTO empresas (${cols}) VALUES (${cols.map((_, i) => "$" + (i + 1))}) RETURNING *`, vals);
  res.json(empPublica(rows[0]));
}));
app.put("/api/empresas/:id", auth, wrap(async (req, res) => {
  const b = req.body, cols = EMP_CAMPOS.filter((c) => b[c] !== undefined && !(c === "bling_client_secret" && !b[c]));
  const vals = cols.map((c) => (["destaques", "condicoes_padrao"].includes(c) ? JSON.stringify(b[c]) : nulo(b[c])));
  if (cols.length) await q(`UPDATE empresas SET ${cols.map((c, i) => `${c}=$${i + 1}`)} WHERE id=$${cols.length + 1}`, [...vals, req.params.id]);
  res.json(empPublica(await empresa(req.params.id)));
}));
app.delete("/api/empresas/:id", auth, wrap(async (req, res) => { await q("DELETE FROM empresas WHERE id=$1", [req.params.id]); res.json({ ok: true }); }));

/* ---------- Bling ---------- */
app.get("/api/empresas/:id/bling/conectar", auth, wrap(async (req, res) => {
  const e = await empresa(req.params.id);
  if (!e?.bling_client_id || !e.bling_client_secret) return res.status(400).json({ erro: "Cadastre o Client ID e o Client Secret do aplicativo Bling desta empresa." });
  const v = `${e.id}.${Date.now()}`;
  res.json({ url: bling.authorizeUrl(e, `${v}.${sign(v).slice(0, 16)}`), callback: `${APP_URL}/bling/callback` });
}));
app.get("/bling/callback", wrap(async (req, res) => {
  const [id, ts, h] = String(req.query.state || "").split(".");
  if (!h || sign(`${id}.${ts}`).slice(0, 16) !== h || Date.now() - Number(ts) > 15 * 6e4) return res.status(400).send("Estado inválido ou expirado. Tente conectar de novo.");
  if (!req.query.code) return res.status(400).send("Autorização negada no Bling.");
  const e = await empresa(id);
  await bling.exchangeCode(e, req.query.code);
  res.redirect("/app#/empresas?bling=ok");
}));
app.post("/api/empresas/:id/bling/desconectar", auth, wrap(async (req, res) => {
  await q("UPDATE empresas SET bling_access_token=NULL, bling_refresh_token=NULL, bling_expires_at=NULL WHERE id=$1", [req.params.id]);
  res.json({ ok: true });
}));
const sincronizando = new Set();
app.post("/api/empresas/:id/bling/sync", auth, wrap(async (req, res) => {
  const id = req.params.id, o = req.body || {};
  if (sincronizando.has(id)) return res.status(409).json({ erro: "Já existe uma sincronização em andamento para esta empresa." });
  sincronizando.add(id);
  try {
    const e = await empresa(id), r = {};
    if (o.clientes !== false) r.clientes = await bling.syncClientes(e);
    if (o.produtos !== false) r.produtos = await bling.syncProdutos(e);
    await q("UPDATE empresas SET bling_sync_em=now() WHERE id=$1", [id]);
    res.json(r);
  } finally { sincronizando.delete(id); }
}));

/* ---------- clientes e produtos ---------- */
function crud(tabela, campos) {
  app.get(`/api/${tabela}`, auth, wrap(async (req, res) => {
    const p = [req.query.empresa_id], busca = (req.query.busca || "").trim();
    let w = "empresa_id=$1";
    if (busca) { p.push(`%${busca}%`); w += ` AND (nome ILIKE $2 OR coalesce(${tabela === "clientes" ? "documento" : "codigo"},'') ILIKE $2)`; }
    if (req.query.ativos) w += " AND ativo";
    const { rows } = await q(`SELECT * FROM ${tabela} WHERE ${w} ORDER BY nome LIMIT ${Math.min(Number(req.query.limite) || 300, 2000)}`, p);
    res.json(rows);
  }));
  app.post(`/api/${tabela}`, auth, wrap(async (req, res) => {
    const b = req.body, cols = ["empresa_id", ...campos.filter((c) => b[c] !== undefined)];
    if (!b.nome || !b.empresa_id) return res.status(400).json({ erro: "Informe nome e empresa" });
    const { rows } = await q(`INSERT INTO ${tabela} (${cols}) VALUES (${cols.map((_, i) => "$" + (i + 1))}) RETURNING *`, cols.map((c) => nulo(b[c])));
    res.json(rows[0]);
  }));
  app.put(`/api/${tabela}/:id`, auth, wrap(async (req, res) => {
    const b = req.body, cols = campos.filter((c) => b[c] !== undefined);
    const { rows } = await q(`UPDATE ${tabela} SET ${cols.map((c, i) => `${c}=$${i + 1}`)} WHERE id=$${cols.length + 1} RETURNING *`, [...cols.map((c) => nulo(b[c])), req.params.id]);
    res.json(rows[0]);
  }));
  app.delete(`/api/${tabela}/:id`, auth, wrap(async (req, res) => { await q(`DELETE FROM ${tabela} WHERE id=$1`, [req.params.id]); res.json({ ok: true }); }));
}
crud("clientes", ["nome", "documento", "email", "telefone", "endereco", "cidade", "uf", "cep", "contato", "ativo"]);
crud("produtos", ["codigo", "nome", "preco", "unidade", "tipo_cobranca", "ativo"]);

app.post("/api/clientes/:id/detalhar", auth, wrap(async (req, res) => {
  const { rows: [c] } = await q("SELECT * FROM clientes WHERE id=$1", [req.params.id]);
  if (c?.bling_id) await bling.detalharCliente(await empresa(c.empresa_id), c);
  const { rows } = await q("SELECT * FROM clientes WHERE id=$1", [req.params.id]);
  res.json(rows[0]);
}));

/* ---------- propostas ---------- */
const LISTA = `SELECT p.*, c.nome AS cliente_nome, e.fantasia, e.nome AS empresa_nome, e.cor_destaque,
  (SELECT count(*) FROM mensagens m WHERE m.proposta_id=p.id AND m.autor='cliente' AND NOT m.lida)::int AS msgs_novas
  FROM propostas p JOIN empresas e ON e.id=p.empresa_id LEFT JOIN clientes c ON c.id=p.cliente_id`;
const comExp = (p) => ({ ...p, expirada: expirada(p) });

app.get("/api/propostas", auth, wrap(async (req, res) => {
  const p = [], w = [];
  if (req.query.empresa_id) { p.push(req.query.empresa_id); w.push(`p.empresa_id=$${p.length}`); }
  if (req.query.status) { p.push(req.query.status); w.push(`p.status=$${p.length}`); }
  if (req.query.busca) { p.push(`%${req.query.busca}%`); w.push(`(c.nome ILIKE $${p.length} OR p.titulo ILIKE $${p.length} OR p.numero::text=$${p.length + 1})`); p.push(req.query.busca); }
  const { rows } = await q(`${LISTA} ${w.length ? "WHERE " + w.join(" AND ") : ""} ORDER BY p.created_at DESC LIMIT 500`, p);
  res.json(rows.map(comExp));
}));

app.get("/api/resumo", auth, wrap(async (req, res) => {
  const p = [], f = req.query.empresa_id ? (p.push(req.query.empresa_id), "AND empresa_id=$1") : "";
  const { rows: [r] } = await q(`SELECT
    count(*) FILTER (WHERE created_at >= date_trunc('month', now()))::int AS mes,
    count(*) FILTER (WHERE status IN ('enviada','visualizada'))::int AS abertas,
    count(*) FILTER (WHERE status='aceita')::int AS aceitas,
    count(*) FILTER (WHERE status='recusada')::int AS recusadas,
    coalesce(sum(total_unico) FILTER (WHERE status='aceita' AND resposta_em >= date_trunc('month', now())),0) AS aceito_unico_mes,
    coalesce(sum(total_mensal) FILTER (WHERE status='aceita' AND resposta_em >= date_trunc('month', now())),0) AS aceito_mensal_mes,
    coalesce(sum(total_unico) FILTER (WHERE status IN ('enviada','visualizada')),0) AS aberto_unico,
    coalesce(sum(total_mensal) FILTER (WHERE status IN ('enviada','visualizada')),0) AS aberto_mensal
    FROM propostas WHERE true ${f}`, p);
  const { rows: meses } = await q(`SELECT to_char(date_trunc('month', created_at),'YYYY-MM') AS mes,
    count(*)::int AS total, count(*) FILTER (WHERE status='aceita')::int AS aceitas
    FROM propostas WHERE created_at >= date_trunc('month', now()) - interval '5 months' ${f}
    GROUP BY 1 ORDER BY 1`, p);
  res.json({ ...r, meses });
}));

async function carregar(where, param) {
  const { rows: [p] } = await q(`${LISTA} WHERE ${where}`, [param]);
  if (!p) return null;
  const [{ rows: itens }, { rows: mensagens }, { rows: [cliente] }] = await Promise.all([
    q("SELECT * FROM proposta_itens WHERE proposta_id=$1 ORDER BY ordem, id", [p.id]),
    q("SELECT * FROM mensagens WHERE proposta_id=$1 ORDER BY created_at", [p.id]),
    q("SELECT * FROM clientes WHERE id=$1", [p.cliente_id]),
  ]);
  return { ...comExp(p), itens, mensagens, cliente: cliente || null };
}

app.get("/api/propostas/:id", auth, wrap(async (req, res) => {
  const p = await carregar("p.id=$1", req.params.id);
  if (!p) return res.status(404).json({ erro: "Proposta não encontrada" });
  await q("UPDATE mensagens SET lida=true WHERE proposta_id=$1 AND autor='cliente'", [p.id]);
  res.json(p);
}));

async function salvarItens(client, id, itens = []) {
  await client.query("DELETE FROM proposta_itens WHERE proposta_id=$1", [id]);
  let unico = 0, mensal = 0;
  for (const [i, it] of itens.entries()) {
    if (!it.descricao) continue;
    const t = num(it.qtd) * num(it.unit) * (1 - num(it.desconto_pct) / 100);
    it.tipo === "mensal" ? (mensal += t) : (unico += t);
    await client.query(`INSERT INTO proposta_itens (proposta_id,ordem,produto_id,codigo,descricao,tipo,qtd,unit,desconto_pct)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [id, i, nulo(it.produto_id), nulo(it.codigo), it.descricao, it.tipo === "mensal" ? "mensal" : "unico", num(it.qtd), num(it.unit), num(it.desconto_pct)]);
  }
  return { unico, mensal };
}

async function salvar(req, res, id) {
  const b = req.body, client = await pool.connect();
  try {
    await client.query("BEGIN");
    const campos = [nulo(b.cliente_id), b.titulo || "", b.subtitulo || "", b.vendedor || "", b.data || new Date().toISOString().slice(0, 10),
      num(b.validade_dias) || 7, num(b.frete), JSON.stringify(b.condicoes || [])];
    if (!id) {
      const { rows: [e] } = await client.query("UPDATE empresas SET proximo_numero=proximo_numero+1 WHERE id=$1 RETURNING proximo_numero-1 AS n", [b.empresa_id]);
      if (!e) throw new Error("Empresa inválida");
      const { rows: [p] } = await client.query(`INSERT INTO propostas (empresa_id,numero,token,cliente_id,titulo,subtitulo,vendedor,data,validade_dias,frete,condicoes)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`, [b.empresa_id, e.n, crypto.randomBytes(12).toString("hex").toUpperCase(), ...campos]);
      id = p.id;
    } else {
      await client.query(`UPDATE propostas SET cliente_id=$1,titulo=$2,subtitulo=$3,vendedor=$4,data=$5,validade_dias=$6,frete=$7,condicoes=$8,updated_at=now() WHERE id=$9`, [...campos, id]);
    }
    const t = await salvarItens(client, id, b.itens);
    await client.query("UPDATE propostas SET total_unico=$1, total_mensal=$2 WHERE id=$3", [t.unico + num(b.frete), t.mensal, id]);
    await client.query("COMMIT");
  } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
  res.json(await carregar("p.id=$1", id));
}
app.post("/api/propostas", auth, wrap((req, res) => salvar(req, res, null)));
app.put("/api/propostas/:id", auth, wrap((req, res) => salvar(req, res, req.params.id)));
app.delete("/api/propostas/:id", auth, wrap(async (req, res) => { await q("DELETE FROM propostas WHERE id=$1", [req.params.id]); res.json({ ok: true }); }));

app.post("/api/propostas/:id/status", auth, wrap(async (req, res) => {
  const s = req.body.status;
  if (!["rascunho", "enviada", "aceita", "recusada"].includes(s)) return res.status(400).json({ erro: "Status inválido" });
  const extra = ["aceita", "recusada"].includes(s) ? ", resposta_em=coalesce(resposta_em, now()), resposta_nome=coalesce(resposta_nome,'(registrado no painel)')" : s === "enviada" || s === "rascunho" ? ", resposta_em=NULL, resposta_nome=NULL, resposta_motivo=NULL" : "";
  await q(`UPDATE propostas SET status=$1 ${extra}, updated_at=now() WHERE id=$2`, [s, req.params.id]);
  res.json(await carregar("p.id=$1", req.params.id));
}));
app.post("/api/propostas/:id/duplicar", auth, wrap(async (req, res) => {
  const p = await carregar("p.id=$1", req.params.id);
  req.body = { ...p, data: new Date().toISOString().slice(0, 10), itens: p.itens };
  return salvar(req, res, null);
}));
app.post("/api/propostas/:id/mensagens", auth, wrap(async (req, res) => {
  if (!req.body.texto) return res.status(400).json({ erro: "Mensagem vazia" });
  const { rows: [p] } = await q("SELECT e.fantasia, e.nome FROM propostas p JOIN empresas e ON e.id=p.empresa_id WHERE p.id=$1", [req.params.id]);
  await q("INSERT INTO mensagens (proposta_id,autor,nome,texto,lida) VALUES ($1,'empresa',$2,$3,true)", [req.params.id, p.fantasia || p.nome, req.body.texto]);
  res.json((await carregar("p.id=$1", req.params.id)).mensagens);
}));

/* ---------- link público ---------- */
async function publica(token) {
  const p = await carregar("p.token=$1", token);
  if (!p || p.status === "rascunho") return null;
  const e = empPublica(await empresa(p.empresa_id));
  ["bling_client_id", "bling_expires_at", "bling_sync_em", "proximo_numero", "condicoes_padrao", "n_clientes"].forEach((k) => delete e[k]);
  const { resposta_ip, cliente_id, ...resto } = p;
  return { ...resto, empresa: e };
}
app.get("/api/public/:token", wrap(async (req, res) => {
  const p = await publica(req.params.token);
  if (!p) return res.status(404).json({ erro: "Proposta não encontrada" });
  if (!p.visualizada_em) await q("UPDATE propostas SET visualizada_em=now(), status=CASE WHEN status='enviada' THEN 'visualizada' ELSE status END WHERE id=$1", [p.id]);
  res.json(p);
}));
app.post("/api/public/:token/responder", wrap(async (req, res) => {
  const p = await publica(req.params.token), { acao, nome, motivo } = req.body || {};
  if (!p) return res.status(404).json({ erro: "Proposta não encontrada" });
  if (["aceita", "recusada"].includes(p.status)) return res.status(409).json({ erro: "Esta proposta já foi respondida." });
  if (p.expirada) return res.status(410).json({ erro: "Esta proposta expirou. Fale com a empresa para receber uma nova." });
  if (!["aceita", "recusada"].includes(acao) || !String(nome || "").trim()) return res.status(400).json({ erro: "Informe seu nome." });
  await q("UPDATE propostas SET status=$1, resposta_nome=$2, resposta_motivo=$3, resposta_ip=$4, resposta_em=now() WHERE id=$5",
    [acao, String(nome).slice(0, 120), String(motivo || "").slice(0, 1000) || null, req.ip, p.id]);
  res.json(await publica(req.params.token));
}));
app.post("/api/public/:token/mensagens", wrap(async (req, res) => {
  const p = await publica(req.params.token), { nome, texto } = req.body || {};
  if (!p) return res.status(404).json({ erro: "Proposta não encontrada" });
  if (!String(texto || "").trim()) return res.status(400).json({ erro: "Mensagem vazia" });
  await q("INSERT INTO mensagens (proposta_id,autor,nome,texto) VALUES ($1,'cliente',$2,$3)", [p.id, String(nome || "Cliente").slice(0, 120), String(texto).slice(0, 2000)]);
  res.json((await publica(req.params.token)).mensagens);
}));

migrate().then(() => app.listen(PORT, () => console.log(`Propostas rodando em ${APP_URL}`)))
  .catch((e) => { console.error("Falha ao iniciar:", e); process.exit(1); });
