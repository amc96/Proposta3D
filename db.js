const { Pool, types } = require("pg");
types.setTypeParser(1082, (v) => v); // DATE como texto (evita mudança de fuso)

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : false,
});

const q = (text, params) => pool.query(text, params);

async function migrate() {
  await q(`
  CREATE TABLE IF NOT EXISTS empresas (
    id SERIAL PRIMARY KEY,
    nome TEXT NOT NULL,
    fantasia TEXT,
    cnpj TEXT,
    telefone TEXT,
    email TEXT,
    endereco TEXT,
    responsavel TEXT,
    whatsapp TEXT,
    cor_primaria TEXT DEFAULT '#0d3442',
    cor_destaque TEXT DEFAULT '#14c8dc',
    logo TEXT,
    missao TEXT,
    destaques JSONB DEFAULT '[]',
    condicoes_padrao JSONB DEFAULT '[]',
    validade_padrao INT DEFAULT 7,
    bling_client_id TEXT,
    bling_client_secret TEXT,
    bling_access_token TEXT,
    bling_refresh_token TEXT,
    bling_expires_at TIMESTAMPTZ,
    bling_sync_em TIMESTAMPTZ,
    proximo_numero INT DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS clientes (
    id SERIAL PRIMARY KEY,
    empresa_id INT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    bling_id BIGINT,
    nome TEXT NOT NULL,
    documento TEXT,
    email TEXT,
    telefone TEXT,
    endereco TEXT,
    cidade TEXT,
    uf TEXT,
    cep TEXT,
    contato TEXT,
    detalhado BOOLEAN DEFAULT false,
    ativo BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (empresa_id, bling_id)
  );
  CREATE TABLE IF NOT EXISTS produtos (
    id SERIAL PRIMARY KEY,
    empresa_id INT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    bling_id BIGINT,
    codigo TEXT,
    nome TEXT NOT NULL,
    preco NUMERIC(14,2) DEFAULT 0,
    unidade TEXT,
    tipo_cobranca TEXT DEFAULT 'unico',
    ativo BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (empresa_id, bling_id)
  );
  CREATE TABLE IF NOT EXISTS propostas (
    id SERIAL PRIMARY KEY,
    empresa_id INT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    cliente_id INT REFERENCES clientes(id) ON DELETE SET NULL,
    numero INT NOT NULL,
    token TEXT UNIQUE NOT NULL,
    titulo TEXT,
    subtitulo TEXT,
    vendedor TEXT,
    data DATE DEFAULT CURRENT_DATE,
    validade_dias INT DEFAULT 7,
    frete NUMERIC(14,2) DEFAULT 0,
    condicoes JSONB DEFAULT '[]',
    status TEXT DEFAULT 'rascunho',
    total_unico NUMERIC(14,2) DEFAULT 0,
    total_mensal NUMERIC(14,2) DEFAULT 0,
    visualizada_em TIMESTAMPTZ,
    resposta_nome TEXT,
    resposta_motivo TEXT,
    resposta_ip TEXT,
    resposta_em TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS proposta_itens (
    id SERIAL PRIMARY KEY,
    proposta_id INT NOT NULL REFERENCES propostas(id) ON DELETE CASCADE,
    ordem INT DEFAULT 0,
    produto_id INT REFERENCES produtos(id) ON DELETE SET NULL,
    codigo TEXT,
    descricao TEXT NOT NULL,
    tipo TEXT DEFAULT 'unico',
    qtd NUMERIC(14,3) DEFAULT 1,
    unit NUMERIC(14,2) DEFAULT 0,
    desconto_pct NUMERIC(6,2) DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS mensagens (
    id SERIAL PRIMARY KEY,
    proposta_id INT NOT NULL REFERENCES propostas(id) ON DELETE CASCADE,
    autor TEXT NOT NULL,
    nome TEXT,
    texto TEXT NOT NULL,
    lida BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_clientes_emp ON clientes(empresa_id);
  CREATE INDEX IF NOT EXISTS idx_produtos_emp ON produtos(empresa_id);
  CREATE INDEX IF NOT EXISTS idx_propostas_emp ON propostas(empresa_id);
  `);
}

module.exports = { pool, q, migrate };
