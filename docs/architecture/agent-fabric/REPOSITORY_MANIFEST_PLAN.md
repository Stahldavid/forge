# Forge em repositórios existentes: manifesto, mapas e Agent Fabric

Data: 2026-10-06

Status: proposta revisada por subagent independente; ajustes incorporados em 2026-10-06. Nenhum comando ou campo proposto neste documento implica suporte atual.

## 1. Objetivo

Permitir que Codex prepare um repositório existente para usar análise, mapas, consultas CAIR e contexto do Agent Fabric, preservando sua arquitetura, ferramentas e runtime. Vue/Nuxt, Java/Spring e Docker/Compose devem estar presentes no primeiro piloto integrado, além de TypeScript/JavaScript.

O usuário permanece no chat do Codex e pede, por exemplo: “Prepare este projeto para usar os mapas do Forge”. O agente descobre a estrutura, gera um `forge.manifest.json`, valida o documento e solicita análise. O Forge deriva mapas do código; o agente usa os mapas para localizar funcionalidades, planejar alterações e selecionar verificações.

Não é necessária migração para commands, queries, banco ou runtime Forge. Descobrir operações não as transforma em ferramentas executáveis. Esta entrega de planejamento não autoriza implementação, publicação ou instalação de integrações em outros projetos.

## 2. Evidência da implementação atual

Repositório analisado: `C:/Users/stahl/Projects/forge`, versão local `0.1.0-alpha.68`.

| Componente | Base existente | Lacuna |
| --- | --- | --- |
| Manifesto externo | Serviços, entries, schemas, HTTP/stdio e registro | Não representa análise de repositório sem serviço |
| Brownfield import | Inventário, rotas, chamadas, riscos e candidatos | Orientado a migração; análise predominantemente textual |
| Vue/Nuxt | Dependências e algumas páginas/componentes no frontend graph | Brownfield não coleta `.vue`; frontend graph assume `web` e bindings Forge |
| Java/Spring | Controllers por annotations e inventário Maven | Regex, sem resolução semântica; Gradle ausente no inventário examinado |
| App graph | Símbolos, módulos, referências, hashes e parsing incremental | Parser orientado a TypeScript/TSX; tipos parcialmente ligados ao runtime |
| Test graph | Descoberta/classificação de testes | Extensões e diretórios específicos de TypeScript |
| CAIR | Snapshot compacto, símbolos, referências e impacto | Leitura direta de artefatos do compilador Forge |
| Docker | Backend de sandbox | Não equivale a grafo estático de Dockerfile/Compose |
| Agent Fabric | Runtime compartilhado, registro de projetos, owners e clones | Falta integração explícita com os mapas propostos |

Fontes relativas ao checkout Forge:

- `src/forge/brownfield-import/index.ts` e `types.ts`.
- `src/forge/compiler/external-manifest/{types,validate,registry}.ts`.
- `schemas/forge-manifest.schema.json`.
- `src/forge/compiler/frontend-graph/build.ts`.
- `src/forge/compiler/app-graph/parser.ts` e `compiler/types/app-graph.ts`.
- `src/forge/compiler/test-graph/build.ts`.
- `src/forge/cair/snapshot.ts`.
- `docs/brownfield-import.md` e `docs/forge-protocol.md`.

Detalhe a corrigir: tipos/validador externo contemplam `commandArgs`, mas o JSON Schema examinado não declara o campo. Confirmar e alinhar schema, validadores, tipos, fixtures e documentação durante a implementação.

Limites adicionais confirmados na revisão: o importador atual ignora `tests` e `__tests__` e lê arquivos `.env` e `.env.local` para extrair nomes de variáveis. Isso não prova emissão dos valores, mas viola a política proposta de não abrir esses arquivos. Reutilizar classificadores úteis após introduzir scanner configurável; não reutilizar a coleta atual sem correção. CAIR consulta fonte atual diretamente em definições e usa busca textual em referências; seu snapshot não garante que a resposta consultada pertença à mesma versão.

## 3. Decisões de arquitetura

### 3.1 Um manifesto, modalidades distintas

Preservar o nome `forge.manifest.json`. Manter suporte ao protocolo de serviço 1.0. Introduzir uma modalidade discriminada de repositório, com schema próprio dentro do mesmo sistema de manifestos. A versão `2.0` abaixo é ilustrativa: decidir o versionamento final após verificar consumidores e política de compatibilidade.

Internamente, separar `ServiceManifest` e `RepositoryManifest`; nunca fazer um consumidor de serviços assumir `manifest.service.name` em um manifesto de repositório. Um projeto analisado pode referenciar contratos de serviços existentes por arquivos relativos, sem transformar seus candidatos em serviços automaticamente.

Introduzir loader discriminado antes do registry atual: descoberta automática de `forge.manifest.json` deve classificar o documento; registry/runtime externos recebem somente ServiceManifest. Um root RepositoryManifest não pode quebrar a geração de uma aplicação Forge nem tornar-se serviço inválido. Quando já existir um root ServiceManifest, discovery não o sobrescreve: oferecer documento composto versionado ou configuração externa/referências explícitas. Esta escolha integra a decisão de schema de E1.

Exemplo conceitual, ainda não aceito pela CLI atual:

```json
{
  "forgeProtocol": "2.0",
  "kind": "repository",
  "components": [
    { "id": "frontend", "root": "frontend", "adapters": ["vue", "typescript"] },
    { "id": "backend", "root": "backend", "adapters": ["java", "spring", "maven"] },
    { "id": "infra", "root": ".", "adapters": ["docker"], "files": ["compose.yaml", "backend/Dockerfile"] }
  ],
  "exclude": ["**/node_modules/**", "**/target/**"],
  "checks": [
    { "id": "frontend-tests", "component": "frontend", "argv": ["npm", "test"] }
  ]
}
```

O manifesto declara configuração, raízes, aliases/overrides necessários e verificações sugeridas. Não contém inventário manual de todas as funções. Contratos de APIs e integrações são opcionais. Validar IDs únicos, caminhos, limites e conflitos entre componentes sobrepostos.

Usar caminhos relativos ao repositório. A localização absoluta pertence ao registro host-local do Fabric. Se o usuário não desejar arquivo no projeto, permitir um manifesto externo explicitamente associado a uma raiz registrada; não inferir raízes externas a partir de texto arbitrário.

### 3.2 Descoberta determinística e complemento pelo Codex

1. Resolver a raiz desejada e ler instruções do projeto.
2. Descobrir manifests de pacotes, arquivos de build, componentes, frameworks e infraestrutura.
3. Entregar inventário e lacunas ao agente.
4. Codex prepara o manifesto e documenta decisões que a descoberta não resolve.
5. Forge valida e calcula o grafo.
6. Codex consulta o resultado e corrige configuração quando necessário.

Definir um único resolvedor de raiz para todas as novas operações: raiz explícita ou projectId primeiro; descoberta ascendente limitada a marcadores reconhecidos quando omitida. Não exigir package.json para Java/infra. A CLI atual usa cwd em diversos caminhos; não assumir descoberta universal. Para análise estática, permitir diretório sem Git; preservar exigência Git+HEAD do Fabric para clones gerenciados. Relatar separadamente análise disponível e execução gerenciada disponível.

Não aceitar root e projectId divergentes; se ambos forem fornecidos, exigir identidade canônica equivalente. Definir paragem de descoberta em worktrees/submódulos e diagnóstico para manifestos ancestrais ambíguos. Um manifesto externo não redefine a raiz para o diretório onde o arquivo está salvo.

Registrar proveniência de declarações do agente e overrides. Não dar a essas declarações a mesma classificação de relações observadas no código. A configuração muda com a estrutura; mapas mudam com o conteúdo.

### 3.3 Modelo comum de análise

Criar um grafo neutro de repositório, separado das exigências do runtime Forge. Reutilizar hashing, serialização determinística, diagnósticos e primitives compatíveis. Adaptadores produzem fatos; uma fase de resolução combina fatos e identifica ambiguidades.

Entidades: repository, component, package, file, symbol, page, UI component, endpoint, data model, test, container service, build stage, image, volume e network.

Relações: contains, imports, references, calls, renders, routes-to, implements, tests, builds, runs, depends-on e connects-to. Distinguir ligação declarada de configuração, referência resolvida e possibilidade inferida.

Cada fato inclui ID determinístico, localização, hash de fonte, adaptador/versão e referências de evidência. Definir estabilidade de IDs em edição e comportamento em renomeação. Uma mudança de ID não pode produzir referência silenciosa a uma entidade diferente.

Padronizar coordenadas de fonte: offsets UTF-16 e intervalos semiabertos para integração Node, com linha/coluna e conversão explícita dos offsets de parsers em bytes. Preservar CRLF e Unicode; source mapping de blocos Vue retorna sempre posições no SFC original. IDs abreviados CAIR, como S#1, são handles locais ao snapshot: chamadas dependentes exigem snapshotId e não podem reaplicar o handle em outra ordenação.

Usar categorias de evidência `declared`, `syntactic`, `resolved` e `inferred`, com resolução `complete`, `partial` ou `unresolved`. Não apresentar scores fixos como probabilidades calibradas.

### 3.4 Cobertura como resultado de primeira classe

Todo snapshot inclui arquivos encontrados, analisados, ignorados, com erro e sem adaptador; razões de exclusão; recursos não suportados; relações não resolvidas e diagnósticos. Mapas parciais continuam úteis, mas não podem ser apresentados como compreensão completa.

## 4. Adaptadores do primeiro piloto

### 4.1 TypeScript/JavaScript

Reaproveitar extração existente quando independente do runtime. Identificar módulos, exports, símbolos e imports. Resolução de aliases, workspaces e imports deve seguir configurações reais, sem exigir package.json na raiz de todos os projetos. Diferenciar parsing de resolução semântica; escolher ferramentas após um spike de compatibilidade e distribuição.

### 4.2 Vue/Nuxt

Analisar `.vue` com entendimento de template, script, script setup e style. Preservar posições no arquivo original ao trabalhar com blocos. Identificar imports, componentes usados, props, emits, composables, stores, Vue Router e convenções Nuxt. Tratar aliases e autoimports conforme configuração.

Relacionar páginas a componentes e clientes HTTP. Componentes dinâmicos, URLs construídas e autoimports não resolvidos permanecem explícitos no relatório. Não executar configuração arbitrária para apenas descobrir estrutura.

Descobrir testes Vitest/Jest e uso de Vue Test Utils quando presentes. Distinguir teste encontrado, associação estática ao componente e cobertura observada por execução; nenhuma associação por nome é prova de cobertura executada.

### 4.3 Java/Spring

Nível inicial: parser sintático para packages, classes, interfaces, métodos, imports e annotations; endpoints, DTOs e relações Spring quando observáveis. Inventário Maven/Gradle multimódulo. Leitura estática de arquivos Gradle tem limites por ser uma DSL executável; declarar esses limites.

Nível opcional: resolução semântica com ferramentas Java disponíveis, classpath e configuração explicitamente preparados. Não executar wrappers ou builds durante uma análise declarada estática. Reflection, Lombok, proxies e código gerado entram no relatório de cobertura. Chamada a interface não garante qual implementação recebe a chamada.

Descobrir testes JUnit/TestNG, source sets e fixtures declarados. Reportar ligação sintática/inferida a classes separadamente de cobertura observada e de resolução semântica.

### 4.4 Docker/Compose

Analisar Dockerfile: FROM/estágios, contextos, COPY, referências a variáveis, entrypoint e command como informação. Analisar Compose: serviços, build contexts, imagens, portas, volumes, redes, profiles, depends_on e referências a secrets/configs/env.

Cobrir arquivos adicionais e overrides por uma seleção explícita de cenário. Preservar interpolação não resolvida sem ler valores sensíveis automaticamente. Diferenciar porta interna de publicada e rede interna de endereço acessível pelo navegador. `depends_on` não prova tráfego nem disponibilidade.

O cenário também identifica profiles Spring e modos Vite/Nuxt reconhecidos estaticamente, ordem de overlays e arquivos Compose selecionados. Esse conjunto e seus hashes fazem parte do snapshot; ambientes diferentes não compartilham silenciosamente a mesma resolução. Valores desconhecidos permanecem desconhecidos.

Análise estática não inicia Docker, não constrói imagens e não faz pull. Inspeção observada de containers ou ferramentas externas seria operação separada e identificada.

## 5. Resolução entre tecnologias

Exemplo esperado:

```text
Pedidos.vue -> usePedidos -> cliente GET /api/pedidos
            -> PedidoController -> PedidoService -> PedidoRepository

Compose api -> build backend/Dockerfile -> componente backend
```

Relacionar por método HTTP, padrão de caminho, base URL, proxy, componente e cenário de configuração. Consumir OpenAPI local opcionalmente. Não usar apenas prefixos de URL: o detector atual pode gerar associação incorreta e deve ser substituído na fase integrada.

Ligações sugeridas pelo modelo podem enriquecer a análise como declarações rastreáveis; não substituem resolução. Quando dois serviços oferecem o mesmo caminho, manter ambiguidade até haver contexto suficiente.

## 6. Artefatos e consultas

Armazenar artefatos locais em uma área dedicada, proposta `.forge/repository/`, sem escrever em `src/forge/_generated`. Manifesto pode ser versionado; cache e estado operacional são locais. Definir formato canônico, escritas atômicas e publicação de um snapshot completo somente após validação.

Oferecer cache host-local explicitamente configurado quando não houver autorização ou interesse em escrever no repositório. Discovery/validate possuem modo sem escrita, inclusive sem telemetria local/recorder Delta; analyze declara seu destino de artefatos. A CLI atual pode registrar operações no Delta mesmo em comandos de leitura, com bypass existente `--no-delta`/`FORGE_DELTA=0`; a nova superfície precisa preservar o contrato sem escrita de ponta a ponta. Não editar `.gitignore` automaticamente.

Separar provider de análise `forge-application` de `repository` na integração CAIR. Preservar queries atuais onde os conceitos correspondem; recursos dependentes do runtime e mutações CAIR não suportadas devem retornar capacidade indisponível em vez de fingir suporte.

O provider deve cobrir snapshot, queries, resolução de referências, leitura de fontes e capabilities/actions. Alterar apenas snapshot não basta. Consultas precisam carregar snapshotId e detectar divergência com a fonte atual antes de devolver resultados. Não rotular a busca textual atual de Q REFS como referência semanticamente resolvida. No primeiro release repository, ações CAIR mutantes ficam indisponíveis; ações de leitura continuam disponíveis conforme cobertura.

Consultas prioritárias: overview, locate, symbol, references, routes, dependencies, impact, tests, infrastructure e coverage. Respostas compactas, orçamento de contexto, paginação/cursor e referências ao código. Não despejar o grafo inteiro em todo prompt.

Critérios de consulta incluem duas funções homônimas sem mistura, ausência de comentários/strings como referências resolvidas e rejeição de handle/snapshot obsoleto. Fonte posterior à análise não pode ser recortada usando offsets antigos.

Comandos ilustrativos, não existentes nesta proposta:

```text
forge manifest discover --json
forge manifest validate forge.manifest.json --json
forge repository analyze --json
forge repository context --query "autenticação" --json
```

A sintaxe final deve respeitar a CLI atual e evitar superfícies duplicadas com `import analyze` e CAIR. Definir depreciação ou aliases somente depois de verificar consumidores.

## 7. Integração Agent Fabric e skill

Skill conduz descoberta, geração e consultas; não exige que o usuário escreva JSON. Runtime e skill continuam compartilhados. Registro por projeto e seleção explícita de projectId mantêm isolamento CLI/MCP.

Ao planejar um workflow, Fabric obtém contexto limitado à tarefa: snapshot, arquivos, relações, checks sugeridos e lacunas. Cada worker recebe contexto do seu próprio clone/snapshot; após composição de alterações upstream, renovar análise relevante. Não reutilizar o grafo do checkout original como se descrevesse um clone modificado.

Maps ajudam a sugerir writeScope, dependências e revisão, mas não alteram silenciosamente obrigações de aceitação. Impacto estimado não autoriza pular verificações requeridas. Checks declarados não executam durante descoberta; execução é uma atividade do workflow com argv explícito e escopo autorizado.

Hooks são opcionais para atualização; não necessários à análise. Não instalar hooks/MCP como efeito colateral. MCP pode expor queries de análise roteadas pelo registro existente.

## 8. Incrementalidade, consistência e múltiplos repositórios

Snapshot considera conteúdo local, incluindo mudanças não commitadas, manifesto, configs e versões dos adaptadores. Commit Git é metadado, não chave suficiente de validade.

Reusar parsing por hash de arquivo. Invalidar resolução quando configuração, aliases, manifests de dependências ou contratos mudam. Detectar mudanças durante leitura; repetir o trecho necessário ou marcar snapshot inconsistente. Publicar artefatos atomicamente e serializar concorrência no cache, sem reutilizar locks de execução indiscriminadamente.

Cada repositório tem identidade e snapshot próprios. Multi-repo usa referências explícitas a projetos registrados e contratos locais. Resposta identifica origem/versão de cada mapa; não afirma snapshot global atômico entre repositórios. Mudança em outro checkout não é sincronizada automaticamente.

## 9. Limites de leitura e execução

Respeitar raízes canônicas, exclusões explícitas e tratamento de symlinks. Não seguir referências para fora do escopo sem configuração autorizada. Limites de quantidade/tamanho/tempo aparecem nos diagnósticos, nunca como truncamento invisível.

Não coletar valores de credenciais, `.env` reais, secrets ou payloads operacionais. Nomes/referências de variáveis podem ser mapeados. Sanitizar fragmentos de Docker/config quando contiverem valores sensíveis; não incluir fonte completa por padrão nos pacotes de contexto.

Análise estática não executa package scripts, Gradle, Maven, arquivos de configuração JS, comandos de Docker ou adaptadores arbitrários. Adaptadores iniciais são embutidos/versionados. Provedores semânticos que exigem preparação são operações separadas, explícitas e com proveniência. A coleta de fontes precisa incluir testes conforme configuração e separar exclusões de credenciais da simples classificação de arquivos; não pode herdar cegamente o scanner brownfield atual.

## 10. Entregas e critérios de aceite

| Etapa | Entrega | Critério |
| --- | --- | --- |
| E1 | Schema discriminado, compatibilidade, root resolver e scanner configurável | Manifestos 1.0 continuam válidos; repo sem serviço/package.json validável; testes incluídos; arquivos sensíveis não abertos; caminhos e IDs verificados |
| E2 | Grafo neutro, snapshot coerente e adaptadores iniciais | Vue + Spring + Compose presentes; hashes/cenário/IDs determinísticos; escrita atômica e mudança durante análise detectada; fixtures com fatos esperados e casos negativos |
| E3 | CAIR/provider completo e contexto | Consultas compactas funcionam sem runtime Forge; leituras ligadas a snapshot; referências textuais diferenciadas; ações não suportadas indisponíveis |
| E4 | Skill/Fabric | Contexto correto para checkout e clones; roteamento por projeto; zero execução implícita |
| E5 | Otimização incremental e evolução semântica | Melhorar reutilização e resolução sobre a consistência mínima já entregue; cobertura, orçamento e custo observáveis |

O primeiro piloto integrado deve usar Vue + Java/Spring + Compose, incluindo frontend/backend em diretórios independentes. Fixture hermética evita depender de produção; piloto em repositório real só com escopo escolhido e autorizado.

Validação necessária:

- Manifests antigos e novos; schema/tipos/validador concordantes.
- Vue script setup, aliases, autoimports e componentes dinâmicos.
- CLI em subdiretório, Java sem package.json, diretório sem Git analisável e execução Fabric corretamente indisponível sem Git+HEAD.
- Scanner inclui testes declarados sem abrir `.env` reais; manifesto existente não é sobrescrito durante discovery.
- Maven multimódulo, Gradle com lacunas explícitas e Java semântico indisponível.
- Mesmo endpoint com métodos distintos, parâmetros, proxies e serviços ambíguos.
- Docker multistage, Compose overrides/profiles, ports, networks e interpolação.
- Relações frontend/backend/infra confrontadas com ground truth revisado.
- Arquivos excluídos, symlinks, configurações sensíveis e limites.
- Mudança não commitada, delete/rename, concurrent update e cache invalidation.
- Q DEF/Q REFS após mudança de fonte: não devolver evidência de snapshot antigo como se atual; resultados textuais não recebem assurance semântica.
- Homônimos, comentários/strings, handles CAIR de snapshots distintos, Unicode/CRLF e source mapping Vue.
- Testes Vue e Java encontrados sem afirmar cobertura executada.
- Cenários diferentes não reutilizam relações incompatíveis; discovery/validate sem escrita não criam Delta/cache nem alteram `.gitignore`.
- Root RepositoryManifest não quebra registry/runtime de serviços; root ServiceManifest existente é preservado.
- Independência do framework: nenhum arquivo/dependência runtime Forge exigido no projeto.
- Fabric clones: contexto pré/pós upstream e publicação não usam evidência obsoleta.
- Multi-repo: isolamento, IDs, raízes e snapshots distintos.

Medir precisão das relações resolvidas, cobertura das relações conhecidas, proporção de ambiguidades, custo da primeira análise, custo incremental e tamanho dos pacotes de contexto. Não fixar metas numéricas antes de estabelecer baseline reproduzível; definir metas antes do aceite do piloto.

## 11. Riscos e decisões pendentes

- Extensão de manifestos deve evitar regressão na descoberta automática do root manifesto e nos consumers que assumem serviço.
- Escolha de parsers/semantic providers exige spike de qualidade, Windows/Node, distribuição npm e licenças; não adicionar toolchain pesada ao caminho básico sem justificativa.
- Vue/Nuxt e Java/Spring possuem recursos dinâmicos que impedirão completude estática.
- Monorepos e configurações alternativas exigem descoberta por componente e seleção explícita de cenário.
- Artefatos podem expor informação sensível se emitirem snippets sem sanitização.
- Relação com `.forge/fabric.json`: esse arquivo continua configuração de execução; manifesto declara análise e sugestões. Definir precedência para checks sugeridos e evitar duplicar environment/maxConcurrency.
- API de grafo e versão de manifestos devem ser escolhidas antes de ampliar consumidores.
- Mapas de conhecimento não habilitam operações executáveis; adaptadores externos atuais preservam seu contrato separado.

## 12. Resultado esperado

Codex gera e mantém a configuração; Forge calcula mapas verificáveis e informa lacunas; CAIR fornece navegação compacta; Agent Fabric usa contexto atualizado para trabalhar. Vue, Java e Docker fazem parte da cobertura inicial, sem migração do projeto para o framework.

## 13. Revisão independente

Concluída pelo subagent `review_repository_manifest_plan` em 2026-10-06, por leitura do código atual, sem testes/builds/containers/CI. Parecer: arquitetura adequada com oito ajustes recomendados, incorporados neste documento:

1. Provider CAIR completo, fonte vinculada a hash e referências com assurance correta.
2. Resolvedor de raiz e distinção análise sem Git versus execução Fabric Git+HEAD.
3. Scanner configurável incluindo testes, sem abertura de `.env` reais.
4. Loader discriminado e coexistência de manifestos sem regressão de serviços.
5. Consistência mínima em E2/E3 antes do Fabric; otimização incremental em E5.
6. Descoberta de testes Vue/Java e convenção de coordenadas/handles.
7. Modo sem escrita incluindo recorder Delta e opção de cache host-local.
8. Cenário de configuração como parte da identidade do snapshot.

Evidências detalhadas e relatório em `FORGE_REPOSITORY_MANIFEST_REVIEW.md`, no mesmo diretório. A revisão é documental e não constitui validação da implementação futura. Versionamento definitivo, escolha de parsers e metas de desempenho permanecem decisões explicitamente pendentes.
