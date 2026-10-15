# Plano implementado: Agent Fabric workflows R2.1

Este documento preserva os requisitos e a revisão do plano. A implementação adota a arquitetura diretamente, conforme a decisão posterior do usuário de ignorar compatibilidade legada. Estado e evidências da implementação: WORKFLOW_PROGRAM_V2_EVIDENCE.md; contrato operacional: WORKFLOW_PROGRAM_V2_ADR.md. Correções e acabamento R2.2 estão em WORKFLOW_PROGRAM_V2_CORRECTIONS.md; o ADR e o guia de API prevalecem sobre detalhes históricos de armazenamento/autoria abaixo. Extensões da seção 22 continuam fora do núcleo.

# Plano revisado do Agent Fabric Workflows

Versão editorial R2.1, 07/10/2026. Baseline observado: Forge `083077bdc9aee74e81d941a67c3c38bd31d8e2d0`, alpha.70. O corpo abaixo preserva o plano na data da proposta; a implementação e suas correções são registradas nos documentos indicados na introdução. A arquitetura R2 recebeu confirmação independente; R2.1 incorpora a restrição posterior do usuário de não executar testes reais com LLM. Antes desta implementação, o baseline publicado alpha.70 reconhecia operatorVersion 1; o working tree atual implementa operatorVersion 2. A versão npm não foi incrementada/publicada nesta rodada. O número da versão comercial futura será escolhido na implementação, sem ser inferido deste documento.

**Restrição vigente de validação: nenhum teste, piloto ou benchmark pode chamar LLM real, incluindo CLI/SDK de agentes, providers pagos, assinatura ou modelos locais.** Usar executores determinísticos, mocks/stubs de transportes e fixtures. Não iniciar comandos/subprocessos que possam acessar um modelo como fallback. Avaliação com modelos reais fica adiada e requer nova autorização explícita do usuário; sua ausência não bloqueia a entrega técnica do runtime, mas limita as alegações de qualidade do produto.

## 1. Objetivo e critério de sucesso

Criar uma solução programática para múltiplos agentes com autoria acessível, execução explícita, trabalho concluído recuperável e obrigações verificadas pelo runtime. A proposta de valor combina expressividade, recuperação, revisão, cobertura e integração; não depende de usar YAML, de permitir mais agentes ou de adicionar mais operadores.

O objetivo de superar Claude Code Dynamic Workflows será avaliado por dimensão e em tarefas/configurações delimitadas: menos chamadas repetidas após falha, cumprimento de obrigações, menos falsos aceites/regressões, esforço de autoria aceitável e custo total observado. Não declarar superioridade geral a partir de fixtures ou do formato da DSL.

## 2. Baseline e mudanças desejadas

| Área | Alpha.70 observada | Alvo deste plano |
|---|---|---|
| Autoria | Subconjunto finito TS e IR JSON; opções genéricas | Mesmo núcleo, tipos discriminados, referências tipadas e diagnósticos com localização |
| Scheduling | Raízes percorridas sequencialmente, referências resolvidas sob demanda; map concorrente | Dependências de dados e controle, scopes explícitos, fila pronta persistida e quotas separadas |
| Waiting | Falta de evento lança erro; na raiz needs-attention, em map vira failed | Suspensão durável do ramo, sem consumir slot e sem contar como falha |
| Resume SDK | Resultado completo passa pelo caminho de preparação/cache, sem reuso SDK nativo | Continuação de invocação intacta devolve resultado persistido sem nova chamada |
| Revisão | Repair com candidate/review/checks/budgets | Preservar; acrescentar evidências de avaliação e diagnósticos de fase |
| Aplicação | Gate e ApplyIntent congelado, reconciliação | Preservar fronteira e vincular todas as novas evidências ao candidato exato |
| Persistência | Snapshots completos/histórico a cada transação | Instrumentar; otimizar somente após profiling e testes de recuperação |
| UI/browser | Sem integração automática com browser do chat | Adaptador explícito e artefatos duráveis vinculados à build/candidato |
| Providers | Codex e comandos | Consolidar esse contrato; outros harnesses como extensão posterior |

O plano anterior do repo diz que a ordem de steps não cria sequência; o executor atual percorre as raízes com await e pode antecipar uma raiz por forward reference. P0 resolve essa divergência formalmente. Não apresentar o comportamento atual como sequência estrita.

## 3. Arquitetura

```text
Chat/CLI/SDK de autoria
        ↓
DSL TypeScript finita ou IR JSON
        ↓ lowering estático + validação + plano de capacidades
IR versionada com dados, controle, scopes e obrigações
        ↓
Owner autenticado: registry, estado autoritativo, scheduler
        ↓
Atividades: Codex / comandos / adaptadores aprovados
        ↓
Resultados tipados, candidatos, evidências e receipts
        ↓
Composição → avaliação integrada → gate → aplicação autorizada
```

O owner é a autoridade local do projeto; sua existência não implica serviço distribuído, funcionamento com App fechado nem wakeup instalado. O runtime pode ser compartilhado sem instalar Forge como dependência do projeto alvo. CLI/MCP/cliente futuro usam a mesma autoridade e o mesmo estado.

O registry confiável contém schemas, executores, políticas, contratos de aceite, populações e child programs versionados. Cada run fixa seus contratos. Um plano gerado por agente não amplia permissões nem substitui o registry. Dados, imagens e relatórios dos agentes são entradas não confiáveis, não autorização.

## 4. Modelo público e compatibilidade

Manter schemaVersion da persistência e operatorVersion como eixos diferentes. Proposta: operatorVersion 2 identifica as novas semânticas de scheduling/scopes/wait/resume. Se novas estruturas de persistência exigirem migração, usar discriminador próprio; não fingir compatibilidade binária apenas mantendo schemaVersion 2.

Programas operatorVersion 1 continuam interpretados por seu comportamento histórico. Não migrar runs ativos automaticamente. Uma conversão gera proposta/diff, explicita dependências de controle e exige confirmação do owner dentro da autorização da tarefa. Não deduzir silenciosamente ordem a partir de uma lista ambígua.

O novo formato tem `mode: "data" | "candidate"` para ergonomia. Em data, resultado tipado não autoriza publicação. Em candidate, o resultado que declara aceite precisa do gate do owner. Nenhum perfil pode enfraquecer política, cobertura ou autoridade de efeitos. Perfis são configurações do mesmo núcleo, não dois runtimes.

Blocos canônicos usam `{ steps, result }`. Blocos de map/loop/subworkflow e braços de branch têm escopo lexical. Um body contendo uma única operação é um shorthand: o lowerer cria o bloco e sua expressão de resultado. Não usar implicitamente a última operação de um bloco com várias etapas como resultado. Referência entre irmãos usa IDs locais; referência a um filho interno de outro scope é inválida. Só o resultado público do scope atravessa sua fronteira.

## 5. Semântica de ordem, dependências e scopes

No operatorVersion 2, `steps` no nível de grafo é um conjunto finito de operações identificadas; ordem textual não é aresta. Referências de output/candidate/evidence criam dependências de dados. O campo comum `after: [stepId, ...]` cria dependências de controle que não exigem consumir dados. `after` é campo, não uma função JavaScript executada.

Uma operação fica pronta somente quando todos os predecessores exigidos satisfazem o contrato. “Processo terminou” não equivale a “dependência satisfeita”: repairs requeridos precisam de aceite, waits requerem decisão válida e scopes exigem join. Falha não satisfaz after. Receber uma decisão válida de declínio por waitEvent pode concluir a espera, mas não autoriza escrita/aplicação: after/sequence ordenam controle, e o owner exige a decisão aprovadora vinculada quando policy requer autorização. Uma política de collection pode representar um resultado parcial de forma explícita, sem converter falhas em sucesso.

`sequence` adiciona arestas de controle em ordem declarada e tem resultado explícito. Referência de uma etapa anterior à saída de uma posterior no mesmo sequence cria ciclo e é rejeitada. `parallel` permite executar filhos independentes quando prontos; dependências entre filhos continuam valendo. O pai não ocupa um slot de worker aguardando seus filhos. Join e cancelamento pertencem ao scope.

`parallel.onFailure` inicialmente suporta `collect-all` e `cancel-siblings`. O primeiro coleta desfechos em ScopeResult persistido para diagnóstico; um filho obrigatório falho impede sucesso do scope. O campo result é avaliado somente após join bem-sucedido; na falha, output(scope) não fornece valor de sucesso. status/history/explain expõem os outcomes sem inventar output de filho falho, null ou recovery implícito. Não adicionar outcome()/catch ao núcleo inicial. O segundo solicita cancelamento dos filhos pendentes/ativos, preserva os completos e aguarda observação/reconciliação. Não implementar race ou “primeiro resultado ganha” sem contrato separado de efeitos.

Todos os roots declarados pertencem ao scope raiz; trabalho obrigatório falho não pode desaparecer porque result referencia apenas um subconjunto. Arms não escolhidos são skipped, sem obrigações ativas. Ordem de agregação e de composição é determinística; ordem de conclusão de workers pode variar. Não prometer reproduzir o mesmo interleaving de efeitos externos.

## 6. Catálogo completo das funções de autoria desejadas

Este é o catálogo fechado do núcleo proposto, não uma promessa de JavaScript irrestrito. A significa função existente cujo contrato é preservado/aprimorado; N significa função proposta. Recursos de fases posteriores são marcados no texto. Não incluir funções internas de hashing/locking como APIs de workflow.

### 6.1 Definição e referências de registry

| Função | Estado | Contrato |
|---|---|---|
| `defineWorkflow(definition)` | A | Define identidade, versões, schemas, policy, mode, população opcional, steps e result |
| `schemaRef(id, version)` | A | Referência a schema resolvido e fixado pelo owner |
| `executorRef(id, version)` | A | Referência a executor autorizado, com schemas/capacidades/efeitos |
| `policyRef(id, version)` | A | Referência a limites e autoridade; não alteração de policy |
| `acceptanceRef(id, version)` | A | Obrigações e critérios definidos pelo owner |
| `populationRef(id, version)` | A | Catálogo fechado, baseline, evidência e exclusões justificadas |
| `recipeRef(id, version)` | A | Receita versionada; inicialmente repair built-in, não extensão arbitrária |
| `programRef(id, version)` | A | Child program registrado, sem import/eval arbitrário |

### 6.2 Operadores de execução

Todos usam ID estável e opções discriminadas. Campos comuns: after, label e input onde pertinente. Recursos/efeitos efetivos são a interseção da solicitação com a policy/registry. A autoria não declara autoridade nova.

| Função | Estado/fase | Contrato e resultado |
|---|---|---|
| `value(id, {value})` | A | Calcula expressão pura finita, sem I/O; resultado é o valor tipado |
| `agent(id, {executor,input,candidate?,writeScope?})` | A/P1 | Executa agente registrado; output entrega seus dados tipados, candidato/evidência permanecem identidades separadas |
| `command(id, {executor,input,candidate?,writeScope?})` | A/P1 | Executa argv registrado e retorno tipado; não shell arbitrário do autor |
| `map(id, {items,key,coverage?,completion,quorum?,concurrency,body,order})` | A/P1 | Fan-out finito, chaves únicas, seal e ledger; retorna CollectionResult tipado |
| `branch(id, {condition,then,else})` | A/P0 | Seleciona um bloco; condition booleano validado, merges tipados, outro braço skipped |
| `loop(id, {initialState,maxRounds,body,next,until})` | A/P1 | Rodadas com state/counters persistidos; next e until têm contratos de tipo explícitos |
| `repair(id, options)` | A/P1/P2 | Receita de implementação/avaliação limitada, com candidato e critérios; ver seção 11 |
| `compose(id, {candidates,onConflict})` | A/P1 | Integra lineage compatível, conserva produtores; conflito preserva inputs e bloqueia; continuidade por resolução é extensão posterior |
| `gate(id, {candidate,coverage?,authorization?})` | A/P1/P2 | Owner verifica obrigações e emite GateReceipt para o candidato exato; não aplica arquivos |
| `subworkflow(id, {program,input})` | A/P1 | Materializa child program registrado, herdando autoridade e limites globais |
| `waitEvent(id, {type,correlation,schema,subject?,timeoutMs})` | A/P1 | Aguarda evento autorizado, devolve dados/receipt tipados, sem contar espera como falha |
| `sequence(id, {steps,result})` | N/P1 | Scope com arestas de controle em ordem explícita |
| `parallel(id, {steps,result,onFailure})` | N/P1 | Scope com paralelismo estruturado, join e política de falha/cancelamento |

`map.key` deve produzir string Unicode válida. V2 normaliza NFC **antes** de verificar unicidade e rejeita colisões; v1 conserva sua regra histórica de rejeitar keys não NFC. Default proposto de 256 bytes UTF-8 por key, com limite efetivo fixado pela policy antes do dispatch. A key canônica é usada em invocation, seal, evento, ledger e resultado; o original é apenas metadata. Scope path é tupla de segmentos; representação textual usa um único encoding percent UTF-8 sem ambiguidades, sem concatenação crua e sem dupla decodificação. Slash/separadores dentro da key nunca criam scopes. `map.order` inicialmente é `key` ou `input`; default v2 `key`, ordenação por bytes UTF-8, sem localeCompare. Ordem input usa ordinal persistido no seal. É ordem de resultado, não de dispatch nem identidade.

`completion` deve ser declarada: all-required, partial ou quorum. Partial/quorum só são admitidos por contrato owner compatível, nunca alimentam gate all-required por acidente. `quorum: { minAccepted: K }` é obrigatório para quorum, proibido nos demais modos; K inteiro entre 1 e o tamanho do seal. Collection vazia segue decisão no-work explícita, sem quorum 0 implícito. Em data, contar outputs válidos segundo o contrato; em candidate, somente contribuições aceitas. Failed, inconclusive, canceled e skipped não contam. Atingir K não fecha cedo: o núcleo exige todos os outcomes observados e settled. Waiting conserva obrigação e mantém collection aberta. Deadline pode fixar timeout terminal permitido pelo contrato, sem esconder efeito incerto nem retirar obrigação required. Abaixo de K ao final: collection reprovada e diagnóstico, sem result de sucesso. Quorum com 2/3 e um waiting permanece aberto; se o terceiro terminar por timeout admitido, pode fechar apenas se o contrato aceitar esse desfecho. Unknown/uncertain nunca é settled para liberar gate/apply. Fechamento antecipado exige extensão owner específica para remaining, cancelamento e reconciliação, fora do MVP.

`map.concurrency` limita atividades ativas no subgrafo do map, incluindo implement/review/check/evidence, e não a quantidade de itens em voo. Um futuro scope activity limit usa a mesma unidade. Pais e waits não ocupam slot; todos os limites de ancestral/run/owner são aplicados conjuntamente. Limite de itens em voo, se necessário, recebe campo separado e não muda a definição de concurrency.

CollectionResult canônico proposto: `{ items: [{key,outcome,valueRef?}], sealRef, totals, coverageReceiptRef?, contributionLedgerRef? }`. As saídas de filhos são resolvidas por referências tipadas; a experiência de autoria pode oferecer projeção de dados sem duplicar conteúdo no estado. Esse envelope não é uma lista que pode ser filtrada para esconder falhas. acceptedCandidates/coverageReceipt leem registros emitidos pelo owner.

ScopeResult é diagnóstico autoritativo acessível por status/history/explain, não um envelope adicional de output(sequence/parallel). Loop devolve state final tipado somente quando until é satisfeito; exaustão preserva state/diagnóstico na inspeção e bloqueia output de sucesso. Branch arms e loop body usam Block. `loop.next` é avaliado após body terminar e ter seus outputs públicos; `until` usa o state novo e outputs permitidos. Terminação falsa após maxRounds produz exhaustion visível. Uma rodada não pode remover obligations de rodadas anteriores sem contrato próprio; loop não é escape de budgets.

### 6.3 Expressões puras e referências de resultados

| Função | Contrato |
|---|---|
| `workflowInput()` | Entrada tipada e congelada do programa corrente, inclusive child |
| `item()` | Item corrente do map; inválido fora desse contexto |
| `loopState()` | State da rodada; inválido fora de loop |
| `output(id)` | agent/command: dados tipados; sequence/parallel: Block.result após join válido; branch: result do braço escolhido; subworkflow: result público do child program; loop: state final quando until satisfeito; repair/map: envelopes tipados; falha obrigatória não entrega valor de sucesso |
| `field(value,key)` | Acesso a propriedade conhecida; campo obrigatório ausente é erro, não undefined silencioso |
| `literal(value)` | Literal JSON finito, com budgets de profundidade/bytes |
| `object(fields)` | Objeto de valores/expressões com chaves permitidas |
| `array(...values)` | Lista finita de valores/expressões |
| `eq(left,right)` | Igualdade canônica dos tipos permitidos; sem coerção JS |
| `and(...values)` | Conjunção de booleanos |
| `or(...values)` | Disjunção de booleanos |
| `not(value)` | Negação de booleano |
| `concat(...arrays)` | Concatenação com budget antes da alocação |
| `filter(values,key,equals)` | Seleção pura por igualdade de campo; não é step nem callback livre |
| `unique(values,key)` | Unicidade determinística; não dispensa map validar todas as chaves originais |
| `sort(values,key)` | Ordenação estável explícita; tipos/normalização definidos |
| `take(values,count)` | Prefixo limitado; não enfraquece population/coverage |
| `length(value)` | Tamanho permitido pelo tipo registrado |
| `population()` | Contrato/manifesto do owner para o programa, não catálogo inventado pelo agente |
| `acceptance()` | Critérios e digest fixados pelo owner |
| `candidateFromBaseline(entry)` | Candidato inicial sobre o baseline capturado; entry descreve o item, não concede writes |
| `outputCandidate(id)` | Candidato observado produzido por atividade/compose; não implica aceite |
| `acceptedCandidate(id)` | Candidato com assessment válido de repair/controle correspondente |
| `acceptedCandidates(id)` | Candidatos/contribuições aceitas de collection fechada, sem omitir obrigações |
| `coverageFor(contract,discovered)` | Solicita validação owner da descoberta contra o catálogo; não declaração literal de completude |
| `coverageReceipt(id)` | Receipt owner da collection relevante, seal e obrigações |
| `acceptanceWriteScope(id)` | Escopo do contrato de aceite, limitado pela policy |
| `approvedChecksFor(entry)` | Checks owner da avaliação do item, resolvidos por fase/contexto; não lista escolhida pelo autor |
| `acceptanceChecks(id)` | Checks owner da avaliação correspondente ao ID/contexto, inclusive fase final; v1 mantém sua lista única |

Todas essas 29 expressões já têm nomes no subsistema de programas atual; os contratos exatos serão versionados. Elas não fazem chamadas de modelos, rede, filesystem, relógio do host ou random. Tipos inválidos são erros de validação. Transformações complexas usam atividades registradas. Operadores adicionais, reduce/race/streaming e callbacks gerais ficam fora do núcleo inicial, com proposta de versão separada se a necessidade for demonstrada.

### 6.4 APIs de compilação e validação

`lowerWorkflowSource(source)` converte AST finita em IR sem importar/transpilar/executar authored code. `validateWorkflowProgram(program,registry)` valida estrutura, refs, tipos, grafo, scope, efeitos e budgets. `validateProgramData(value,schema)` valida entradas/saídas. `validateProgramTypes(program,registry)` é etapa da validação, não mecanismo de aprovação. O cliente pode expor essas APIs offline; a validação autoritativa é sempre a do owner.

Melhoria de P1: tipos discriminados e branded refs para não confundir schema/executor/candidate/data/receipt. Gerar declarações de tipos a partir do registry versionado. Diagnósticos incluem arquivo/linha/operação/caminho de schema/razão. Um handle tipado é shorthand compilado para ref; não objeto que executa callback. sourceMap é metadata com digest próprio e não amplia autoridade.

## 7. Controle do run e inspeção

| Operação lógica | Situação | Contrato |
|---|---|---|
| `program-validate` | Existe, ampliar | Validação sem dispatch; devolve diagnósticos, capabilities e plano de efeitos |
| `program-start` | Existe, ampliar | Fixa programa/input/registry/baseline e autorização; persiste antes de agendar |
| `program-status` | Existe, ampliar | Estado autoritativo, waits, obrigações, uso e razões de bloqueio |
| `program-wait` | Existe | Long poll com cursor/timeout; distinto de waitEvent no programa |
| `program-pause` | Existe, esclarecer | Suspende novo dispatch; atividades em voo continuam ou recebem pedido explícito conforme escopo |
| `program-resume` | Existe, corrigir | Continua fatos persistidos; não recria budgets nem repete completados intactos |
| `program-signal` | Existe, ampliar | Entrada autorizada idempotente; receipt de recebimento separado do consumo/decisão |
| `program-replan` | Existe, esclarecer | Diff versionado com preservação/invalidação explícitas e reason/evidence |
| `program-cancel` | Existe, ampliar | Solicita cancelamento; conclusão exige observação dos efeitos, não apenas abort enviado |
| `program-reconcile` | Existe, ampliar | Reconcilia attempts/apply com observação verificável e identidade exata |
| `program-apply` | Existe, preservar | Gate atual + autorização + beforeimages + ApplyIntent; efeito local separado de compute |
| `program-history` | Proposta P1 | Transições, stateRefs e decisões antigas sem mutação |
| `program-artifact-get` | Proposta P1/P2 | Resolve referência autorizada; metadata/bytes limitados, sem acesso por path arbitrário |
| `program-explain` | Proposta P1 | Explica ready/wait/blocked, dependências e motivo de replay/invalidação |
| `program-diff` | Proposta P0/P1 | Mostra proposta de replan/migração, efeitos e gates afetados sem aplicar |

Os nomes novos são propostas, não comandos instalados. CLI usa request JSON e MCP traduz para fabric_program_*; ambos passam pelo mesmo contrato. Mutations usam requestId único e expectedVersion. Repetir requestId com corpo diferente conflita. ACK idempotente não significa efeito externo exatamente uma vez. Capabilities devem declarar versão de operadores, adapters, isolamento e limites observados.

## 8. Estados e scheduler durável

Operações propostas: declared → ready → preparing → running → completed; waiting, skipped, failed, canceled-confirmed e uncertain têm significado separado. needs-attention é razão operacional agregada, não substituto universal de todos os estados. Parent join conserva cada outcome; resultados conhecidos não são apagados por falha de outro filho.

Run executing se há atividade/controle autorizado em progresso; waiting quando só restam waits autorizados e não há trabalho pronto/ativo; paused por decisão explícita; needs-attention se exige correção/reconciliação; completed para compute de dados; acceptance-ready para candidato gated; applying/applied/apply-uncertain para efeito local. canceled só após settle/observação das atividades pertinentes. Histórico preserva cancel-requested e instantes reais.

Fila persistida com invocations e claims; capacidade do owner distinta de quota por run e limite por scope/map. Só atividades reservam slots. Espera e pais aguardando filhos não reservam worker. Fairness inicial: round-robin entre runs elegíveis e scopes, com tie-breaker estável; reentrada não pode esgotar a fila de outros runs. Não prometer scheduling distribuído. Claims de dispatch são persistidos antes do processo/modelo; epoch do owner/generation impedem resultado antigo de satisfazer trabalho substituído. Uma única autoridade ativa por projeto admite dispatch: exclusividade local via lock de processo/host e CAS do estado/epoch, validada em toda mutação autoritativa; não inferir exclusividade de TTL. Não é um protocolo distribuído.

Reservas têm ID de invocação/tentativa e debit transacional antes do dispatch; reconstrução usa intents/outcomes autoritativos. Release observado acontece uma vez. Crash antes de dispatch pode liberar apenas após provar que nenhum processo foi iniciado; crash depois de possível dispatch preserva reserva e classifica uncertain até observação. Claim expirado, PID indisponível e novo epoch não provam morte nem ausência de efeito. Worker órfão vivo continua contando na quota. Resultado tardio fica no histórico para reconciliação; não satisfaz automaticamente geração substituída. Dois owners concorrentes não podem ambos admitir o mesmo trabalho.

Materialização é limitada/paginada: não criar todos os clones/processos de 10 mil itens antes de haver capacidade. Persistir o catálogo/seal, uma janela de invocations e cursor; resolver resultados por key. Quotas incluem calls de implementer, reviewer, checks/evidence e child programs. Subagentes internos de um harness só têm teto agregado se o adapter realmente os observa/controla; declarar o limite caso contrário.

Backpressure impõe bytes/ready queue/atividade e admite/nega expansão antes de alocar. Aumentar cap não prova performance. Começar concurrency 4 até medir. Cancelamento ou revogação de policy retira admissões novas; não invalida fatos históricos já observados.

## 9. Retomada, replan e cache

| Caso | Regra |
|---|---|
| Mesmo run/invocação intacta concluída | Ler resultado, candidato e receipts duráveis; não preparar clone nem chamar adapter/modelo de novo |
| Resultado de activity persistido, parent sem commit | Reconstruir parent a partir dos fatos dos filhos, com validação/join; não repetir activity |
| Execução interrompida sem resultado observado | Marcar uncertain, consultar/observar se adapter permite, reconciliar antes de redispatch |
| Replan | Diff de dados/controle/obrigações, invalidação transitiva; preservação explícita de invocations intactas |
| Novo run/cache entre runs | Contrato opt-in separado, fechado sobre entradas e validade; posterior ao MVP |

A retomada exige integridade e acesso a resultados/artifacts/candidates. Corrupção/ausência bloqueia com diagnóstico; não vira cache miss que dispara efeito. Mudança de código do adapter/CLI não reescreve o passado: owner pode ler fatos antigos mas bloquear novo dispatch/apply se incompatível ou revogado. Uma consulta externa com exigência de frescor precisa de nova atividade/obrigação, não I/O implícito em replay.

Capturar definição de invocação: runId, scope path, itemKey/round, operationId, generation, semantic/input/candidate digests e executor/contract refs. attemptId identifica uma execução concreta; reattempt não muda identidade do item. Cada fato de resultado inclui produtor, uso, artifacts e candidato. As operações de controle são reconstruídas deterministicamente desses fatos; não reexecutam chamadas externas.

Barrier/additive/fenced globais existentes continuam conservadores. Preservação de work intacto deve ser explícita mesmo quando a revisão global aumenta: generation de trabalho não deve obrigatoriamente ser igual ao contador editorial do plano. Alterar população/aceite/autoridade fixados requer successor run conforme contrato, não replan que enfraqueça obrigações. Fenced replan local independente é extensão posterior e exige reconciliação de efeitos, não só ignorar outputs tardios.

## 10. Eventos, decisões humanas e deadlines

waitEvent registra alvo, scope, generation, tipo, correlation, subject e prazo. Subject pode ligar decisão a candidate/contract digests. Um evento aprovado para candidato antigo não autoriza outro. Payload válido por schema não basta: actor/autoridade, bindings, expiração e consumo precisam ser verificados pelo owner.

Eventos anteriores ao wait podem ficar em inbox autorizada bounded, sem inventar targets futuros. Duplicatas são idempotentes; geração antiga fica stale e auditável. Consumir evento e fixar decisão é transação única. Receipt de entrada aceita, receipt de decisão e GateReceipt são distintos. Declínio é decisão válida, mas não aprovação; gate exige aprovação compatível quando policy requer.

Deadlines persistidos são absolutos. Tempo de espera conta no deadline do run por default; uma extensão exige decisão autorizada versionada com limite, não reset por resume. Prazo de atividade/check inclui preparação quando pertinente. Owner vivo pode despertar somente o ramo autorizado após evento. Run paused não desperta por evento; restart do owner reconcilia e exige política explícita de continuação. Não instalar serviço/wakeup/automation como efeito da autoria.

## 11. Repair e aceite

`repair` preserva implement-first e assess-first. Campos existentes: recipe, implement, review, checks, entryMode, initialCandidate, writeScope, maxRepairRounds, maxAssessmentAttempts, maxInfrastructureAttempts, progressPolicy. Campos novos propostos: input tipado para contexto, assessmentScope: "item" | "final" e evidence para executores readonly que preparam evidências de avaliação. Todos são refs autorizadas, não código livre.

**Obrigações por fase, sem enfraquecimento pelo autor.** Acceptance v2 tem obligation IDs imutáveis, critérios/evidências e `requiredChecksByScope`; registry vincula operation/recipe aos contextos item ou final admitidos. `assessmentScope` solicita uma dessas bindings, mas o owner verifica a correspondência estrutural: repair dentro do map cobre sua key, avaliação pós-compose obrigatória é final. Declarar item na fase final ou omitir checks não reduz obrigações; validação rejeita antes do dispatch. V1 mantém acceptance.requiredChecks e seu intérprete histórico.

No caso UI, o contrato fixa uma obrigação de layout por key do catálogo, mais obrigações de integração/inventário. Item exige ui-layout@v2 e typecheck@v1 para sua avaliação. Final exige ui-regression@v2 e typecheck@v1, evidência nova de todo o catálogo e revisão com cobertura explícita de cada obrigação de layout e integração. O check de regressão deve observar por item as constraints requeridas de layout; essa ligação entre critérios e validators é aprovada no registry, não inferida pela semelhança de nomes. Se o validator final não comprovar uma obrigação local, o contrato também exige seu checker local no candidato final. O workflow pode pedir checks extras admitidos; nunca um subconjunto mais fraco.

**Interfaces de avaliação propostas (schemas do registry, não novos operadores).**

```text
AssessmentContext = {
  runId, invocationId, assessmentId, phase, candidateRef,
  obligationIds, itemKey?, populationSealRef?, environmentRef,
  evidenceRefs, input
}
EvidenceResult = {
  outcome: observed | infrastructure_failed | inconclusive,
  artifactRefs, proposedCoverage, producerAttemptId
}
AssessmentReceipt = {
  assessmentId, candidateRef, contractRef, phase,
  environmentRef, evidenceRefs, checkResultRefs, reviewResultRef,
  satisfiedObligationIds, unsatisfiedObligationIds, verdict, ownerRecordRef
}
```

O owner cria AssessmentContext. Executores evidence recebem contexto com evidenceRefs inicialmente vazio; seus outputs são validados, e o owner liga CaptureReceipts/artefatos válidos ao contexto dos checks/reviewer. Esses consumidores recebem referências autorizadas com quotas de bytes, imagens e acesso readonly; não escolhem candidate/environment/obligation IDs. proposedCoverage de agente é alegação, não prova owner. Owner emite AssessmentReceipt a partir dos outcomes/critério observáveis, registra cada obrigação satisfeita ou faltante e rejeita evidência de outro candidato, ambiente ou geração. Output aprovado com cobertura omitida não fecha a matriz. Input.ui/catalog ajuda a tarefa, mas não substitui o contexto confiável.

Sequência de uma avaliação: persistir fase/counters → preparar evidência para candidato exato → construir AssessmentContext validado → executar checks pertinentes e reviewer distinto → validar outputs/cobertura → decisão do owner. Checks e review podem rodar paralelos quando dependências de evidência permitem. Reviewer visual recebe capturas emitidas/validadas pelo adapter, não path textual qualquer. Dados de reviewer são assessment proposto; owner emite receipt após verificar linkage/checks/criteria.

Approved + nenhum finding pendente + checks exigidos aprovados + evidências pertinentes válidas permite aceite. Changes_requested ou check de código reprovado permite implementação limitada. Inconclusive ou captura inválida não deve ser transformada automaticamente em defeito visual; corrigir infraestrutura/reavaliar dentro dos budgets ou parar para intervenção. Uma falha de build genuína do candidato é finding/check negativo, distinta de browser indisponível.

MaxRepairRounds conta implementações, inclusive tentativa antes de seus efeitos serem observados; maxAssessmentAttempts conta ciclos de avaliação; maxInfrastructureAttempts conta reattempts operacionais, sem devolver tentativas consumidas. `maxAttempts` global conta dispatches de atividades e reattempts **visíveis ao owner**, incluindo implement/review/check/evidence. Uma atividade SDK não equivale a uma única RPC/model call. Reservar/debitar por tentativa antes do efeito, com ID transacional; reconstrução não devolve nem cobra novamente a mesma reserva. Resume de completed intacto debita zero; reattempt observado debita nova tentativa. maxRepairRounds/maxAssessmentAttempts/maxInfrastructureAttempts têm unidades separadas e counters persistidos. RPCs, provider retries e subagentes internos têm contagem/limite próprios somente quando o adapter realmente os observa/controla; caso contrário declarar unknown/cooperative e não prometer teto de requisições/tokens/dinheiro. Guardar phase, debit e dispatch antes de cada efeito evita replenishment por crash. Efeito incerto sempre exige observação/reconciliação.

Progress policy mede candidato/deltas e findings canonicalizados por schema; thresholds configurados não são prova semântica de melhoria. Stalled/exhausted/inconclusive ficam visíveis e bloqueiam consumers obrigatórios. Um value final não mascara repair rejeitado. Reviewer distinto pode usar mesmo modelo, mas essa separação não garante independência estatística de julgamento.

## 12. Cobertura, contribuições, composição e gate

Population fixa o catálogo esperado, baseline/evidência, itens e exclusões justificadas. Discovery propõe itens; coverageFor compara identidades e checks de inventário owner. Chaves estáveis não são índices de lista. “Todas as UIs” significa todas do catálogo aceito; a qualidade do catálogo é obrigação separada, não prova por declaração do capturador.

Seal fecha a collection. CoverageReceipt prova cumprimento do catálogo. ContributionLedger liga cada item à avaliação e candidato/contribuição aceitos, inclusive zero-delta legítimo. Todos os itens obrigatórios precisam aparecer; filter/take/unique não retiram obrigações. No-work só com autorização em population e acceptance. Partial/quorum têm denominador/seal e faltantes explícitos, sem transformar skipped/failed em aceito.

Compose mantém baseline, pais e deltas de cada produtor; ancestral compartilhado aparece uma vez, patches iguais independentes ainda requerem política de conflito. Antes de aceitar, validar closures e beforeimages. onConflict inicialmente needs-resolution: preservar inputs, emitir conflito e parar. P1/P2 detecta e bloqueia conflito, preserva candidatos/receipts e não promete continuar automaticamente a composição. Não aplicar last-writer-wins nem criar operador resolve automático. Uma extensão de resolução/successor só entra com ResolutionReceipt owner ligando conflictRef, parents/inputs, supersededDeltas, obligations e candidateRef resultante; não exigir que deltas substituídos permaneçam literalmente no novo patch. Contribuições originais permanecem auditáveis e a nova solução exige avaliação final completa. Sem esse contrato implementado, a resolução é trabalho separado autorizado, e o run permanece bloqueado.

Gate verifica candidato, população/contribuições/seals, avaliações, checks, versão semântica e autorização pertinente. Candidato global após composição exige revisão/checks globais mesmo se cada item passou. No MVP UI, a avaliação final cobre **todo o catálogo** no candidato final; cada rodada que altera esse candidato exige nova avaliação completa. Receipts locais são histórico de contribuições, não prova atual de preservação semântica. Otimização seletiva por impacto e reuso por equivalência são posteriores, com regras owner demonstradas; lineage sozinho não basta. Contexto de autorização/decision fica ligado ao candidato e contratos exatos. Approved é aceite de contrato técnico, não aceite humano ou produção por implicação.

### 12.1 Resultados e receipts canônicos a fechar em P0

| Schema desejado | Campos/invariantes mínimos |
|---|---|
| ScopeResult | scopeRef, requiredChildIds, outcomes tipados por filho, joinStatus, successValueRef?; valor só no join válido, diagnóstico disponível mesmo na falha |
| CollectionResult | sealRef, keys/outcomes/valueRefs, totals, completion/quorum, coverage/contribution refs; não pode esconder itens faltantes/uncertain |
| RepairResult | outcome accepted/exhausted/stalled/inconclusive/uncertain/canceled, candidateRef, assessmentReceiptRefs, counters; acceptedCandidate só resolve accepted válido |
| CaptureReceipt | candidate/build/environment/item identities, artifactRef/digest/MIME/dimensões, producerAttempt, freshness/observação owner; não confundir captura registrada com ausência de defeito |
| AssessmentContext/Receipt | Contratos da seção 11; cobertura por obrigação, candidato e ambiente exatos |
| GateReceipt | candidate/program/acceptance/population/seal/contribution refs, matriz final de assessment/checks/evidence, authorizationRef quando requerida, ownerRecordRef |

Outcomes tipados distinguem execução, verdict e aceite. As unions serão schemas discriminados versionados; um JSON com campos iguais a um receipt não recebe autoridade. ScopeResult falho fica em inspeção, sem output fictício. CoverageReceipt histórico do map valida inventário/contribuições e não substitui o AssessmentReceipt final. Gate depende de ambos.

## 13. Efeitos e aplicação

Cada executor declara read, isolated-write, idempotent-effect ou non-idempotent-effect; os dois últimos não ganham exactly-once pela declaração. Adapter precisa especificar chave/receipt/probe/reconciliação; sem isso a execução é cooperativa com outcome uncertain possível. Fonte do autor não faz rede/shell diretamente.

Aplicar é operação externa ao programa de compute por default. program-apply exige GateReceipt atual, autorização válida e destinos/beforeimages observados. Owner persiste ApplyIntent antes da primeira escrita, com candidate/program/contract digests e expected files. Múltiplos arquivos não são transação única de filesystem; partial/interrupted/divergent gera apply-uncertain. Preservar arquivos e reconciliar; nunca repetir automaticamente uma publicação ambígua.

Eventos/replans durante aplicação ficam pending-after-apply; não alteram intent em voo. Revogação/cancelamento verifica admissão e próximas escritas, mas não desfaz o já observado. Applied/canceled final exigem successor run para novo trabalho. Não ampliar publicação npm/deploy como efeito de concluir um plano.

## 14. Adaptadores, capacidades e imagens

Contrato comum de atividade: prepare/admit, dispatch, observe, requestCancel, result, usage, artifacts e reconcile, com versão/identidade. Garantias efetivas explicitam plataforma, sandbox, rede, filesystem e ferramentas. Default Codex atual continua fechado; acesso browser/rede/MCP só entra por capability específica aprovada e adapter que a implemente. Não herdar ferramentas do chat por conveniência.

Command adapters são cooperativos, mesmo com workspace clonado; isso não é sandbox de host/rede. Não afirmar cancelamento confirmado apenas por AbortController ou SIGKILL enviado. Um adapter de outro harness só pode entrar quando os outcomes forem representados corretamente. Subagentes internos precisam de IDs/usage/parent linkage se o produto prometer limites sobre eles.

P2 de UI: artefato imutável de bytes com digest/MIME/dimensões, producerAttempt, baseline/candidate/build/environment digests e identificação de rota/estado/viewport. Browser serve build originada do candidato preparado, com dados de teste/auth fixtures definidos. Caminho em scratch ou URL sem conteúdo persistido não basta para prova. Resolver somente leitura com capacidades scoped; bytes fora do JSON de estado e budgets de imagem/quantidade/resolução.

Captura inválida é outcome separado de defeito visual. Validar tela carregada, URL/estado/viewport, assets/renderização pertinentes e build esperada. Autenticação usa capacidades efêmeras; não persistir tokens/segredos em registry, prompts ou receipts. Ambientes externos voláteis só suportam garantias limitadas declaradas.

Evidence executor pode reaproveitar uma captura já emitida para o mesmo candidato/item/environment dentro da validade owner. Se candidato/contexto mudou, recapturar. Isso evita capturar novamente todas as telas intactas apenas por uma retomada; não confundir com cache cross-run de respostas LLM.

## 15. Exemplo principal: captura, revisão e correção de UIs

API desejada operatorVersion 2, proposta P2. Usa operações/expressões existentes com novas semânticas e campos input/assessmentScope/evidence/mode/operatorVersion. Não é executável na alpha.70. Os executores, schemas, catálogos e checks abaixo são nomes de configuração proposta, não registros já instalados.

```typescript
import {
  defineWorkflow, schemaRef, executorRef, policyRef,
  acceptanceRef, populationRef, recipeRef,
  agent, map, repair, compose, gate,
  output, field, item, population, coverageFor,
  candidateFromBaseline, acceptedCandidates,
  outputCandidate, acceptedCandidate, coverageReceipt,
} from "forgeos/agent-fabric/workflows";

const itemRepair = {
  recipe: recipeRef("repair", "v2"),
  implement: executorRef("corrigir-ui", "v2"),
  review: executorRef("revisar-ui", "v2"),
  assessmentScope: "item",
  evidence: [executorRef("capturar-candidato-ui", "v2")],
  checks: ["ui-layout@v2", "typecheck@v1"],
  entryMode: "assess-first",
  maxRepairRounds: 3,
  maxAssessmentAttempts: 6,
  maxInfrastructureAttempts: 2,
  progressPolicy: {
    unchangedCandidateRounds: 2,
    repeatedFindingsRounds: 2,
  },
};

export default defineWorkflow({
  id: "revisar-e-corrigir-uis",
  version: 1,
  operatorVersion: 2,
  mode: "candidate",
  inputSchema: schemaRef("entrada-ui", "v2"),
  outputSchema: schemaRef("gate-ui", "v2"),
  policy: policyRef("ui-local", "v2"),
  acceptance: acceptanceRef("qualidade-ui", "v2"),
  population: populationRef("catalogo-uis", "v2"),

  steps: [
    agent("capturas", {
      executor: executorRef("capturar-uis", "v2"),
      input: { catalog: population() },
    }),

    map("uis", {
      items: field(output("capturas"), "items"),
      key: field(item(), "id"),
      order: "key",
      completion: "all-required",
      concurrency: 4,
      coverage: coverageFor(population(), output("capturas")),
      body: repair("avaliar-e-corrigir", {
        ...itemRepair,
        input: { ui: item() },
        initialCandidate: candidateFromBaseline(item()),
        writeScope: field(item(), "allowedPaths"),
      }),
    }),

    compose("integrado", {
      candidates: acceptedCandidates("uis"),
      onConflict: "needs-resolution",
    }),

    repair("regressao-global", {
      recipe: recipeRef("repair", "v2"),
      implement: executorRef("corrigir-regressao-ui", "v2"),
      review: executorRef("revisar-ui-integrada", "v2"),
      assessmentScope: "final",
      evidence: [executorRef("capturar-candidato-completo", "v2")],
      checks: ["ui-regression@v2", "typecheck@v1"],
      input: { catalog: population() },
      entryMode: "assess-first",
      initialCandidate: outputCandidate("integrado"),
      writeScope: ["src"],
      maxRepairRounds: 2,
      maxAssessmentAttempts: 4,
      maxInfrastructureAttempts: 2,
      progressPolicy: {
        unchangedCandidateRounds: 2,
        repeatedFindingsRounds: 2,
      },
    }),

    gate("final", {
      candidate: acceptedCandidate("regressao-global"),
      coverage: coverageReceipt("uis"),
    }),
  ],

  result: output("final"),
});
```

Dependências são obtidas pelas refs: capturas → uis → integrado → regressao-global → final. Não há dependência por posição no array. Capturador entrega 20 itens, por exemplo; a primeira avaliação cria 20 reviewer activities. Se 3 itens têm problemas, somente esses itens iniciam implementer. Reavaliações desses itens e avaliação global criam chamadas adicionais; não prometer que o fluxo inteiro usa exatamente 20 revisores e 3 implementadores.

`allowedPaths` do item deve ser confirmado contra o catálogo e as policies owner, inclusive componentes compartilhados. Capturador não concede write authority. Capturar-candidato-ui usa a captura inicial somente se sua identidade/validade corresponder à avaliação; depois de cada alteração produz nova captura do novo candidato.

Regressão-global exige contribution lineage das 20 UIs. A avaliação final recaptura e verifica todas as UIs no candidato integrado, mesmo sem correção global. Se ela modificar código/CSS compartilhado, uma nova avaliação de todo o catálogo é obrigatória; receipts locais anteriores são históricos e não aprovações do conteúdo alterado. AssessmentContext liga capturas aos checks/reviewer, e AssessmentReceipt registra cobertura de cada obrigação. Nenhuma análise seletiva de impacto é presumida neste MVP. O gate valida a matriz de obrigações final para o candidato integrado. Se onConflict detectar overlap, run para antes da avaliação/aplicação, preserva candidatos e bloqueia; continuação por resolução exige o contrato de extensão descrito na seção 12. Saída acceptance-ready não aplica arquivo; aplicação é decisão posterior autorizada.

## 16. Exemplos auxiliares de paralelismo e controle humano

Fragmentos da API futura, não workflows executáveis isolados. Parallel expõe resultado explícito somente no join bem-sucedido; collect-all com filho required falho conserva ScopeResult para status/explain e bloqueia consumidores, sem avaliar result abaixo. Sequence cria controle independente de dados.

```typescript
parallel("analises", {
  onFailure: "collect-all",
  steps: [
    agent("acessibilidade", {
      executor: executorRef("revisar-acessibilidade", "v2"),
      input: { captures: output("capturas") },
    }),
    agent("consistencia", {
      executor: executorRef("revisar-consistencia", "v2"),
      input: { captures: output("capturas") },
    }),
  ],
  result: object({
    accessibility: output("acessibilidade"),
    consistency: output("consistencia"),
  }),
});

sequence("decidir", {
  steps: [
    waitEvent("aprovacao", {
      type: "candidate-approval",
      correlation: field(acceptedCandidate("regressao-global"), "digest"),
      subject: {
        candidate: acceptedCandidate("regressao-global"),
        contract: acceptance(),
      },
      schema: schemaRef("decisao-humana", "v2"),
      timeoutMs: 3600000,
    }),
    gate("ready", {
      candidate: acceptedCandidate("regressao-global"),
      coverage: coverageReceipt("uis"),
      authorization: output("aprovacao"),
    }),
  ],
  result: output("ready"),
});
```

O schema decisao-humana descreve a decisão e receipt emitido pelo owner; não é booleano autodeclarado. Gate rejeita declínio, actor sem autoridade, expiração ou subject diferente. Esse sequence substituiria o gate direto do exemplo principal quando policy exigisse aprovação humana; não adicionar os dois gates independentes e permitir bypass. Timeout precisa caber no deadline do run. Pausar não significa cancelar automaticamente os irmãos; são operações distintas.

## 17. Exemplo de registry e contratos do caso de UI

Não persistir segredos. O registry abaixo é especificação de requisitos, não JSON de configuração atual. Schema/refs/digests serão validados na implementação.

| Registro proposto | Responsabilidade |
|---|---|
| entrada-ui@v2 | Ambiente de teste identificado; overrides de ferramentas/domínios proibidos |
| catalogo-uis@v2 | IDs rota/estado/viewport/auth fixture, baseline, paths autorizados, evidência e exclusões |
| capturar-uis@v2 | Investigator readonly com browser autorizado; retorna itens/capturas duráveis e identidade da build |
| capturar-candidato-ui@v2 | Evidence readonly de item/candidato, valida origem e emite CaptureReceipt |
| revisar-ui@v2 | Reviewer distinto, saída approved/changes_requested/inconclusive, findings tipados e refs de evidências |
| corrigir-ui@v2 | Implementer isolated-write, sem write fora do escopo owner |
| ui-layout@v2 | Command check registrado, valida constraints objetivas pertinentes ao candidato/item |
| capturar-candidato-completo@v2 | Evidence do catálogo para o candidato integrado |
| revisar-ui-integrada@v2 | Avalia resultado integrado e possíveis regressões de componentes compartilhados |
| corrigir-regressao-ui@v2 | Implementer limitado para correções globais autorizadas |
| ui-regression@v2 | Check global de cobertura/renderização/constraints registradas |
| qualidade-ui@v2 | IDs de obrigações por UI/final, bindings de scope/operation, requiredChecksByScope, evidências/cobertura e gate; no-work explicitamente decidido |
| ui-local@v2 | Quotas, deadlines, byte budgets e capacidades browser/SDK/command por papel |
| gate-ui@v2 | Receipt técnico de aceite ligado ao candidato; não recibo de deploy/aceite humano |

Cada executor tem input/output schemas, timeout e capabilities efetivos. Contratos de captura e check recebem o candidato pelo contexto confiável do owner, não só pelo JSON do autor. Capacidade de browser aprovada não habilita rede arbitrária para todos os agentes.

## 18. Persistência, observabilidade e budgets

Manter uma fonte de verdade. Persista inputs/dispatch/results/decisões com ordem de commit definida; projection/UI é derivada. SHA verifica integridade, não autentica uma alegação de verdade por si só. Receipt owner fica em registro confiável e ligado às identidades; um objeto de agente com o mesmo formato não é receipt.

Instrumentar desde P0/P1: tempo de lock/queue/preparation/SDK/check/serialização/hash/fsync, bytes gravados/retidos, uso de memória e recuperação. Cada invocation tem trace de deps/after, generation, attempts, candidate, evidence, budgets e razão de waiting/replay/invalidation. program-explain usa esses fatos. Logs têm redaction e budgets; não copiar transcript inteiro para cada snapshot.

Profiling precede escolha de journal incremental/backend transacional. Otimização preserva atomicidade do registro autoritativo, references commitadas antes de uso, dispatch intent e correção em crash. Crash de processo tem prova separada de power-loss/filesystem. Migração, leitura de histórico e rollback precisam de contrato. GC posterior mantém artefatos alcançáveis por runs, gates, intents, receipts e retenção explícita; nunca apagar prova necessária para apply/reconcile.

Budgets iniciais: owner slots, run/scope concurrency de atividades, itens/ops/profundidade, maxAttempts de dispatches visíveis, prazos, dados/artefatos/imagens e revisions. Reservas/debits têm unidade e ID persistidos, seguem seção 8 e não são repostos na retomada. Calls/retries internos só entram em limites próprios observáveis pelo adapter. Tokens/uso medidos por atividade e role. Cached input é subconjunto de input. Controle financeiro futuro requer preços versionados e reservas para calls em voo; sem limite verificável por chamada, declarar overshoot possível. Não prometer teto monetário rígido a partir de timeout/maxAttempts.

## 19. Entregas e critérios de aceite

| Fase | Entrega delimitada | Gate de aceite |
|---|---|---|
| P0 | ADR: grafo/after/scopes, outcomes/waits/quorum, obrigações por fase e schemas de receipts, resume/replan/cache, keys/compatibilidade; catálogo/API/examples; instrumentação básica | Contraexemplos têm comportamento único; v1 não muda; autorizações/ordens não ambíguas |
| P1a | Resume de completed same-run, reconstrução de pais e budgets; diagnósticos | Siblings completos não chamam adapter/modelo novamente; gaps de commit/corrupção/uncertain tratados |
| P1b | Fila pronta, exclusividade owner/reservas/quotas, sequence/parallel, waiting localizado, joins/quorum/cancelamento | Dependências de dados/controle respeitadas, fairness e deadlock de slots testados, espera não vira falha |
| P1c | Tipos/diagnósticos e ciclo implementação/review/check/compose/gate com agentes simulados; transporte SDK stubado | Mesmo candidato e obrigações ligados, retomada preservada e políticas respeitadas nos cenários determinísticos; nenhuma chamada a modelo |
| P2 | Caso UI com site local/fixtures, capturas e agentes simulados: artifacts/evidence/repair/integration | Capturas ligadas ao candidato, defeitos/infra separados e regressões conhecidas detectadas por checks determinísticos; sem alegar qualidade de revisão por LLM |
| P3 | Profiling/otimização e benchmark determinístico do runtime | Metas e métricas publicadas; comparação real de produto com Claude/LLMs adiada até nova autorização |
| Posterior | Outros harnesses, cache cross-run, fencing local, receitas extensíveis, planner adaptativo | Necessidade demonstrada e contratos anteriores preservados |

Decisão do usuário em 07/10/2026: Forge é usado apenas pelo autor e está em dev; não há requisito de compatibilidade. O runtime adota operatorVersion 2 diretamente, sem interpretador legado ou migração de runs. P1b não é troca silenciosa de for-await por Promise.all. P1c usa implementadores/revisores simulados que produzem patches/findings conhecidos; P2 usa site local e fixtures com defeitos conhecidos. O contrato SDK pode ser validado com transporte stubado, sem iniciar cliente real conectado a provider. Generalização de pesquisa/data vem depois como exemplo adicional, sem bloquear o primeiro valor de produto.

Cada etapa de implementação futura usa checks pertinentes do repo e evidência própria. Toda a matriz técnica deve rodar sem LLM: mocks/stubs fail-closed, contador de tentativas de provider esperado em zero e ausência de fallback para CLI/SDK real. Testes locais de filesystem, subprocessos determinísticos, browser sobre fixture e falhas/crashes injetados podem verificar efeitos reais do runtime sem modelo. Testes que dependem de modelos reais não são gates obrigatórios de implementação, CI ou release e permanecem desativados até nova autorização explícita. Este plano não inicia nenhuma dessas atividades.

## 20. Matriz mínima de verificação

| ID | Cenário | Resultado exigido |
|---|---|---|
| T01 | Grafo A/B independentes, C depende de ambos | Concorrência autorizada; C espera |
| T02 | Controle humano A, writer B sem dado de A | B espera after/sequence, nunca só posição textual; declínio não concede autoridade de escrita |
| T03 | Forward ref em grafo e em sequence | Grafo válido resolve; ciclo de sequence rejeitado |
| T04 | Scope com filho required falho, result usa outro filho | Pai não oculta falha |
| T05 | Cancel-siblings após falha | Completos preservados; ativos observados ou uncertain; nenhum falso sucesso |
| T06 | Map nested com owner quota pequena | Pais não retêm slots; ausência de deadlock |
| T07 | Dois runs/scopes competem | Sem starvation na policy de fairness testada |
| T08 | Wait no root e dentro de map | waiting, não failed; irmãos independentes continuam |
| T09 | Evento cedo/duplicado/expirado/geração antiga | Consumo único e binding correto; histórico preservado |
| T10 | Declínio humano ou receipt fabricado | Não satisfaz gate nem autoriza apply |
| T11 | Restart durante wait | Prazo absoluto e obrigação preservados |
| T12 | Fan-out N−1 complete/um falho | Resume chama só o afetado; mesmo resultado/candidato para completos |
| T13 | Activity commitada, parent não commitado | Reconstrução sem segunda execução |
| T14 | Dispatch ocorreu, output não observado | Uncertain e reconciliação; não redispatch cego |
| T15 | Artifact perdido/corrompido | Diagnóstico e bloqueio, sem cache-miss com efeito |
| T16 | Replan troca entrada de um ramo | Invalidação de afetados/dependentes; intactos preservados explicitamente |
| T17 | Resume após budget esgotado | Não repõe implementação/assessment/infra/global |
| T18 | Capture inválida versus UI defeituosa | Classificação diferente, sem correção visual indevida |
| T19 | Imagem de baseline antigo ou candidato diferente | Inconclusive/bloqueio; não aprovado |
| T20 | Descoberta omite item required/no-work indevido | Coverage recusada |
| T21 | Partial/quorum usado para gate all-required | Recusado, faltantes explícitos |
| T22 | Repair rejeitado seguido de value | Rejeição não mascarada |
| T23 | UI sem defeitos | Zero implementações do item, assessment/evidência válidos |
| T24 | Duas correções de CSS compartilhado | Inputs/receipts preservados, conflito bloqueia MVP sem resolução automática |
| T25 | Diamond/shared ancestor e patches iguais independentes | Ancestral uma vez; conflito independente preservado |
| T26 | Correção global altera item antes aprovado | Todo o catálogo reavaliado no candidato final; obrigação antes aprovada pode reprovar |
| T27 | Gate para candidato A, apply candidato B | Recusado |
| T28 | Beforeimage alterada e aplicação parcial | Destino preservado; apply-uncertain, sem retry silencioso |
| T29 | Dados readonly declaram accepted ou receipt falso | Sem autoridade de publicação |
| T30 | Lowerer recebe import/callback/I/O arbitrário | Rejeitado antes de dispatch |
| T31 | IDs/types/fields inválidos e expressão gigante | Diagnóstico/limite antes de alocação/execução |
| T32 | Modelo/harness produz nested agents sem controle | Capacidade/limite declarado; nenhuma garantia agregada fictícia |
| T33 | Policy revogada após atividade completa | Fato histórico legível, novo dispatch/apply bloqueado |
| T34 | Crash em commit de decisão/result/intent | Fonte de verdade consistente; efeitos classificados |
| T35 | GC/retention proposto apaga artifact gated | Impedido enquanto alcançável/retido |
| T36 | Checks locais/finais distintos e omissão pelo autor | Binding owner correto; omissão/rebaixamento rejeitado antes de dispatch |
| T37 | Reviewer/check sem refs, cobertura de item omitida ou ambiente trocado | AssessmentReceipt/gate recusados; contexto confiável exigido |
| T38 | Quorum inválido, 2/3 com waiting e quorum impossível | K validado; waiting mantém aberto; timeout só por contrato; falha abaixo de K explícita |
| T39 | Collect-all com filho required falho e result usando esse output | ScopeResult diagnóstico persistido; result não avaliado; sibling completo preservado |
| T40 | Keys é/e\u0301, slash e restart em outro locale | Colisão NFC rejeitada; encoding único; identidade/ordem UTF-8 estáveis |
| T41 | Dois owners, crash em reserva/dispatch e worker órfão vivo | Admissão exclusiva; reservas reconstruídas sem perda/dupla liberação; uncertain conservado |
| T42 | Crash antes/depois do debit, retry SDK interno e completed resume | Debit por dispatch visível sem duplicar; retry novo debita; completed zero; limites internos declarados |
| T43 | Futura resolução substitui deltas e perde obrigação | Receipt de extensão e cobertura final exigidos; não aceitação pelos receipts locais antigos |

Fixtures testam contratos e não provam qualidade visual/modelo nem integração live com provider. Piloto SDK real e avaliação de qualidade com LLM estão adiados por instrução do usuário, sem bloquear os gates técnicos determinísticos. Typecheck/lowering/schema e execução futura devem testar a mesma definição; apenas aceitar sintaxe não valida semântica de API. Os cenários T01–T43 usam agentes simulados, transportes stubados e fixtures; T43 é teste da extensão apenas quando ela for implementada.

## 21. Benchmark e comparação com Claude DW

Executar somente a avaliação de correção/performance do runtime com adapters determinísticos e falhas injetadas. Avaliação do produto com modelos reais e execução de Claude DW ficam adiadas até nova autorização explícita. Uma referência procedural que não executa Claude nunca recebe rótulo “benchmark Claude”. O protocolo abaixo permanece documentado para eventual avaliação futura; não é trabalho autorizado agora. Se Fabric usa Codex e DW usa Claude, o resultado é do sistema completo. Comparação causal de runtime exige harness/modelo/ferramentas efetivamente equivalentes, quando isso for possível.

Congelar tarefas/dataset/falhas, baseline, prompts por papel, ferramentas, isolamento, concorrência e critérios antes da execução. Dois cenários de autoria: workflow cuidadosamente escrito e geração por prompt; não misturá-los como se fossem a mesma medição. Repetições com ordem contrabalanceada; evaluator externo cego para origem do candidato. Avaliar candidato integrado, não só alterações isoladas.

Métricas: obrigações/cobertura, falsos aceites, regressões, chamadas repetidas, tempo normal/recuperação, tokens por papel e uso/custo com incerteza, bytes/I/O e esforço/erros de autoria. Prompt cache é feature do provider distinta de saved-result replay. Preservar/configurar explicitamente defaults do concorrente e publicar limitações, falhas e dispersão.

Hard gates iniciais: zero aceite fabricado/obsoleto nos cenários determinísticos; nenhuma repetição silenciosa de efeito incerto; same-run completed intacto gera zero novas chamadas; zero aplicação de candidato diferente do gated. Metas de latência/custo/esforço são fixadas após profiling baseline e antes do pareamento, sem inventar percentuais agora. Superioridade declarada somente nas dimensões/tarefas/configurações medidas.

## 22. Limites e extensões posteriores

Fora do núcleo inicial: JS/TS irrestrito, YAML nativo, discovery streaming ilimitado, race, serviço distribuído, novos MCPs/credenciais globais, wakeup automático, exactly-once externo genérico, cache SDK cross-run, live replan local, múltiplos providers completos e GC automático não especificado. Qualquer extensão exige necessidade demonstrada, versionamento e matriz de invariantes.

Planner LLM posterior pode propor expansão/branches/plan diff, mas owner valida budgets, obrigações, capacidades e autoridade antes de materializar trabalho. Ele não pode retirar itens/critério porque ficou difícil, aprovar seu próprio candidato ou substituir decisão humana. Dados externos não tornam autorização legítima.

## 23. Fontes e rastreabilidade

- [Claude DW](https://code.claude.com/docs/en/workflows): referência de autoria/script e comportamento público de replay; não avaliação de código interno.
- [Claude subagents](https://code.claude.com/docs/en/sub-agents): referência de capacidades/isolamento que precisam de comparação equivalente.
- [Temporal workflow definition](https://docs.temporal.io/workflow-definition): referência de determinismo/atividades; código também pode ser durável.
- [Temporal messages](https://docs.temporal.io/encyclopedia/workflow-message-passing): referência da separação entre receber evento e obter decisão/resultado.
- [LangGraph checkpointers](https://docs.langchain.com/oss/javascript/langgraph/checkpointers): referência de preservação de nós concluídos quando outro falha.

Baseline local lido: program-dsl.ts, program-contract.ts, program-service.ts, program-worker.ts, program-store.ts, codex-sdk-worker.ts em `C:\Users\stahl\Projects\forge\src\forge\agent-fabric`; docs/agent-fabric-programs.md e WORKFLOW_PROGRAM_V2_PLAN.md; evidências de entrega e revisão anterior em outputs. Artefatos anteriores: COMPARACAO_FABRIC_VS_CLAUDE_DW.md e REVISAO_PLANO_EVOLUCAO_FABRIC_VS_CLAUDE_DW.md. Esses documentos registram o baseline, não autorizações para implementar ou executar este plano.

## 24. Revisão desta edição

R1 examinada pelo novo subagente verify_revised_fabric_workflow_plan: SHA256 A1227F2CDE7C1E21DF3B468616B1346AD4728646C2575FDEEC0C8B6D54908893. Parecer: REVISAO_NOVO_PLANO_AGENT_FABRIC_WORKFLOWS.md, SHA256 C2727DCB39C58DBE1A423F392AEE9B972FE3CDE83BF22EC9780B7A6511B0DA24 (edição original do parecer, antes da confirmação R2).

R2 incorpora F1–F7: obrigações item/final e AssessmentContext/Receipt; quorum com threshold e settle; collect-all diagnóstico; keys NFC antes de unicidade; exclusividade owner/reservas/órfãos; unidade observável de maxAttempts; MVP de conflitos bloqueia e resolução fica como extensão especificada. Acrescenta schemas canônicos e T36–T43. Catálogo fonte conferido: 11 operadores, 29 expressões, 7 refs e defineWorkflow; sequence/parallel são as únicas novas funções de autoria.

A confirmação da R2 deve ser consultada no parecer independente, que registra o hash final examinado e sua conclusão. O hash do documento não pode ser embutido nele próprio; constará do parecer. Pesquisa/inspeção estática não constitui validação de implementação; não foram executados workflows, testes, owner ou modelos.

R2.1: restrição direta posterior do usuário — “nao quero rodar testes reais com llm para nao gastar”. Substitui os gates de pilotos/modelos reais por validação determinística, transporte stubado e fixtures; posterga benchmark de produto/Claude até nova autorização. A aprovação independente registrada refere-se ao hash da R2, e não a esta edição posterior. A arquitetura e o exemplo conceitual permanecem os mesmos; nenhum teste ou workflow foi executado nesta atualização.
