# Pro Tipster

Aplicação web em português de Portugal para uma sala privada de até cinco pessoas. A análise abrange Futebol, CS2 e VALORANT.

## Execução local

É necessário Node.js 24. A aplicação utiliza o SQLite incluído no Node.js e dispensa a instalação de pacotes. Abre um terminal nesta pasta.

Em PowerShell, cria uma conta por pessoa com uma palavra-passe distinta de 12 a 128 caracteres. Repete o bloco para os cinco nomes. O servidor limita a criação a cinco contas.

~~~powershell
$env:NEW_USER_PASSWORD = Read-Host 'Palavra-passe da conta' -MaskInput
node server.mjs add-user 'Diogo'
Remove-Item Env:NEW_USER_PASSWORD
~~~

Depois inicia o servidor.

~~~powershell
node server.mjs
~~~

Abre [Pro Tipster no computador](http://127.0.0.1:3000). A base de dados fica em tipster.sqlite, na pasta da aplicação, ou no caminho indicado em DB_PATH. A criação de contas e o servidor têm de usar o mesmo caminho. As apostas novas começam com o estado Pendente. Para liquidar uma aposta, edita o estado e regista o resultado. Em múltiplas, usa a odd final da casa de apostas, incluindo eventuais ajustes por seleções anuladas.

## Instalação privada

1. Copia estes ficheiros para um servidor com Node.js 24. Cria uma pasta persistente acessível só à conta do serviço e define DB_PATH com o caminho absoluto para a base de dados nessa pasta. Cria as contas no mesmo ambiente.
2. Corre o processo node server.mjs como serviço com reinício automático. Mantém HOST=127.0.0.1 e coloca um proxy HTTPS no mesmo servidor. Restringe o acesso à rede privada do grupo ou a uma VPN.
3. Define COOKIE_SECURE=1 e APP_ORIGIN com a origem HTTPS exata que os cinco utilizadores abrem no navegador, sem barra final. Por exemplo, https://tipster.example.com. Configuração mínima equivalente num Caddyfile para um domínio com HTTPS configurado:

~~~caddyfile
tipster.example.com {
  reverse_proxy 127.0.0.1:3000
}
~~~

4. Protege os segredos nas variáveis do serviço. Faz cópias consistentes com a ferramenta de backup do SQLite ou com o serviço parado. Testa a recuperação, o login e o isolamento com duas contas antes de distribuir o endereço. Entrega cada palavra-passe em privado.

O serviço usa hash scrypt com sal, sessões aleatórias de sete dias, cookies HttpOnly e SameSite=Strict, verificação de origem e limite de tentativas de início de sessão por IP. O proxy local pode agregar as tentativas do grupo no mesmo IP. A partilha vem desligada e envia apenas nome, resultado líquido, yield e ROI do registo. Os alertas aparecem no painel e têm filtros de modalidade e limiar de EV.

## Importar uma captura

No Histórico, escolhe **Importar captura** e seleciona uma imagem PNG, JPEG ou WebP até 12 MB. O reconhecimento de texto corre no navegador com Tesseract.js e carrega a biblioteca e os dados de idioma de jsDelivr, pelo que é necessária ligação à Internet. A imagem não é enviada ao servidor nem guardada. Revê e corrige o texto reconhecido, deixando uma seleção por linha, e confirma modalidade, stake, moeda, odd, data e estado antes de guardar. A aplicação não coloca apostas. A moeda COINS é registada como unidades da plataforma e fica fora dos totais em euros. A qualidade depende da legibilidade e do formato da captura.

## Fontes

| Variável | Utilização |
| --- | --- |
| FEED_MODE | demo por omissão. licensed consulta apenas os fornecedores configurados e mostra indisponibilidade em caso de erro. |
| API_FOOTBALL_KEY | Chave API-Football. Jogos de futebol em curso, odds 1X2 quando disponíveis e dados adicionais para os jogos selecionados. |
| FOOTBALL_FIXTURE_IDS | Até oito IDs API-Football separados por vírgulas. Permite selecionar jogos pré-jogo e consultar onze e ausências dos jogos selecionados. |
| PANDASCORE_TOKEN | Token PandaScore. Jogos em curso e calendário de CS2 e VALORANT, com resultados em mapas quando disponíveis. |

O servidor agrupa e guarda respostas durante 60 segundos. O painel atualiza de minuto a minuto quando está visível. Confirma os limites de chamadas, os direitos de exibição privada e os mercados cobertos antes de ativar licensed. Os timestamps da fonte são exibidos quando o fornecedor os entrega. A hora de consulta ao serviço tem uma indicação separada.

- **Futebol** — A [documentação API-Football](https://www.api-football.com/documentation-v3) descreve calendários, estatísticas, onzes, lesões e odds pré-jogo e ao vivo. O adaptador lê odds pré-jogo por casa e odds ao vivo atribuídas ao feed, quando disponíveis. 
- **CS2 e VALORANT** — A [PandaScore](https://developers.pandascore.co/docs/introduction) disponibiliza dados de jogos e opções para dados detalhados ao vivo. O [produto de odds](https://www.pandascore.co/) exige verificar o acesso e a cobertura no plano. Neste MVP o adaptador liga-se ao calendário e marcador da série. As odds de esports, plantéis detalhados, vetos e telemetria por ronda exigem um conector adicional.
- **Flashscore** — Os [termos Livesport](https://livesport.eu/terms-of-use/en) restringem pedidos automatizados e scraping. Uma integração futura requer um canal autorizado e direitos adequados.

## Modelos e métricas

Em demonstração, as equipas, mercados e timestamps pertencem a cenários fictícios identificados. O Futebol aplica Poisson a golos esperados restantes e soma o marcador atual. CS2 e VALORANT combinam probabilidades de mapas com o marcador da série BO3. As probabilidades por mapa são parâmetros de exemplo. Os cenários de CS2 documentam veto, lado e quinteto. Os de VALORANT documentam patch, agentes e estabilidade do plantel. 

O comparador seleciona a melhor odd decimal por desfecho. A margem de uma linha completa é a soma de 1/odd menos um. A odd justa é 1/probabilidade e o EV por unidade de stake é probabilidade × odd − 1. O cenário baixo aplica uma redução fixa de seis ou oito pontos percentuais à probabilidade desse desfecho. É uma análise de sensibilidade ilustrativa. As bandas de diferentes desfechos são avaliadas individualmente.

O modo licenciado apresenta dados da fonte sem atribuir probabilidades do modelo aos jogos reais. A calibração e o backtesting auditável ficam por fazer. Para avançar, é necessário guardar observações prévias a cada decisão com timestamps, odds, resultados, versão do modelo e regras de inclusão. A avaliação fora da amostra deve usar divisão temporal, métricas de calibração como Brier e log loss, e simulação que respeite odds disponíveis, suspensões e latência.

O resultado líquido soma o lucro das apostas ganhas e deduz a stake das perdidas. A liquidação é manual. O yield usa a stake das apostas ganhas e perdidas. O ROI do registo usa toda a stake registada, incluindo pendentes e anuladas. O desempenho por tipster agrega apenas apostas que o utilizador associou manualmente à persona correspondente. A aplicação não envia apostas a operadores.

## Validação

~~~powershell
node --test test.mjs
~~~

A bateria usa uma base temporária e valida a matemática, o limite de cinco contas, início e fim de sessão, operações sobre apostas, isolamento entre contas e partilha por adesão. A ligação real aos fornecedores requer as credenciais e o plano do titular. A validação do feed real e a publicação num servidor ficam pendentes.

## Estrutura

- server.mjs serve a interface e a API e controla autenticação, autorização e persistência.
- providers.mjs converte respostas dos fornecedores para um formato comum.
- model.mjs contém os cenários e cálculos.
- index.html, app.js e style.css contêm a interface responsiva.

