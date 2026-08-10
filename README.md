# Controle de Processos

Registro de abertura, vistoria e endereçamento de processos — equipe de
pavimentação/obra civil, Niterói-RJ.

Site estático simples (HTML + CSS + JS puro, sem build tool). Backend:
Supabase (Postgres + Auth), acessado direto do navegador via REST.

## Rodando localmente

Não precisa de `npm install` nem servidor especial — é HTML estático puro.
Duas opções:

```bash
# opção 1: Python já vem em quase todo sistema
python3 -m http.server 8080
# depois abra http://localhost:8080

# opção 2: extensão "Live Server" do VS Code, clicando com o botão
# direito em index.html
```

Abrir o `index.html` direto no navegador (`file://`) também funciona na
maior parte do tempo, mas alguns navegadores bloqueiam certas chamadas de
rede nesse modo — prefira servir por http quando for testar algo que mexe
com o Supabase.

## Estrutura

```
index.html    estrutura da página, sem estilo nem lógica inline
style.css     todo o CSS (tema padrão + tema "capitão noturno" do Admin)
script.js     toda a lógica: auth, CRUD de registros, filtros, gráficos,
              mapa, importação/exportação CSV, chamados, anotações,
              notificações, ferramentas de Admin
```

Prefixos de nome de função em `script.js` seguem o domínio (ex:
`carregarChamados`, `abrirAnotacoes`, `verificarAviso`) — é grande, mas
não é bagunçado; é um arquivo por natureza da decisão de não usar build
tool, não por falta de organização interna.

## Deploy

O site é publicado na Vercel como projeto estático:

1. Commit e push pra branch `main`
2. Se o repositório estiver conectado à Vercel, o deploy é automático
3. Se estiver subindo manualmente: arraste `index.html`, `style.css` e
   `script.js` pro painel da Vercel (não precisa mais renomear nada — antes
   o arquivo se chamava `controle-processos.html` e precisava virar
   `index.html` na hora do deploy; agora ele já nasce com esse nome)

## Banco de dados (Supabase)

A URL e a chave anônima do Supabase estão hardcoded no topo do
`script.js`. Isso é intencional, não um descuido: a anon key do Supabase é
uma chave pública por design, protegida por Row Level Security no banco —
não é um segredo que precise de variável de ambiente.

Mudanças de schema (novas tabelas, policies, colunas) são aplicadas
direto no SQL Editor do Supabase e não ficam versionadas neste
repositório ainda. Se o histórico de mudanças de banco começar a importar
(auditoria, rollback), vale criar uma pasta `sql/` com os scripts
numerados — não faz parte deste commit porque não foi pedido, mas é uma
sugestão natural de próximo passo.

## Convenção de commits

Este repositório segue [Conventional Commits](https://www.conventionalcommits.org/pt-br/):

```
<tipo>: <descrição curta no imperativo>

[corpo opcional explicando o porquê, não só o quê]
```

Tipos usados neste projeto:

| Tipo | Quando usar |
|---|---|
| `feat` | uma funcionalidade nova pro usuário (ex: `feat: adicionar filtro por bairro`) |
| `fix` | correção de bug |
| `refactor` | muda a organização do código sem mudar comportamento |
| `style` | só visual/CSS, sem lógica |
| `chore` | manutenção (dependências, config, `.gitignore`) |
| `docs` | só documentação |

Regras práticas pra esse projeto:

- **Um commit, uma mudança lógica.** Se a mensagem tem "e" no meio
  ("adiciona filtro e corrige bug de data"), provavelmente devia ser dois
  commits.
- **Mudança de schema do Supabase e mudança de código andam juntas** na
  mesma mensagem de commit (ou em commits vizinhos, na mesma sessão) —
  senão o histórico do código fica sem sentido sem saber que tabela nova
  ele espera existir no banco.
- **Sempre validar antes de commitar**: sintaxe do `script.js` (dá pra
  rodar `node -e "require('fs'); new Function(require('fs').readFileSync('script.js','utf8'))"`
  pra pegar erro de sintaxe sem precisar abrir navegador), e checar no
  navegador antes de subir pra produção.
