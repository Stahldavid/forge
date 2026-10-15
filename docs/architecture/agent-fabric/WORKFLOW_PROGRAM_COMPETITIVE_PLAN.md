# Forge Agent Fabric — plano técnico final

Data: 2026-10-10. Baseline: `3e7475f7a0e47be0d351d5c37355ed9f3a5c0ecd`.
Escopo autorizado: implementação local completa com subagentes, validação focada e redução de redundâncias na CI. Nenhuma publicação, push, deployment ou instalação global faz parte desta entrega. Este plano não autoriza inferência paga para benchmarks.

## Objetivo e critérios de sucesso

Evoluir `program-*` para workflows de programação completos, observáveis, recuperáveis e eficientes. Superioridade competitiva exige qualidade externa, tempo e consumo por resultado correto, trabalho repetido após falha e intervenções humanas; aprovação do próprio gate não é a definição de sucesso. Comparações precisam declarar modelos, ferramentas, contexto, versões e budgets.

O baseline já contém DSL finita/IR v2, schemas e tipos nominais, owner exclusivo, gates, aplicação separada, templates básicos, contexto de repositório em `run-*`, cache verificado de dependências, journal encadeado e artefatos por conteúdo. Não reconstruir esses mecanismos.

## Invariantes

- Modelo propõe; owner valida registry, autoridade, escopo e aceitação.
- Completed não significa accepted. Review/checks/evidence/coverage pertencem ao candidato observado.
- Cancelamento solicitado não comprova término da árvore de processos.
- Efeitos não observados continuam uncertain; não há exactly-once externo.
- Resume não repõe débitos nem estende deadlines.
- Apply continua separado e vinculado ao gate atual; múltiplos arquivos não formam transação atômica.
- Eventos tardios não concluem gerações sucessoras.
- Telemetria distingue observado, estimado e desconhecido; desconhecido nunca é zero.
- Mudanças de semântica/persistência são versionadas; não reinterpretar checkpoints antigos silenciosamente.
- Command e adapters cooperativos não são sandbox forte.

## Entregas, prioridade e dependências

| ID | Prioridade | Entrega | Depende de |
|---|---|---|---|
| E0 | P0 | Baseline e protocolo de avaliação externa | — |
| E1 | P0 | Telemetria durável e diagnóstico | definições E0 |
| E2 | P0 | Round-robin real e capacidade owner configurável | E0/E1 para liberação |
| E3 | P0 | Cancelamento, reconciliação e recuperação segura | E1 |
| E4 | P0 | Review, bugfix e migration completos; autoria assistida | E1/E3 |
| E5 | P1 | Contexto existente em program workers | E0/E1 |
| E6 | P1 | Orçamento de admissão e reservas | E1/E2/E3 |
| E7 | P1 | Eficiência de preparação/persistência | profiling E0/E1, invariantes E3 |
| E8 | P1 | Resolução de conflitos e replan assistido | E3/E4 |
| E9 | P2 | Harness adicional, owner background e multimodalidade | gates específicos |

## E0 — baseline e avaliação

Separar workloads determinísticos (runtime) de tarefas de programação (qualidade externa). Registrar configuração, versão, workload, modelo, ambiente e fontes. Medir fila, preparo, execução, captura, persistência, integração, tokens, consumo desconhecido, bytes, sucesso externo, regressões e intervenção humana. Relatório recusa tratar acceptance do próprio owner como sucesso externo.

Aceite: relatórios validados, campos ausentes explícitos, condições comparáveis declaradas e métricas de sucesso definidas antes da avaliação. Benchmarks reais ficam pendentes de execução explicitamente autorizada; fixtures demonstram apenas seus contratos.

## E1 — telemetria

Normalizar observações de lifecycle e usage com identidade, sequência, origem, unidade e semântica delta/cumulative. Persistir usage antes de validar output final. Preservar observações em falhas e restart; deduplicar. Armazenar detalhes limitados sem credentials nem transcripts ilimitados. Expor status/explain compartilhados CLI/MCP com motivos e ações possíveis.

Módulos: `codex-sdk-worker`, `program-worker`, `program-contract`, `program-service`, `program-store`, `program-view`; interfaces públicas CLI/MCP.

Aceite: output inválido não apaga usage observado; duplicatas não somam duas vezes; unknown não é zero; eventos antigos não aprovam sucessor; razões de bloqueio são estruturadas. Telemetria não cria escrita de snapshot por mensagem token a token.

## E2 — scheduling

Filas por run e round-robin explícito entre runs elegíveis. Config owner validada (default quatro, teto inicial existente 32), run e ancestor scopes. Alteração para capacidade menor impede novas admissões sem matar atividades. Reservas uncertain permanecem ativas.

Módulos: `program-scheduler`, `program-service`, `program-contract`, `program-view`.

Aceite: >=3 runs continuamente admissíveis recebem atendimento; quotas respeitadas; parent controls não ocupam slots; release idempotente; cancelamento não vaza slots. Usar barreiras determinísticas, não assertions de throughput baseadas em sleeps curtos.

## E3 — continuidade

Observar processo/thread/workspace/candidato antes de decidir reutilização, resume thread, nova tentativa ou reconcile. SDK já suporta resume; program adapter deve recebê-lo apenas com workspace original compatível e efeitos verificados. Registrar checkpoints e observações, preservar deltas parciais e owners epochs. Expor reconciliação assistida com fatos e desconhecidos.

Módulos: `program-worker`, `codex-sdk-worker`, `managed-workspace`, `program-service`, `program-contract`, `program-store`, `program-owner`, `program-lock`, `program-view`.

Aceite: sem redispatch incerto/escritor duplicado; intactos independentes reutilizados; prazos/budgets preservados; workspace incompatível bloqueia resume; callbacks tardios não alteram sucessor. Não prometer cancelamento de árvore sem adapter capaz de observar essa garantia.

## E4 — autoria e workflows

Três templates owner-validated: revisão sem alteração, bugfix limitado, migration por população fechada. Entrada natural do agente produz proposta de template/IR; proposta não substitui registry. Schemas, scopes, checks, review e parada explícitos. Gerar refs tipadas a partir do registry. Explicar erros por operação/campo e distinguir completion/acceptance/apply. Aproveitar DSL finita e exemplos existentes; não criar interpretador geral.

Módulos: `program-api`, `program-dsl`, `program-types`, `program-structure`, módulos de authoring/templates, `program-view`, CLI/MCP e exemplos.

Aceite: proposta válida contém refs/criteria/checks/scopes/limites; checks obrigatórios não podem desaparecer; caso correto não exige edits; alteração invalida review incompatível; workflows executam com fixtures sem LLM.

## E5 — contexto

Integrar `prepareFabricRepositoryContext` existente ao clone/candidato de programas. Selecionar símbolos, contratos, dependências, checks sugeridos e lacunas por papel/atividade. Contexto limitado e identificado por snapshot; checks sugeridos não executam implicitamente. Ausência de manifesto segue diagnóstico/política explícita.

Aceite: clone atual e contexto correspondem; mudanças revalidam; truncamento explícito; melhoria de qualidade ou eficiência deve ser medida, não inferida de tamanho menor do prompt.

## E6 — recursos

Ledger observado/reservado/estimado/desconhecido, tokens por run/owner, reservas para atividades e avaliação final. Serializar admissão agregada sob owner exclusivo, reservas duráveis associadas à tentativa. Reinício reconstrói saldo/reservas. Monetary reporting somente com modalidade/pricing declarados; subscription não vira dólar fictício. Hard enforcement somente conforme capability do adapter; demais perfis têm admission budget e overshoot possível de trabalho em curso.

Módulos: `program-contract`, `program-service`, `program-scheduler`, `program-store`, `program-worker`, `program-view`.

Aceite: admissões não gastam o mesmo saldo; restart não repõe; unknown policy explícita; atingir limite preserva resultados e bloqueia novos dispatches; revisão/checks conservam reserva. Não transformar orçamento em licença para omitir obrigações.

## E7 — eficiência

Instrumentar cache hit/verificação/cópia/instalação; materialização de workspace; serialização/validação/fsync/bytes. Aplicar melhorias locais que evitem trabalho redundante comprovado. Cache existente permanece verificado; mutable trees não são compartilhadas. Snapshot incremental, GC e cache de respostas LLM são extensões condicionais ao profiling e não obrigatórias sem gargalo demonstrado.

Aceite: ganho demonstrado em workload definido; cache corrupto bloqueia; isolamento, histórico e recuperação permanecem íntegros; artefatos ligados a apply uncertain preservados.

## E8 — conflitos e adaptação

Resolver recebe baseline, candidatos conflitantes e contrato e produz novo candidato, sem aprovação herdada. Requer nova avaliação final. Replan propõe delta sem enfraquecer obrigações; preserva branches intactos. Repetição sem progresso termina explicitamente.

Módulos: `program-service`, contratos/types/structure, worker/workspace, templates/view.

Aceite: conflito não vira approval automático; candidato integrado reavaliado; checks/obligations mantidos; late callbacks fenced. Fencing local e novos operadores só entram por necessidade demonstrada.

## E9 — expansão opt-in

- Segundo harness nativo: schema, identidade, usage, término, cancelamento, isolamento, retomada e late callbacks conformes. CLI externa via command não basta. Adapter Claude explícito com capabilities honestas, sem bypass automático nem inferência real nesta validação.
- Owner background local: preservar IPC autenticado, lease e recovery; pausar/uncertain não retomam implicitamente. Reutilizar startup existente, sem instalar serviço global silenciosamente.
- Multimodal: imagem explicitamente entregue pelo adapter, provenance vinculada; receipts não demonstram compreensão. UI exige avaliação integrada final e cobertura do catálogo.

## Mudanças por módulo

| Módulo | Mudança |
|---|---|
| program-contract/service | observações, admissão, recovery, compose resolver |
| program-scheduler | fairness/capacidade/quota |
| program-store | observações duráveis e métricas; preservação CAS |
| program-worker/codex-sdk-worker | lifecycle/usage/context/resume/multimodal |
| managed-environment/workspace | profiling/materialização/compatibilidade |
| repository-context | contexto por candidato |
| program-api/dsl/types/structure | autoria e refs typed; resolver options |
| program-view | diagnóstico e garantias reais |
| program-owner/lock/project-runtime | exclusividade/background seguro |
| cli/fabric, agent-memory/mcp, local-task-server | paridade pública e autoria sem dispatch |
| examples/agent-fabric-v2 | três workflows completos |
| tests/agent-fabric, scripts, CI | validação focada e redução de redundância |

## Validação rápida e CI

Usar poucos testes agrupados de alto valor para invariantes novas: usage+invalid output+restart, fairness>=3, orçamento concorrente, recovery incompatível, proposta/gate e resolver. Reutilizar fixtures existentes; não adicionar testes que apenas espelham implementação. Não executar modelos reais. Typecheck/lint e geração/check necessários permanecem. Uma rodada focada após integração; repetir só por mudança/falha.

CI: reduzir matrix/smokes redundantes, seleção de PR fail-closed (common/unknown/missing history mantém cobertura ampla), preservar checks de contrato/segurança e checks exigidos. Não apagar testes existentes ou enfraquecer assertions para conseguir green. Branch principal preserva verificação abrangente; mudanças de packaging mantêm smoke relevante.

## Gates e conclusão

G1 integridade; G2 continuidade; G3 operação explicável; G4 qualidade externa nos três workflows; G5 eficiência vs baseline; G6 competitividade controlada. G1-G3 validados deterministicamente. G4-G6 ficam condicionados a avaliações representativas posteriores, não ao sucesso de fixtures nem a implementação local. Documento de evidências deve distinguir implementado, verificado, opt-in e não medido.
