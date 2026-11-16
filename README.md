# Propostas 3D — propostas comerciais multiempresa com Bling

Sistema para criar, enviar e acompanhar propostas comerciais de várias empresas, com:

- **Painel**: propostas do mês, em aberto, valores aceitos (únicos e mensais), taxa de aceite, gráfico de 6 meses.
- **Várias empresas**: cada uma com seus dados, logo, cores, textos de apresentação, condições padrão, numeração própria e conexão própria com o Bling.
- **Bling (API v3 / OAuth 2.0)**: importa **clientes** (contatos) e **produtos** de cada empresa. O e-mail e o endereço completos do cliente são buscados no Bling quando você escolhe o cliente numa proposta.
- **Propostas**: itens com cobrança **única** ou **mensal**, desconto por item, frete, condições, duplicar, status.
- **Link público** `/p/<token>` (como o da Scaller): o cliente vê a proposta, **aceita ou recusa** (fica registrado nome, data/hora e IP), manda **mensagens**, e baixa em **PDF** (impressão do navegador).

## Rodar no Railway

1. Suba esta pasta num repositório do GitHub e crie um serviço no Railway a partir dele.
2. Adicione um banco **PostgreSQL** no mesmo projeto (ou use o que você já tem).
3. Nas variáveis do serviço, configure:

| Variável | Exemplo |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `APP_URL` | `https://propostas.3dfibra.com.br` (endereço público, sem barra no final) |
| `ADMIN_USER` | `anderson` |
| `ADMIN_PASSWORD` | uma senha forte |
| `SESSION_SECRET` | texto aleatório longo (ex.: `openssl rand -hex 32`) |
| `PGSSL` | `true` só se o banco exigir SSL (o interno do Railway não exige) |

4. Deploy. As tabelas são criadas sozinhas na primeira execução. Acesse `APP_URL/login`.

Rodar local: `npm install` e `DATABASE_URL=postgres://... ADMIN_PASSWORD=... node server.js` (porta 3000).

## Conectar uma empresa ao Bling

1. No Bling da empresa: **Preferências › Sistema › Cadastro de aplicativos** → novo aplicativo.
2. Escopos: **Contatos** e **Produtos** (leitura).
3. Link de redirecionamento: `APP_URL/bling/callback` (o painel mostra o endereço exato).
4. No painel: **Empresas › Editar › Bling**, cole Client ID e Client Secret e clique em **Salvar e conectar**. Autorize no Bling.
5. Clique em **Sincronizar Bling** (na empresa, em Clientes ou em Produtos). Pode repetir quando quiser: atualiza sem duplicar.

Cada empresa usa o seu próprio aplicativo Bling. O token é renovado automaticamente.

**Dica para provedor:** depois de importar os produtos, edite os planos e marque a cobrança como **Mensal**. Assim eles entram como mensalidade nas propostas, e a sincronização não sobrescreve essa marcação.

## Estrutura

```
server.js        rotas, login, API, link público
db.js            conexão e criação das tabelas
bling.js         OAuth, renovação de token, sincronização
public/app.*     painel (HTML/CSS/JS puro, sem build)
public/proposta.html  página pública da proposta
```
