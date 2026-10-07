# Implementation status, 2026-10-07

This is the reviewed R2.1 design plan, including proposed illustrative syntax. For the
executable alpha contract and its conservative F6/F7 boundaries, read
[program workflows](../../agent-fabric-programs.md),
[implementation decisions](WORKFLOW_PROGRAM_V2_ADR.md) and
[evidence](WORKFLOW_PROGRAM_V2_EVIDENCE.md). An implementation release does not mark every
future acceptance item in this plan complete.

# Agent Fabric: plano corrigido para workflows expressivos e duráveis

Data: 7 de outubro de 2026. Estado: proposta de evolução, não implementação nem aceite de produto. Revisão R2.1: incorpora os dois bloqueios e as seis correções importantes encontrados na revisão independente de R1, mais a clarificação de escopo da revisão integral R2. A versão final é submetida ao mesmo novo revisor. Todas as APIs, tipos e arquivos v2 abaixo são propostas, salvo indicação explícita de capacidade existente.

Baseline de código consultado: `C:\Users\stahl\Projects\forge`, commit `c8dfdf0c0c3cd6610bab68b4872ab9dcf8d4214c`. Os documentos e alterações locais já existentes não foram substituídos. O plano não autoriza mudanças de código, novos workers pagos, publicação, deploy ou configuração global. A implementação futura usará a autorização que o usuário conceder para seu escopo, sem solicitar confirmação redundante para cada passo reversível.

## 1. Objetivo e critérios de sucesso

O objetivo é permitir que Codex e desenvolvedores escrevam workflows que descubram trabalho, distribuam tarefas, avaliem resultados, corrijam candidatos e integrem alterações, com uma forma de autoria tão acessível quanto um programa de orquestração. O runtime deve preservar estado, evidências e decisões durante falhas e intervenções.

A meta de superar Claude Code Dynamic Workflows deve ser avaliada, e não assumida. O diferencial pretendido é combinar autoria expressiva, recuperação por dependências, continuidade explícita de candidatos e intervenção humana persistida. Formato JSON, número de agentes, schemas ou pareceres adversariais não demonstram superioridade isoladamente.

Critérios de produto:

1. Uma lista descoberta durante execução pode gerar trabalho sem o coordenador escrever um nó e um executor manualmente para cada item.
2. Revisão negativa alimenta correção dentro do workflow sem aprovar o resultado final.
3. Reinício conserva candidatos, resultados válidos, decisões e obrigações; não repete efeitos desconhecidos silenciosamente.
4. Alterar um ramo não repete ramos independentes com entradas ainda compatíveis.
5. Integração, revisão e checks finais observam o mesmo candidato integrado.
6. Um evento humano autorizado altera o comportamento futuro de forma persistida e auditável.
7. Quantidade de itens, concorrência, contexto, tempo e uso são limitados por política externa ao programa.
8. Autoria, execução e inspeção permanecem disponíveis pelo Codex; o usuário não precisa operar uma segunda interface ou escrever requests JSON.

## 2. Baseline implementado e lacunas

O Fabric atual já tem tarefas acompanhadas `attached-*`, snapshots, revisão distinta, checks, cobertura e prontidão. Possui reducer de workflow com dependências, decisões, joins, tentativas, gerações, revisões e invalidação transitiva. Runs gerenciados `run-*` despacham SDK e comandos, criam clones, compõem artefatos das dependências e aplicam mudanças locais com gates. Esses fatos foram conferidos no código; o piloto SDK real de 05/10/2026 está registrado nos docs, mas não foi reexecutado para escrever este plano.

Limitações relevantes:

| Situação existente | Evolução proposta |
| --- | --- |
| Cada nó gerenciado exige executor explícito | Templates e fábricas validadas materializam nós e executores |
| Replan exige ausência de tentativas ativas/incertas | Primeiro barreiras seguras; depois extensão independente e fencing por ramo |
| `changes_requested` marca falha e bloqueia o run | Resultado operacional separado do verdict; feedback consumível |
| Relatório SDK fixa campos genéricos | Envelope operacional com saída tipada por etapa e artefatos por referência |
| Obrigações ligadas a nós `required` | Contrato de aceite estável, separado da topologia das rodadas v2 |
| Eventos de status são uma janela limitada | Histórico durável de operações e projeções compactas de progresso |
| Limites gerenciados de 32 nós e concorrência 4 | Expansão paginada e limites distintos de template, itens, janela e concorrência |
| Bridge acompanhado invalida pelo escopo inteiro | Preservar conservadorismo v1; melhorar v2 somente com entradas completas |

Não há garantia atual de App fechado, wakeup, serviço de sistema, encerramento de toda árvore de processos ou atomicidade da aplicação de múltiplos arquivos contra desligamento. Esses limites não são apagados pelo desenho v2.

## 3. Decisão arquitetural

Preservar o reducer puro, os mecanismos de concorrência, capturas, artefatos e reconciliação. Acrescentar uma camada de programa e um contrato v2, sem redefinir silenciosamente as APIs ou os resultados dos runs v1.

```text
Pedido no Codex / autoria humana
              ↓
DSL tipada e limitada de workflow
              ↓ validação e lowering sem executar código arbitrário
ProgramIR versionada: templates, expressões, schemas e obrigações
              ↓ expansão persistida conforme os resultados
ExecIR: operações materializadas, dependências, gerações e tentativas
              ↓
Owner: scheduler, journal, políticas, workers e artefatos
              ↓
Gates de candidato, revisão, checks e aplicação local
```

O DAG é uma projeção materializada do trabalho corrente; não precisa conter todas as iterações e itens futuros desde o início. O programa contém templates para materializá-los.

Workflows de aplicação do Forge e workflows do Fabric continuam subsistemas distintos. Podemos reutilizar primitives compatíveis de idempotência, persistência e retry depois de mapear seus contratos; seu runtime atual não deve ser apresentado como um interpretador pronto de programas dinâmicos.

## 4. Autoria v2: uma DSL, não TypeScript arbitrário

Escolha inicial: DSL com aparência e tipos TypeScript, compilada por um lowerer que reconhece um subconjunto declarativo. O lowerer não importa e executa o módulo do usuário para obter um objeto.

Subconjunto inicial: imports declarativos somente da biblioteca DSL versionada; literais; bindings constantes sobre esses literais; referências de dados; construtores de operações; templates aninhados e expressões puras reconhecidas pelo compilador. Condições e seletores usam operações como `eq`, `and`, `field` e `output`, convertidas a uma AST de expressão tipada. Sem `eval`, closures arbitrárias, I/O, imports dinâmicos, acesso ao relógio, aleatoriedade ou leitura implícita de variáveis de ambiente.

O catálogo de transformações puras deve ser finito, versionado, limitado em tempo/tamanho e validado. Bibliotecas e módulos não reconhecidos falham na validação; não são executados para descobrir seu significado. Uma transformação complexa pode virar atividade explícita com entradas, saída e política próprias. Não esconder efeitos em expressões.

Antes de congelar a autoria ou implementar o compilador de produto, produzir ADR semântica e um protótipo limitado de expressividade. Comparar opções de autoria sobre a mesma IR quando necessário, sem construir dois runtimes de produto. Se uma API assíncrona restrita for preferível, uma ADR substitutiva deve definir replay, isolamento e compatibilidade; não prometer compilação genérica de `async`/closures.

O protótipo precisa expressar pesquisa com filtro/deduplicação/ranking e resultados parciais, migração de 80 itens, loop com estado acumulado, branch com saídas diferentes e merge tipado, map aninhado/subworkflow, conflito de integração e evento enviado antes do wait. Medir tamanho do programa, erros de autoria e clareza da inspeção. A aparência TypeScript não comprova equivalência à expressividade de um script JavaScript.

Schemas, executores, receitas e contratos externos usam referências de registry com versão e digest, resolvidas pelo owner sem executar módulos de autoria. Schemas inline só podem usar literais reconhecidos. Um símbolo importado de um módulo arbitrário não é um schema válido da DSL. Referências de outputs inferem dependências; a ordem do array steps não cria sequência implícita. O programa declara uma expressão result compatível com outputSchema, inclusive os estados de negócio permitidos.

Operações mínimas de ProgramIR:

| Operação | Semântica |
| --- | --- |
| `agent` | Worker com papel, prompt/entradas, schema de saída, efeito e limites |
| `command` | Comando com argv explícito, parser/classificação de resultado e política de efeitos |
| `map` | Expande coleção persistida usando identidade estável, template, limite e política de conclusão |
| `branch` | Seleciona ramos por expressão pura ou decisão estruturada de agente |
| `loop` | Materializa rodadas com estado persistido, progresso e término explícitos |
| `compose` | Combina candidatos com ancestralidade e política de conflito |
| `gate` | Avalia obrigações e evidências sobre um candidato identificado |
| `subworkflow` | Invoca programa versionado, com identidade de invocação e orçamento herdado |
| `waitEvent` | Aguarda entrada humana/externa autorizada, tipada e persistida |

`repair` é uma receita versionada de biblioteca sobre agent/command/loop/gate; não introduz um segundo motor. Toda invocação, inclusive no body de map, recebe ID estável. Seus passos internos usam namespace de invocação/item/rodada/etapa. Checkpoints são fronteiras de commit do runtime; um operador de checkpoint explícito pode etiquetá-las, mas nenhuma etiqueta sozinha garante durabilidade.

Branch registra a seleção e valida o merge tipado. Ramos não selecionados ficam skipped e não prendem o join; isso não remove obrigações externas de aceite. Uma decisão de agente só seleciona alternativas autorizadas pelo owner. Subworkflow fixa programa/operadores, identidade de invocação, profundidade e orçamento herdado; retry do pai não cria outro filho nem repete efeitos do filho. Cancelamento e incerteza pertinentes propagam ao pai. Recursão fica desabilitada inicialmente.

## 5. Contratos de dados e identidades

Tipos conceituais propostos:

```text
WorkflowProgram: schemaVersion, workflowId, programVersion, programDigest,
  DSLVersion, operatorVersions, inputSchema, outputSchema,
  templates, acceptanceRef, policyRef

Run: runId, programDigest, baselineRef, acceptanceVersion, policyVersion,
  stateVersion, status, journalCursor, scopes, budgets

LogicalOperation: logicalStepId, templateId, invocationPath, itemId?, round?,
  generation, localSemanticDigest, dependencies, executorSpec, inputRefs

Attempt: attemptId, logicalStepId, generation, inputDigest, executorIdentity,
  executionOutcome, startedAt, completedAt?, receipts, outputRef?

StepOutput: schemaId, schemaVersion, dataRef, artifacts[], evidence[], summary

Candidate: candidateId, snapshotDigest, baselineRef, parentCandidateRefs[],
  artifactRefs[], producerAttemptRefs[]

CandidateDelta: deltaId, inputCandidateDigest, outputCandidateDigest,
  beforeimages, changes, producerAttemptRef

Assessment: assessmentId, candidateRef, verdict, findings[], checkResults[],
  assessorAttemptRef, provenance

PopulationContract: populationId, version, baselineRef, definition,
  inventoryValidatorRef, allowedExclusions, allowNoWork, requiredEvidence

CoverageManifest: populationContractRef, expectedMembersRef, observedMembersRef,
  exclusionsWithReasons, inventoryDigest, discoveryDigest, provenance, verdict

CapabilityContract: adapterIdentity, argv, cwd, effectiveEnvironmentRef,
  tools, network, candidateWriteScope, allowedGeneratedPaths, isolationEvidence

ApplyIntent: intentId, candidateDigest, gateReceiptId, populationDigest,
  collectionSeals, programRevision, acceptanceVersion, policyVersion,
  authorizationRefs, targetBaseline, beforeimages, expectedAfterimages
```

`logicalStepId` identifica o trabalho, não o conteúdo nem a posição atual na fila. Sua identidade deriva de caminho de invocação, operação, item estável e rodada. `attemptId` é outra identidade para cada execução concreta. Conteúdo alterado muda o inputDigest e a geração aplicável, não necessariamente o item lógico.

A chave de map precisa ser única e estável. Duplicatas ou colisões de normalização são erros visíveis. Índices de lista não são identidades. Paths só servem como itemId se o contrato tratar renames; o exemplo usa um ID de componente separado do path. Ordem de enumeração e ordem de composição são declaradas e normalizadas.

Referências são imutáveis, vinculadas ao run ou a uma fonte permitida. Um worker não pode introduzir referências arbitrárias ao filesystem, fabricar receipts ou usar handles pertencentes a outra revisão. Resolver uma referência sempre revalida escopo, digest e disponibilidade.

Candidate é uma descrição imutável de snapshot. Aceite, rejeição e supersessão são eventos/projeções vinculados ao digest, não campos mutáveis no objeto. Delta descreve a transformação entre dois snapshots; não confundir patch com snapshot completo.

## 6. Resultado operacional separado de avaliação

`executionOutcome`: `completed | infrastructure_failed | invalid_output | uncertain | canceled_confirmed`.

`reviewVerdict`: `approved | changes_requested | inconclusive`.

Uma revisão pode terminar como completed e retornar changes_requested. Isso produz feedback válido, mas não aprova o candidato. Schema inválido não vira reprovação de negócio: é invalid_output e só tem retry sob política explícita. Inconclusive não é aprovado nem refutado.

Comandos possuem resultado observado de processo separado do significado de um checker. Um exit code não zero esperado pode significar completed com checkResults.failed. Falha de lançamento, deadline ou processo sem resultado conhecido são categorias próprias. A classificação é definida pelo adaptador/política versionados; o modelo não redefine quais códigos significam teste aprovado.

O envelope de relatório operacional é controlado pelo executor. O payload de negócio usa schema por etapa, validado antes de consumo. Schemas, resolvers e validators têm digest/versão; requests e objetos têm limites de tamanho e profundidade. Relato agent_reported continua distinto de observação executor_observed e de aceite humano.

## 7. Transporte de dados, artefatos e contexto

Dados pequenos são serializados e validados; dados grandes, patches, logs e imagens vão a artefatos imutáveis referenciados por digest. Persistir metadata e resumo no estado quente, evitando copiar relatórios inteiros para cada prompt ou recibo.

Workers recebem seleção explícita de entradas e referências das dependências, com resolvers somente leitura limitados ao escopo e ao orçamento. Dados de outros agentes são fonte não confiável, não instrução que amplia autorização. Mensagens de coordenação pertencem ao contrato do owner.

Chunks, paginação e streaming de coleções precisam de integridade e versão. Para v2 inicial, discovery produz uma coleção finita persistida; streaming incremental virá depois. Não concluir um map porque a janela atual esvaziou enquanto ainda há itens não materializados.

Garbage collection só remove artefatos fora das referências de runs ativos, checkpoints, retenção de recuperação e relatórios publicados. Antes de remover, calcular reachability; replay com artefato ausente falha explicitamente e não dispara um efeito externo para tentar reconstruí-lo.

## 8. Persistência, checkpoints e replay

Transições de run, expansão, tentativa, evento humano e intent de efeito precisam de commit durável antes do despacho correspondente. ACK só confirma estado persistido. Reutilizar requestId exige corpo idêntico; mutations usam versão esperada. Preservar as invariantes de CAS e replay existentes.

Implementar um journal durável versionado e checkpoints, com recuperação de gravações incompletas, integridade e monotonicidade de cursors. A janela de eventos para UI é uma projeção desse histórico, não o único registro de causalidade. A ADR define uma única fonte autoritativa de transições, integrada ao store existente; não manter dois stores independentes com dual write. Checkpoints são folds derivados, validados contra cursor/digest do journal. Artefatos precisam estar persistidos e íntegros antes de confirmar outputRefs. Staging, commit e recuperação de órfãos fazem parte do contrato.

Especificar separadamente falha do processo e perda de energia. Flush, replace e garantias reais do filesystem/host precisam de evidência; não atribuir durabilidade contra desligamento a um rename ou ACK em memória.

O reinício não restaura uma pilha JavaScript. Reconstrói ProgramIR, ExecIR, estado de loops/maps, outputs, decisões e intents a partir de dados persistidos. Expressões puras são reavaliadas sobre as mesmas entradas persistidas; chamadas de agentes já concluídas retornam sua saída válida sem nova chamada.

Isso não torna o modelo determinístico: replay reutiliza a saída observada. Uma nova tentativa pode produzir outro resultado e recebe attemptId próprio.

Fingerprint de reutilização inclui entradas completas, candidato e artefatos, prompt, schemas/validators, semântica local de template/receita/operadores, executor, configuração efetiva de modelo quando observável, ferramentas, ambiente/lockfiles e política pertinente. O inputDigest captura o estado realmente preparado, não apenas o hash declarado pelo autor.

programDigest global registra auditoria; localSemanticDigest determina compatibilidade da operação. Adicionar um item independente não invalida todos os itens pelo hash global. Membership e proveniência da coleção são separados das entradas individuais; aggregators e operações que dependem do conjunto recebem o digest do conjunto fechado. Mudança de texto descritivo sem efeito semântico não altera a compatibilidade. Mudança de operador/intérprete exige regra explícita de compatibilidade; o default é recusar reuso sem prova.

Output de geração antiga nunca satisfaz diretamente a nova geração. Um ReuseReceipt validado registra output original, nova operação/geração, fingerprint e regra de compatibilidade. Sem observação confiável de read set, incluir todo o snapshot preparado visível ao worker, mesmo que isso reduza reuso. WriteScope pequeno não prova read scope pequeno.

Sem observação completa das entradas, usar invalidation conservadora. Eventos SDK não garantem um read set completo. Dependências externas mutáveis exigem observação versionada ou não são reutilizáveis. Cache cross-run fica desabilitado inicialmente; reuso no mesmo run depende de compatibilidade comprovada.

Mudança de programa não altera uma execução em curso implicitamente. Continuar com versão antiga ou pausar e aplicar migração explícita, com diff de operações, efeitos sobre inputs e aceite, referências de evidência e nova revisão. Não migrar tentativas incertas. Versões antigas permanecem interpretáveis durante sua retenção.

## 9. Distribuição dinâmica e fechamento de map

Map contém template, coleção versionada, chave, política de conclusão, limite de itens, concorrência e ordem de agregação. Materialização persiste itemId, operação, geração e claim antes do dispatch. Filas são paginadas; a janela materializada pode ser pequena mesmo com muitos itens.

Default para migração: `completion: all-required`. Pesquisa pode declarar parcialidade ou quorum; o relatório deve mostrar itens falhos/incertos e não apresentar cobertura completa. Essas políticas não podem reduzir um requisito externo de cobertura total. Após quorum, cancelamento dos demais trabalhos exige resultado observado; incerteza pertinente impede conclusão sem reconciliação, mesmo que o número de respostas já seja suficiente.

Map só conclui após coleção fechada, cobertura da população validada, todos os itens obrigatórios em estado terminal aceito, agregação persistida e nenhuma tentativa incerta pertinente. Um seal é imutável. Antes de aplicar, item tardio cria nova versão da coleção, invalidando gates/aggregators pertinentes; não edita o seal antigo. Durante aplicação segue a fronteira da seção 12. Após run terminal, trabalho adicional exige revisão sucessora explícita e vinculada; não altera retroativamente o run nem seus arquivos aplicados.

### População e cobertura independente da descoberta

All-required comprova todos os itens da coleção recebida, mas não comprova que discovery encontrou todos os itens do objetivo. PopulationContract externo fixa baseline, definição da população, validator registrado e exclusões permitidas. CoverageManifest compara membros esperados e observados, registra origem/digests e justificativas de exclusão. O owner valida a cobertura por inventário/validator independente do agente de discovery; não aceita a própria declaração de completude do agente como prova.

Quando a população é enumerável, omissões, extras fora do escopo e exclusões sem autorização impedem seal aceito. Renames seguem o mapeamento de identidade do contrato. Se o alvo é semântico, globs ou inventário AST não provam sozinhos que todos os casos semânticos foram encontrados: o contrato precisa da evidência/avaliação adequada, e cobertura inconclusiva fica needs-attention. Não prometer prova universal de discovery por LLM.

Coleção vazia não produz sucesso por verdade vacuamente satisfeita. Só pode gerar resultado explícito no-work se allowNoWork estiver autorizado e a ausência de trabalho tiver evidência independente suficiente para o objetivo. Caso contrário é cobertura inválida/inconclusiva. No-work satisfaz apenas obrigações cujo contrato admite esse resultado e não gera uma aplicação vazia disfarçada de migração concluída.

Backpressure controla itens pendentes, workers ativos, bytes de artefatos e retenção de resultados. Não resolver escala apenas aumentando o limite de 32 nós. Introduzir limites distintos de templates, itens, operações materializadas totais, janela ativa, tentativas e concorrência. O default inicial não aumenta concorrência 4 sem medição.

## 10. Loops e receita de repair

Loop tem estado tipado, limite de rodadas e tempo, critérios de progresso, predicate de aceite, política de exaustão e mapa de artefatos/candidatos por rodada. Cada rodada materializa novas identidades; não recicla tentativas para simular continuidade.

Recipe repair fixa entryMode, progressPolicy, limites e versão. Implement-first executa a primeira migração antes da avaliação. Assess-first avalia o candidato recebido e pode retornar accepted com zero implementações; é o default de integração. Em ambos os modos, revisão/checks da decisão observam exatamente o mesmo candidato.

Recipe repair:

1. Receber candidato inicial, critérios, escopo e checks.
2. Preparar workspace sobre o candidato anterior, aplicando sua ancestralidade.
3. Conforme entryMode e avaliação anterior, executar implementação ou correção com feedback vinculado ao candidato observado; assess-first não modifica um candidato já aceito.
4. Capturar novo artefato e candidato, validando beforeimages e writeScope.
5. Executar revisão distinta e checks configurados sobre esse candidato.
6. Se satisfeito o gate da rodada, registrar aceite do candidato; senão persistir findings e decidir a próxima rodada permitida. Inconclusive permite reavaliação/escalada limitada por política; não é ordem automática para editar código.
7. Em interrupção/efeito incerto, parar esse ramo para reconciliação; não transformar incerteza em reprovação comum.

Não exigir aprovação de todos os candidatos antigos. `supersedes` identifica a substituição, conservando história e razões; não autoriza apagar requisitos. O candidato final precisa cobrir as obrigações ainda vigentes.

Terminação: `accepted | exhausted | stalled | uncertain | canceled`. MaxRounds atingido sem aceite produz exhausted e needs-attention por default; nunca retorna o último resultado como aprovado. Stalled usa critérios verificáveis, como candidato inalterado e fingerprint de findings repetido por rodadas declaradas. Não usar só a opinião do implementador para medir progresso.

maxRepairRounds conta implementações/correções com resultado capturado, incluindo a implementação inicial em implement-first. Avaliações iniciais e reavaliações têm contador/limite assessmentAttempts; falhas de infraestrutura têm infrastructureAttempts. Todos consomem orçamento global; reservar tentativas antes de dispatch, inclusive as que não chegam a produzir candidato. progressPolicy declara critérios e janela de observação, como candidato inalterado ou findings repetidos por duas rodadas, sem atribuir progresso somente à opinião do agente. Cada retry verifica política do efeito e backoff; não é ilimitado. Replan é alteração de estratégia, não sinônimo de retry ou repair.

RepairResult é união discriminada: accepted contém acceptedCandidate e receipts de avaliação; exhausted/stalled/uncertain/canceled contêm estado, último candidato diagnóstico e pendências, sem campo acceptedCandidate. Seletores acceptedCandidate/acceptedCandidates exigem prova de estado accepted. Compose não consome um candidato apenas porque existe uma saída de repair; branches de falha devem tratar a união explicitamente.

## 11. Aceite independente da topologia

AcceptanceContract é versionado e controlado pelo owner: objetivo, escopo, critérios com IDs estáveis, checks, cobertura, revisão, autorização e evidências exigidas. O programa define estratégia para cumpri-lo, mas não pode reduzir obrigações ou aprovar a própria expansão de privilégios.

Final gate precisa comprovar:

1. Conjunto exigido de itens fechado e coberto.
2. Candidato escolhido e artefatos de composição identificados.
3. Revisão distinta aplicável ao digest desse candidato.
4. Checks obrigatórios satisfeitos sobre o mesmo candidato e ambiente pertinente.
5. Findings bloqueantes resolvidos com evidência ou decisão autorizada; inconclusivos não são aprovação.
6. Ausência de tentativas/efeitos incertos pertinentes ou publicação parcial.
7. Autorização compatível com ação, escopo e versão de aceite.

O gate produz GateReceipt imutável ligado ao candidato, CoverageManifest, seals de coleções, revisão do programa, obrigações/política, avaliações e autorizações pertinentes. Atualização de métrica/UI não invalida o gate; mudança semântica de qualquer entrada pertinente invalida. Gate aprovado significa acceptance-ready, não arquivos aplicados. Um retorno de programa declara explicitamente accepted/no-work/needs-attention conforme seu schema; o estado aplicado depende de outra operação e receipt.

IDs diferentes são evidência cooperativa de separação de execução; não garantem diversidade intelectual ou identidade criptográfica. Preservar tentativas/contextos distintos e observar executores quando disponível. Não promover um texto de agente a execução autenticada.

Uma evidência é consumida segundo um validator registrado para sua semântica, não por um rótulo livre como test-passed. Se os próprios testes foram modificados, a revisão e o aceite consideram esse fato; passar testes alterados pelo autor não comprova adequação sem avaliação dos critérios.

Gate aceito permite ação autorizada, não autoriza automaticamente commit, push, release, deploy ou mensagem externa. Cada aplicação local mantém sua intenção e reconciliação próprias.

## 12. Composição, conflitos e integração

Candidate lineage conserva baseline, candidatos pais, beforeimages, artefatos e produtores. Aplicação segue ordem determinística de ancestralidade; nunca last-writer-wins silencioso.

Writers independentes sobre o mesmo arquivo podem produzir conflito. A composição detecta antes de aplicação final e gera needs-resolution. Uma atividade de resolução autorizada cria novo candidato e deve ser revisada/verificada; não reclassificar o conflito como sucesso.

Resultados de map aceitos por item não substituem revisão e checks da integração. Ao combinar os itens, congelar candidato integrado, revisar comportamento global e executar verificações pertinentes. Se a integração precisar de repair, usar a mesma receita com candidato integrado anterior; aprovações de componentes continuam históricas, mas não aprovam mudanças novas automaticamente.

Composição valida um DAG de ancestralidade sem ciclos, ancestrais ausentes ou baselines incompatíveis. Em um diamond A → C/D, o delta compartilhado de A é aplicado uma vez; C/D são compostos sobre essa base validada. Deduplicar ancestral comum por identidade/digest e ligação comprovada, não por igualdade textual de patches de produtores independentes. Patches iguais de produtores independentes passam por política explícita; o default é sinalizar conflito. Resolução cria novo candidato e conserva os originais.

### Fronteira entre aceite e aplicação

Lifecycle de aplicação: executing → acceptance-ready → applying → applied. Antes de aplicar, falha de condição retorna à execução/needs-attention com motivo. Depois de iniciar aplicação, resultado parcial/desconhecido vai a apply-uncertain e exige reconciliação. Cancelamento solicitado não comprova aplicação cancelada; distinguir cancelamento observado. Gate aprovado não significa applied.

O owner relê a tupla semântica pertinente e faz CAS/transação para registrar ApplyIntent e estado applying antes de chamar o publisher. A transação valida candidateDigest, GateReceipt, CoverageManifest, seals, programRevision, acceptanceVersion, policyVersion, autorizações vigentes, baseline/escopo de destino e beforeimages. O publisher verifica o destino novamente antes de escrever: CAS no store não bloqueia modificações externas no filesystem. Se uma revisão pertinente ganhou a corrida antes do intent, o intent antigo não inicia. Registrar bytes/digests esperados e receipts dos arquivos efetivos; métrica/status de UI não faz parte da tupla semântica.

Durante applying o intent fica congelado: replan, novos seals e steering não podem mudar o alvo da aplicação. Eventos pertinentes recebidos nesse período são persistidos como pending-after-apply; o ACK distingue recebido de consumido e não afirma que o steering já ocorreu. Após reconciliação ou conclusão, esses eventos exigem decisão explícita de revisão sucessora vinculada; não mudam retroativamente o run terminal nem seus arquivos. Revogação de autoridade/cancelamento é exceção de interrupção: verificar em fronteiras seguras, tentar parar e registrar o observado; arquivos já escritos ou revogação durante um write podem exigir apply-uncertain, sem promessa de rollback universal.

Aplicação de múltiplos arquivos localmente não vira transação atômica por existir journal. Crash após write e antes do receipt requer inspeção/reconciliação dos before/afterimages e do intent; nenhuma nova aplicação/dispatch pertinente é liberada enquanto houver apply-uncertain. Não sobrescrever divergências para simular sucesso. Applied exige receipt persistido que comprove o resultado inteiro do intent congelado; apenas emitir um ACK não é prova.

## 13. Replanejamento, gerações e resultados tardios

Fase inicial mantém barreiras seguras: suspender novos despachos, observar workers ativos e reconciliar incertezas antes de alterar suas entradas.

Depois habilitar extensão monotônica: adicionar ramos independentes e itens ainda não despachados, sem alterar contratos/entradas/escopo de workers ativos nem enfraquecer aceite. A expansão e seus limites são uma transação versionada. Joins aguardam fechamento explícito do conjunto de produtores.

Substituição de ramos durante atividade só entra após protocolo de fencing: generation/token por tentativa, relação de dependência observada, rejeição de output da geração antiga e invalidation transitiva. Resultados tardios são conservados para auditoria, mas não satisfazem operações novas. Workers afetados precisam terminar, cancelar ou reconciliar.

Fencing rejeita o resultado; não desfaz efeito externo de um worker antigo. Nenhuma troca de geração permite presumir que o processo terminou. App-closed e serviço de sistema continuam fora deste aceite.

Propostas de agente são payloads tipados de replan, não mutations autoritativas. O owner pode aceitar automaticamente mudanças dentro de regras e autorização existentes; mudanças de objetivo, escopo ou efeitos fora desses limites precisam de decisão autorizada. A política não delega autoaprovação ao implementador.

## 14. Eventos humanos, steering e aprovações

Eventos são tipados, identificados, ordenados e persistidos antes de consumo. Contêm run, produtor/autorização observada, alvo, payload, versão esperada, correlação e validade quando pertinente. Deduplicação conserva idempotência. Mensagens de workers não são autorização humana.

Steering opera em checkpoints e sobre etapas futuras. Não prometer injeção em worker ativo se o adaptador não suporta. Um evento que modifica entradas produz nova revisão/geração e invalidation explícita; não apenas acrescenta texto ao próximo prompt.

WaitEvent tem política de prazo e cancelamento. Timeout não significa aprovação. Um evento enviado antes de o wait ser materializado não pode se perder; matching usa invocação lógica, geração/revisão, tipo, correlação e validade. Eventos dirigidos a wait antigo não são consumidos pelo wait novo. Consumo e decisão correspondente são uma transação; deduplicação e receipt impedem consumo duplo. Autorizações duradouras podem ser reutilizadas dentro de sua finalidade, mas isso não reutiliza automaticamente o mesmo sinal de negócio para decisões distintas. Durante applying vale o pending-after-apply da seção 12.

Aprovação, quando necessária, é vinculada a ação, candidato/digest, escopo, versão e validade. Reutilizar autorizações já dadas quando aplicáveis; não introduzir aprovação obrigatória em toda etapa. Receipts de aprovação seguem o mecanismo confiável do host, sem inventar identidade autenticada quando só há registro cooperativo.

## 15. Efeitos, retry e reconciliação

Classes propostas: read, isolated-write, idempotent-effect e non-idempotent-effect. A declaração é validada por política/adaptador; não confiar na auto-classificação do script. Clones e checagem de diffs não são contenção contra processo malicioso com acesso à mesma conta do sistema operacional.

CapabilityContract é obrigatório antes do primeiro dispatch v2, inclusive read e command. O owner valida argv/cwd, ambiente efetivo, binários/configuração, ferramentas, rede, escopo de escrita do candidato, paths gerados permitidos e evidência de isolamento do adaptador. Preferência declarada é separada de capacidade efetivamente observada. Comando sem contenção é execução cooperativa com seu acesso real explicitado; se o contrato exige restrição forte de rede/escrita, um adaptador incapaz é recusado, não relabelado como seguro.

Escopo efetivo de escrita é a interseção entre escopos solicitados pelo programa/executor, aceite, política e capacidade observada. Paths sugeridos pela discovery são dados a validar, nunca autorização. Sem escopo resolvido, dispatch de escrita é recusado. acceptanceWriteScope identifica uma projeção registrada do contrato de aceite; não concede acesso adicional nem permite que o executor redefina o próprio limite.

Checks podem criar cache/build em allowedGeneratedPaths de scratch isolado por tentativa, fora do candidato imutável avaliado. Não podem modificar source do candidato para fazer o check passar. Alteração do candidato invalida a avaliação e exige novo candidato/gate. Hash de executor/ambiente considera binário, configuração e variáveis pertinentes sem armazenar segredos. Scratch autorizado não amplia escopo dos artefatos capturados ou aplicação final.

Read e isolated-write podem ser retentados quando entradas, limites e integridade permitem. Efeitos idempotentes usam chave e receipts do destino quando disponíveis. Efeito não idempotente recebe intent persistido antes do despacho e exige resultado observado/reconciliação; não tem retry automático depois de resultado desconhecido.

Comandos arbitrários não recebem garantia exactly-once. Restrições de rede/ferramentas e isolamento devem ser demonstradas pelo executor, não inferidas da declaração effect. Não ampliar automaticamente acesso aos MCPs globais, credenciais ou APIs externas dos workers.

Cancelamento solicitado, processo terminado e efeitos conhecidos são estados distintos. Deadline ou abort sem conclusão observada produz uncertain. Reconciliar só com observações pertinentes; manter os limites atuais de fechamento de árvores de processos enquanto não houver teste específico.

## 16. Políticas, orçamento e escala

PolicyContract é externo ao programa e versionado. Autor define preferências dentro dos tetos; não amplia sua autorização. Subworkflows herdam orçamento restante e não reiniciam contadores para contornar limites.

Controlar concorrência, tentativas totais, rodadas, revisões, itens, tamanho/profundidade de outputs, artefatos, prazo por worker/run e operações de transform. Reservar capacidade antes de despachar e reconciliar uso observado depois. Pausa por quota não reinicia efeitos desconhecidos.

Distinguir elapsed wall-clock, tempo ativo de execução e expiração de autorização. Espera humana pode pausar apenas o contador que a política permitir; deadlines absolutos e validade de autorização continuam valendo. Reinício não zera contadores. Registrar modelo solicitado, modelo efetivo quando observável e qualquer fallback autorizado; configuração desconhecida não vira confirmação de equivalência.

Distinguir teto rígido implementável de estimativa: tentativas/concorrência/deadlines têm enforcement local; uso financeiro e tokens só são limites rígidos quando o provider/adaptador permite medição e interrupção apropriadas. Uso reportado ao final pode exceder reserva estimada; não prometer teto monetário exato ou ausência de consumo após abort.

Usar fila persistida com justiça entre ramos, backpressure e limites de bytes. Falta de workers, limites de provider e indisponibilidade de ambiente produzem estados visíveis. Não adicionar serviço de sistema ou scheduler de wakeup implicitamente.

Reduzir contexto por referências, entradas selecionadas e resumos. Caching depende da compatibilidade efetiva de modelo, ferramentas, schemas, diretório e provider; medir hits e economia reais. Model routing permanece dentro das preferências e autorização existentes; nenhuma troca silenciosa para modelo mais caro.

Prompt caching do provider reduz processamento de prefixos; reuso de output evita executar a operação. Registrar essas métricas separadamente. Clones/diretórios distintos podem reduzir cache hits. Não compartilhar workspaces mutáveis apenas para obter cache.

## 17. Observabilidade e experiência no Codex

Visões mínimas: objetivo/aceite, programa e revisão, itens/rodadas, candidatos, gates, workers ativos, pendências, incertezas, uso observado e próximos passos. Comparar revisões do plano e explicar por que um resultado foi reutilizado ou invalidado.

Status compacto e wait com cursor; journal detalhado consultado sob demanda. Resumos mostram coverage e itens não verificados. Logs passam por redaction antes de outputs ou prompt, e armazenamento de artefatos tem controles de acesso/escopo.

O Codex monta os requests e explica resultados em linguagem natural. Workers SDK continuam execuções separadas, sem promessa de novas conversas na sidebar ou controle da conversa nativa. CLI/MCP compartilham owner e contratos; disponibilidade real do transporte precisa ser observada no host.

## 18. Exemplo completo de intenção e programa

Pedido: migrar componentes de uma API antiga para uma nova, preservar comportamento, corrigir rejeições e verificar o conjunto integrado. Paths e bibliotecas são ilustrativos.

A descoberta retorna ComponentList: itens com id estável, path, entradas, escopo permitido e checks sugeridos. Sugestão de check não é autorização para executá-lo; o owner valida contra o contrato. Neste exemplo, o registry contém os contratos/schemas/executores versionados e a população migration-components exige conjunto não vazio. Um objetivo que permita ausência de trabalho precisa declarar schema/branch no-work explícitos, com o validator da seção 9; este exemplo não aprova discovery vazia.

```typescript
// API CONCEITUAL PROPOSTA. Não existe nem foi executada nesta entrega.
// Construtores são lowered estaticamente; nenhum callback arbitrário é executado.
defineWorkflow({
  id: "migrate-components",
  version: 1,
  inputSchema: schemaRef("migration-input", "v1"),
  outputSchema: schemaRef("migration-result", "v1"),
  acceptance: acceptanceRef("migration", "v1"),
  population: populationRef("migration-components", "v1"),
  policy: policyRef("local-coding", "v1"),
  steps: [
    agent("discover", {
      role: "investigator",
      input: workflowInput(),
      outputSchema: schemaRef("component-list", "v1"),
      effect: "read",
      prompt: "Identifique os componentes e suas dependências; não altere arquivos.",
    }),
    map("migrate", {
      items: field(output("discover"), "items"),
      coverage: coverageFor(population(), output("discover")),
      key: field(item(), "id"),
      concurrency: 4,
      completion: "all-required",
      body: repair("component", {
        recipe: recipeRef("repair", "v1"),
        entryMode: "implement-first",
        initialCandidate: candidateFromBaseline(item()),
        writeScope: field(item(), "allowedPaths"),
        implement: executorRef("migrate-component", "v1"),
        review: executorRef("review-component", "v1"),
        checks: approvedChecksFor(item()),
        maxRepairRounds: 3,
        maxAssessmentAttempts: 6,
        maxInfrastructureAttempts: 3,
        progressPolicy: { unchangedCandidateRounds: 2, repeatedFindingsRounds: 2 },
        onExhausted: "needs-attention",
        onUncertain: "reconcile",
        preserveCandidateHistory: true,
      }),
    }),
    compose("integrate", {
      candidates: acceptedCandidates("migrate"),
      onConflict: "needs-resolution",
    }),
    repair("repair-integration", {
      recipe: recipeRef("repair", "v1"),
      entryMode: "assess-first",
      initialCandidate: outputCandidate("integrate"),
      writeScope: acceptanceWriteScope("integration"),
      implement: executorRef("fix-integration", "v1"),
      review: executorRef("review-integrated-result", "v1"),
      checks: acceptanceChecks("integration"),
      maxRepairRounds: 2,
      maxAssessmentAttempts: 6,
      maxInfrastructureAttempts: 3,
      progressPolicy: { unchangedCandidateRounds: 2, repeatedFindingsRounds: 2 },
      onExhausted: "needs-attention",
      onUncertain: "reconcile",
    }),
    gate("final", {
      candidate: acceptedCandidate("repair-integration"),
      obligations: acceptance(),
      coverage: coverageReceipt("migrate"),
    }),
  ],
  result: object({
    status: literal("accepted"),
    candidate: acceptedCandidate("repair-integration"),
    gate: output("final"),
    coverage: coverageReceipt("migrate"),
  }),
});
```

Semântica: coverageFor/coverageReceipt são projeções de validação local determinística do owner, não um prompt que pede ao discover para se autovalidar. O lowerer infere a dependência de descoberta e inventário, e map aguarda cobertura/seal aceitos. Seletores acceptedCandidate(s) criam dependências condicionadas à união accepted; falha da receita suspende consumidores e retorna status operacional needs-attention, sem avaliar result como sucesso. O schema migration-result valida o objeto terminal de negócio quando o programa chega ao result; falhas operacionais pertencem ao envelope do run.

Map aceita somente candidatos approved por seus gates de rodada. Compose detecta sobreposição e produz candidato integrado imutável. Assess-first avalia o candidato de integração antes de modificar: se já passar revisão/checks, não cria alteração vazia nem gasta uma implementação desnecessária. Caso falhe, rodadas seguintes partem desse candidato e seu feedback. O gate final reaproveita apenas evidências de revisão/checks que correspondam exatamente ao candidato escolhido e às obrigações vigentes. Result accepted significa candidato aceito, não aplicado. Aplicação local é uma ação posterior autorizada, com ApplyIntent/receipt e lifecycle da seção 12, não implícita no retorno de gate.

Exemplo de falha: após duas reprovações e nenhuma mudança de digest, um item fica stalled. Os outros candidatos continuam persistidos, mas map all-required não conclui. Após instrução autorizada e reparo do item, retomar com apenas os ramos invalidados; integração e gates finais só usam o novo conjunto fechado.

## 19. Compatibilidade e pontos de código

Não mudar comandos v1, persisted schemaVersion 1 ou sua definição histórica de succeeded/ready. Runs antigos continuam em seu executor/intérprete. Novo protocolo deve ter discriminador e validação explícitos; não aceitar mistura de envelopes v1/v2.

Introduzir módulos de responsabilidade conceituais: workflow-program-contract/lowering, expression-evaluator, operation-store/journal, dynamic-expansion, outcome-contract, typed-output/artefact-resolver, candidate-lineage, acceptance-gates e recipes. Nomes finais dependem da inspeção do projeto; não criar um serviço paralelo para cada primitive.

Mapeamento de reuso:

| Código existente | Tratamento |
| --- | --- |
| workflow-engine.ts | Reutilizar reducer/invalidation para operações materializadas; adapter v2 explicita semântica de controle |
| managed-run-contract/store/service.ts | Acrescentar contratos versionados e lifecycle; preservar v1 |
| codex-sdk-worker.ts | Envelope separado de payload tipado; modelos e isolamento observados |
| managed-workspace.ts | Reusar snapshots, beforeimages, scopes e composição; acrescentar Candidate metadata |
| workflow-task-actions.ts | Não relaxar validação de snapshots acompanhados ao introduzir v2 |
| CLI fabric / agent-memory MCP | Transportes do mesmo owner, sem instalação/configuração global implícita |
| tests/agent-fabric | Contratos, crash/replay, loops, expansão, artefatos, efeitos e compatibilidade |

V2 review rejeitada não pode ser despachada pelo path v1 que a converte em failed/blocked sem adaptação explícita. Controle puro (branch/join/expansion/gate) usa executor local determinístico e receipt próprio, não um worker LLM obrigatório para cada nó. Não enfraquecer o contrato legado que exige executor por nó; o contrato v2 define suas categorias próprias.

Freeze P0a/P0b, acceptance records e cronologia não são reescritos. Mudanças materiais em invariantes exigem ADR/supersessão com baseline, compatibilidade, evidência e commit de aplicabilidade. Migrar run antigo só por operação explícita, pausada e sem incertezas, mantendo o original recuperável; nenhuma conversão automática em abertura de owner.

## 20. Entregas, dependências e critérios de aceite

| Etapa | Entrega | Dependências | Gate verificável |
| --- | --- | --- | --- |
| F0 | ADR semântica: IR, identidades, população/aceite, capacidades, efeitos, lifecycle e persistência autoritativa | Baseline | Contraexemplos de cobertura, rejeição, exaustão, crash e corrida de aplicação resolvidos na especificação; review independente |
| F0b | Protótipo limitado de expressividade e decisão de autoria | F0 | Cenários da seção 4 expressos/inspecionados; schemas/result/dependências/IDs sem execução arbitrária; medir esforço antes de congelar DSL |
| F1 | Contrato v2, outputs/avaliações e CapabilityContract antes do dispatch | F0 | Feedback separado de falha; restrições efetivas validadas; envelope v1 preservado; sem dispatch antes de validação |
| F2 | Lowerer de produto e expressões puras da autoria escolhida | F0b/F1 | Lowering determinístico; imports/I/O inválidos rejeitados sem execução; schemas/result/merge e limites verificados |
| F3a | Journal autoritativo, artefatos, receipts e checkpoints | F1/F2 | Crash em commit/artefato/ACK recuperável; projeções verificadas; sem dual write independente; limites de durabilidade documentados |
| F3b | Map/loop de dados, seals, coverage e budgets | F3a | Inventário de 80 itens sem omissões; janela limitada; vazio inválido/no-work distintos; loops de dados duráveis e contadores conservados |
| F4a | Candidate snapshot/delta, ancestralidade e composição | F3a | Três deltas no mesmo arquivo; diamond aplica ancestral uma vez; ciclos/baselines/conflitos rejeitados |
| F4b | Repair de código, avaliações/gates e ApplyIntent/lifecycle | F3b/F4a | Assess-first/implement-first corretos; união accepted exclusiva; review/checks do digest final; CAS/eventos/apply-uncertain seguros |
| F5 | Recuperação seletiva, sinais humanos e extensão monotônica | F4b | Evento não perdido/duplicado; alterar item reexecuta só dependentes; joins fechados; reuse receipt explícito; geração antiga não satisfaz nova |
| F6 | Substituição online com fencing e escala medida | F5 | Corridas entre replan/result/abort/restart seguras; fila justa e backpressure; limites externos efetivos |
| F7 | Benchmark pareado e piloto real autorizado | Gates anteriores pertinentes | Relatório de resultados/limites reproduzível; sem claims de produção/EasyGrow/App-closed a partir de fixtures |

F3a entrega persistência antes da expansão de F3b. F3b usa dados/fixtures, sem declarar repair de código seguro. F4a vem antes de F4b; F4b depende também de cobertura/loops F3b. CapabilityContract é obrigatório em F1, sem aguardar fencing ou escala F6. Novas capacidades entram opt-in e nunca substituem imediatamente o modo v1.

Cada slice termina com checks pertinentes, revisão independente sobre snapshot atual e validações exigidas pelo AGENTS.md do checkout. Testes reais SDK, dependências, MCP nativo e efeitos externos têm evidência separada e respeitam autorização/custos. Não iniciar chamadas pagas em toda CI nem executar checks apenas porque um manifesto os sugere.

## 21. Matriz mínima de verificação

| ID | Cenário | Resultado esperado |
| --- | --- | --- |
| T01 | Revisão concluída, changes_requested | Feedback consumível; candidato não aprovado |
| T02 | Checker produz diagnósticos com exit esperado não zero | Diagnóstico válido; obrigação de check passou continua pendente |
| T03 | Schema inválido/truncado/referência fora de escopo | Falha explícita; output não consumido e nenhum efeito adicional implícito |
| T04 | maxRepairRounds e mesma falha repetida | exhausted/stalled; jamais último candidato tratado como accepted |
| T05 | Crash antes/depois de persistir expansão/claim/resultado | Nenhum dispatch sem registro; operações incertas reconciliadas; ACK não inventado |
| T06 | Lista reordenada, chave duplicada, rename | Identidades estáveis; duplicata rejeitada; rename segue regra declarada |
| T07 | 80 itens, janela pequena e restart | Sem itens omitidos/duplicados; all-required e fechamento corretos |
| T08 | Três patches no mesmo arquivo em rodadas | Ancestralidade correta; beforeimage divergente rejeitada |
| T09 | Writers independentes conflitantes | Needs-resolution; nada de last-writer-wins silencioso |
| T10 | Item novo após fechamento, antes/durante/depois de apply | Antes: novo seal invalida gate; durante: pending-after-apply; terminal: sucessor explícito sem mudar run aplicado |
| T11 | Resultado tardio após fencing | Histórico preservado; nenhuma conclusão da geração nova |
| T12 | Replan com worker incerto | Operação recusada ou ramo bloqueado até reconciliação pertinente |
| T13 | Mensagem humana antes do wait, após timeout ou repetida | Matching/validade/consumo persistidos; timeout nunca aprova |
| T14 | Efeito termina, owner cai antes de receipt | uncertain e reconciliação; sem retry automático não idempotente |
| T15 | Artefato apagado/alterado ou dependência externa mudou | Reuso recusado; nenhum efeito refeito para esconder corrupção |
| T16 | Subworkflow tenta reiniciar budget/ampliar escopo | Política externa bloqueia; contadores globais conservados |
| T17 | Modelo/ambiente/schema/validator mudou | Fingerprint atualizado; reuso somente sob compatibilidade explícita |
| T18 | Reviewer/check report aplica a candidato anterior | Gate recusa mesmo que o texto diga aprovado |
| T19 | Publicação parcial e cancelamento sem árvore encerrada | Estado incerto visível; inspeção/reconciliação exigidas |
| T20 | Run v1 antigo após instalar v2 | Semântica original preservada; nenhuma migração silenciosa |
| T21 | Inventário de 80, discovery com 79/zero/extras/exclusão/rename | Omissão/vazio não provado/extras bloqueados; exclusão autorizada e rename contabilizados |
| T22 | Vazio legítimo e alvo semântico não comprovado por glob | No-work somente com contrato/evidência; cobertura semântica inconclusiva permanece pendente |
| T23 | Steering/revisão disputa CAS antes do ApplyIntent | Tupla vencedora determina aplicação; gate obsoleto não inicia |
| T24 | Evento entre intent/primeiro write e entre dois writes | Intent congelado; ACK recebido/pending, nunca consumido; aplicado pertence à versão congelada |
| T25 | Revogação, cancelamento ou crash após write e antes de receipt | Interrupção observada/reconciliação; nenhuma nova aplicação com apply-uncertain |
| T26 | Assess-first aprovado, inconclusive repetido, limites distintos | Zero implementação quando aprovado; reavaliação limitada; counters/união accepted corretos |
| T27 | Adicionar item, reordenar, alterar prompt/schema/receita/operador | Reuso por semântica local e entradas; aggregators invalidam; receipt vincula nova geração |
| T28 | Worker vê arquivo compartilhado fora de writeScope | Snapshot visível entra no digest conservador; mudança pertinente impede falso reuso |
| T29 | Diamond, ancestral ausente/ciclo e patches iguais de produtores distintos | Ancestral comum aplicado uma vez; estruturas inválidas rejeitadas; igualdade textual não deduplica automaticamente |
| T30 | Check edita source, gera cache autorizado ou command alega read sem contenção | Source invalida candidato; scratch isolado permitido; capacidade insuficiente impede dispatch forte |
| T31 | Crash na gravação de artefato/journal/checkpoint/ACK | Fonte autoritativa íntegra; outputRef nunca aponta a artefato não confirmado; power-loss tem escopo declarado |
| T32 | Branch não selecionado, merge incompatível, child retry/cancel/uncertain | Join não espera skipped; obrigações externas preservadas; tipos validados; filho/effect não duplicado |
| T33 | Evento antigo em wait novo, consumo duplicado, prazo e budget após restart | Matching de geração/invocação; decisão/consumo atômicos; expiração/contadores conservados |
| T34 | DSL importa schema arbitrário, result não tipado ou receita sem ID | Rejeição sem executar módulo; registry/result/identidade exigidos |

Usar fault injection determinística nas fronteiras de commit/despacho/efeito; workers fake validam o runtime. Depois executar pilotos delimitados com SDK real para validar integração, distinguindo resultados de fixture, modelo, sistema e aceite humano.

## 22. Benchmark e prova da vantagem

Separar benchmark do runtime, com workers determinísticos e mesmas entradas, do benchmark de produto com modelos reais. Codex e Claude podem usar modelos distintos; diferenças de qualidade não devem ser atribuídas exclusivamente ao workflow.

Não presumir que Claude real aceita injeção de fake workers. Se não houver mecanismo suportado, comparar fixtures do Fabric com scheduler de referência baseado na documentação, rotulado como modelo de referência, sem atribuir suas medições ao Claude real. Comparação de produto usa execuções efetivamente observadas, com avaliação externa e limitações causais declaradas.

Cenários pareados: descoberta e migração de muitos itens; dois itens reprovados e restantes aceitos; falha intermediária no fan-out; crash/retomada; instrução humana na integração; conflito entre writers; composição aprovada por item que falha integrada.

Congelar base, requisitos, ferramentas permitidas, política de efeitos, limites, avaliação externa e versões. Medir regime de recursos comparável e registrar defaults de produto em um regime separado. Caso o outro produto não permita um cenário, documentar limite e resultado alternativo; não transformar ausência de equivalência em benchmark numérico inventado.

Métricas: requisitos aceitos/cobertos, falhas silenciosas, operações semânticas válidas repetidas com entradas compatíveis, duplicação de efeitos, intervenções, tempo, uso e cached tokens, custo quando realmente disponível, latência de recuperação, memória/bytes de artefatos e esforço de autoria/reuso. Separar retry por schema/infraestrutura de repair, prompt caching de reutilização de output, e medir programas inválidos/erros de autoria e overhead de clone/journal. Executar múltiplas repetições e registrar dispersão e limitações.

Definir metas e tamanho das execuções antes das medições. Gate inicial de correção: nenhum aceite de candidato reprovado/obsoleto ou efeito duplicado nos cenários determinísticos; recuperação preserva ramos independentes comprovadamente válidos. Gate de expressividade: programas pequenos cobrem todos os padrões sem reconstrução manual do plano pelo chat. Metas de vantagem de tempo/custo/qualidade dependem da linha de base medida, sem prometer percentuais antecipados.

O piloto real deve ser escolhido no contexto e autorização do projeto alvo. Um resultado local não prova aceite EasyGrow, produção, serviço always-on ou execução depois de fechar o App. Nenhuma medição é realizada pela escrita deste plano.

## 23. Fora do primeiro aceite

TypeScript/JavaScript irrestrito; migração arbitrária de pilhas async; streaming ilimitado de discovery; cache cross-run automático; efeitos externos exactly-once genéricos; replan arbitrário com workers ativos; concorrência alta não medida; novo serviço de sistema; auto-wakeup; novos providers/MCPs/credenciais; deployment; edição automática de memórias; reescrita de freezes ou aceites antigos.

Itens podem virar entregas futuras explícitas após o núcleo e sua evidência. A DSL restrita tem menos liberdade que JavaScript geral: provar que expressa os workflows alvo é requisito, não supor paridade pela aparência TypeScript.

## 24. Fontes e revisão

Fontes de código do baseline: `src/forge/agent-fabric/workflow-engine.ts`, `managed-run-contract.ts`, `managed-run-service.ts`, `managed-run-store.ts`, `managed-workspace.ts`, `codex-sdk-worker.ts` e `workflow-task-actions.ts`. `tests/agent-fabric/managed-run-service.test.ts` registra rejeição de revisão e replanejamento preservando ramo independente. Os testes foram lidos, não reexecutados para este plano.

Documentação atual do Fabric: `docs/agent-fabric.md` e `docs/architecture/agent-fabric/CODEX_DYNAMIC_WORKFLOWS.md`; planos históricos não são inventário atual.

Conceitos do Claude usados como paridade e referência: orquestração em script, operações de fan-out, outputs com schema, restrições de determinismo e I/O, progress/replay e caching. A documentação também descreve limites de input humano durante o run e regras de replay pela ordem de início. Esses detalhes são voláteis e foram consultados em 07/10/2026; validar novamente antes de benchmark ou implementação dependente de versão. Fonte primária: [Claude Code Dynamic Workflows](https://code.claude.com/docs/en/workflows).

Histórico: R1 foi revisada pelo novo subagente independente review_workflow_plan_v2, sobre SHA256 B0E6CC5A5BFF0E6DA5A8EF6E75EDA122149D3AE10D88B3EC5E874906B2D3FC68. Foram encontrados B1 (população/coverage) e B2 (gate/eventos/aplicação), além de I1–I6 (autoria, repair, reuso, ancestralidade, capacidades e milestones). R2 incorporou esses pontos e os refinamentos de branches, subworkflows, sinais, orçamento e benchmark. R2 foi lida integralmente pelo revisor sobre SHA256 7B14F970214FF86DF0D21D4F244A6E4795532D349E0F01EE0E89259817CD9BB8. R2.1 acrescenta somente a clarificação normativa do escopo e sua expressão no exemplo, além deste histórico/header. O relatório preserva os achados R1 e verifica o snapshot final vinculado ao digest.

A revisão final combina leitura integral R2 e verificação do delta R2.1, avaliando contratos, exemplo, sequência de entregas e os 34 cenários, fechando ou mantendo explicitamente cada achado anterior. Relatório: `REVISAO_PLANO_WORKFLOWS_AGENT_FABRIC_V2.md`. Parecer arquitetural não comprova execução nem autoriza implementação.
