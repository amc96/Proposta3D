// Integração com a API v3 do Bling (OAuth 2.0)
const { q } = require("./db");

const OAUTH = "https://www.bling.com.br/Api/v3/oauth";
const API = process.env.BLING_API_BASE || "https://api.bling.com.br/Api/v3";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function authorizeUrl(emp, state) {
  const p = new URLSearchParams({ response_type: "code", client_id: emp.bling_client_id, state });
  return `${OAUTH}/authorize?${p}`;
}

async function tokenRequest(emp, body) {
  const basic = Buffer.from(`${emp.bling_client_id}:${emp.bling_client_secret}`).toString("base64");
  const r = await fetch(`${OAUTH}/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "1.0",
    },
    body: new URLSearchParams(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    throw new Error("Bling OAuth: " + (j.error?.description || j.error_description || j.error?.message || r.status));
  }
  const exp = new Date(Date.now() + (j.expires_in || 21600) * 1000 - 60000);
  await q(
    `UPDATE empresas SET bling_access_token=$1, bling_refresh_token=$2, bling_expires_at=$3 WHERE id=$4`,
    [j.access_token, j.refresh_token, exp, emp.id]
  );
  emp.bling_access_token = j.access_token;
  emp.bling_refresh_token = j.refresh_token;
  emp.bling_expires_at = exp;
  return emp;
}

const exchangeCode = (emp, code) => tokenRequest(emp, { grant_type: "authorization_code", code });

async function ensureToken(emp) {
  if (!emp.bling_refresh_token) throw new Error("Empresa não está conectada ao Bling.");
  if (!emp.bling_access_token || new Date(emp.bling_expires_at) <= new Date()) {
    await tokenRequest(emp, { grant_type: "refresh_token", refresh_token: emp.bling_refresh_token });
  }
  return emp.bling_access_token;
}

// GET com renovação automática do token e respeito ao limite (3 req/s)
async function get(emp, path, params = {}, tentativa = 0) {
  const token = await ensureToken(emp);
  const url = `${API}${path}${Object.keys(params).length ? "?" + new URLSearchParams(params) : ""}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  if (r.status === 401 && tentativa === 0) {
    emp.bling_expires_at = new Date(0);
    return get(emp, path, params, 1);
  }
  if (r.status === 429 && tentativa < 5) {
    await sleep(1200);
    return get(emp, path, params, tentativa + 1);
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Bling ${path}: ${j.error?.description || j.error?.message || r.status}`);
  return j;
}

async function* paginar(emp, path, params = {}) {
  for (let pagina = 1; pagina < 1000; pagina++) {
    const j = await get(emp, path, { ...params, pagina, limite: 100 });
    const data = j.data || [];
    if (!data.length) return;
    yield data;
    if (data.length < 100) return;
    await sleep(380);
  }
}

const tel = (c) => c.celular || c.telefone || null;

async function syncClientes(emp) {
  let n = 0;
  for await (const lote of paginar(emp, "/contatos")) {
    for (const c of lote) {
      await q(
        `INSERT INTO clientes (empresa_id,bling_id,nome,documento,telefone,ativo)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (empresa_id,bling_id) DO UPDATE SET nome=EXCLUDED.nome, documento=EXCLUDED.documento,
           telefone=COALESCE(EXCLUDED.telefone, clientes.telefone), ativo=EXCLUDED.ativo`,
        [emp.id, c.id, c.nome || "(sem nome)", c.numeroDocumento || null, tel(c), c.situacao !== "I"]
      );
      n++;
    }
  }
  return n;
}

async function syncProdutos(emp) {
  let n = 0;
  for await (const lote of paginar(emp, "/produtos")) {
    for (const p of lote) {
      await q(
        `INSERT INTO produtos (empresa_id,bling_id,codigo,nome,preco,unidade,ativo)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (empresa_id,bling_id) DO UPDATE SET codigo=EXCLUDED.codigo, nome=EXCLUDED.nome,
           preco=EXCLUDED.preco, unidade=COALESCE(EXCLUDED.unidade, produtos.unidade), ativo=EXCLUDED.ativo`,
        [emp.id, p.id, p.codigo || null, p.nome || "(sem nome)", Number(p.preco) || 0, p.unidade || null, p.situacao !== "I"]
      );
      n++;
    }
  }
  return n;
}

// Busca e-mail e endereço completos de um contato (a listagem do Bling não traz)
async function detalharCliente(emp, cli) {
  const j = await get(emp, `/contatos/${cli.bling_id}`);
  const c = j.data || {};
  const g = c.endereco?.geral || {};
  const end = [g.endereco, g.numero, g.complemento, g.bairro].filter(Boolean).join(", ");
  await q(
    `UPDATE clientes SET nome=$1, documento=$2, email=$3, telefone=$4, endereco=$5, cidade=$6, uf=$7, cep=$8, detalhado=true WHERE id=$9`,
    [c.nome || cli.nome, c.numeroDocumento || cli.documento, c.email || null, tel(c) || cli.telefone,
     end || null, g.municipio || null, g.uf || null, g.cep || null, cli.id]
  );
}

module.exports = { authorizeUrl, exchangeCode, syncClientes, syncProdutos, detalharCliente };
