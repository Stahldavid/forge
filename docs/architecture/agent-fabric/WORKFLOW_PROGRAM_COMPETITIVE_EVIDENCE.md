# Forge Agent Fabric — implementação e evidências

Data: 2026-10-10. Baseline: `3e7475f7a0e47be0d351d5c37355ed9f3a5c0ecd`.
Plano: `WORKFLOW_PROGRAM_COMPETITIVE_PLAN.md`. Entrega local sem commit, push, publicação ou deployment.

## Entrega por etapa

| Etapa | Implementação | Evidência e limite |
|---|---|---|
| E0 | Relatório versionado de benchmark, validação e resumo com avaliação independente | Unknown não vira zero; aprovação do owner não prova sucesso externo. Nenhum benchmark de qualidade com provedor foi realizado. |
| E1 | Observações duráveis, deduplicação, semântica incremental/cumulativa, usage em falhas, diagnóstico estruturado | Teste de output inválido preserva consumo após restart; contadores inválidos/overflow bloqueiam. Não aplicável é distinto de medição zero. |
| E2 | Round-robin e capacidade owner configurável de 1 a 32 | Três runs elegíveis alternam; regressão T07 identificou e corrigiu cursor quando novas filas chegam. |
| E3 | Reconciliação explícita e retomada Codex com workspace original, término observado, geração e fingerprint | Serviço encaminha thread compatível; fixture Git com preparação real rejeita delta incompatível e marker adulterado antes de iniciar modelo. |
| E4 | Autoria pelo owner, declarações tipadas e templates review/bugfix/migration | Três templates executam até acceptance-ready com checks/gate; baseline correto gera zero implementação. Revisão negativa não edita nem aprova. |
| E5 | Contexto existente do repositório integrado ao clone dos program workers | Snapshot/diagnósticos registrados; qualidade do código gerado com esse contexto não foi medida. |
| E6 | Admissão serializada, reservas duráveis por run/owner e reserva final | Testes de restart, input forjado e orçamento entre runs. Uso real informado prevalece sobre declaração de comando sem provedor. |
| E7 | Preparação instrumentada e CAS deduplicado antes de escrita/fsync | Duplicata não aumenta bytesWritten; conteúdo corrompido continua rejeitado. Não há alegação de ganho geral de latência. Cache existente de dependências foi preservado. |
| E8 | Resolver autorizado, candidato novo e recibo causal de substituição | População fechada requer nova avaliação, obrigações de cada item e união de checks. Recibo vincula geração, semântica, contrato e população; relógio não autoriza reaproveitamento. |
| E9 | Adapter Claude opt-in, validação de versão, reutilização do owner background existente e imagens nativas Codex | Protocolo simulado e transporte de imagem verificados. Claude real não foi executado; adapter cooperativo, rede do host, sem término garantido da árvore. |

## Módulos e interfaces

- Runtime: `program-contract`, `program-service`, `program-scheduler`, `program-store`, `program-observation` e `program-view`.
- Workers: `program-worker`, `codex-sdk-worker`, `claude-program-worker`, observação de `managed-workspace` e contexto existente do repositório.
- Autoria: `program-authoring`, `program-templates`, opções compose no `program-api` e exemplos em `examples/agent-fabric-v2/templates/`.
- Interfaces: ações `program-author` e `program-author-types` em CLI/MCP/owner, configuração regular e limitada `.forge/fabric-runtime.json`, capabilities compartilhadas e exports públicos.
- Avaliação: `program-benchmark` e `scripts/summarize-fabric-benchmark.mjs`; apenas validam relatórios previamente coletados.

## Validação concluída

Foram usadas suítes direcionadas, sem executar modelos reais. Os números abaixo descrevem grupos de verificações; algumas rodadas repetiram somente casos afetados por correções e não devem ser somadas como testes únicos.

| Grupo | Resultado |
|---|---|
| SDK, autoria, configuração pública e templates | 21 testes passaram; 125 assertions na primeira integração |
| Adapter Claude, imagens e recuperação com Git real | 3 testes passaram; 22 assertions; 1,71 s na integração final |
| Runtime competitivo e execução de templates por ações do owner | 10 testes passaram; 69 assertions; 11,85 s na integração final |
| Gates críticos existentes selecionados | 4 passaram; 40 filtrados; nenhum erro |
| Contrato e classificador de CI | 2 passaram; caminhos centrais e desconhecidos preservam suíte ampla |
| Regressões selecionadas após correção do scheduler | 16 passaram; 23 filtradas; 15,11 s |
| Typecheck global | `node node_modules/typescript/bin/tsc --noEmit`: exit 0 |
| Lint e whitespace | Lint aprovado; `git diff --check`: exit 0 |
| Geração/export dos adapters | Geração e exports generic/codex aprovados |
| `verify framework --skip-tests --skip-typecheck` | Aprovado: estabilidade da geração, contrato, compiler workspace, policy, auth, RLS estrutural, adapters e lint |

A verificação framework omitiu deliberadamente a suíte completa e a repetição do typecheck, pois os testes selecionados e o typecheck foram executados separadamente. Não se declara aprovação da suíte completa. Uma rodada anterior de regressões foi interrompida após 59 aprovações ao revelar bloqueio no scheduler; o cursor foi corrigido e o caso afetado passou na seleção posterior. O aviso estrutural existente de RLS em pglite/memory não comprova isolamento em PostgreSQL.

## CI reduzida

Ubuntu/Node 22 roda uma vez no job verify. A matriz adicional usa Windows 22 em PRs, Windows 22 e Ubuntu 24 no main, e inclui macOS no disparo manual. Typecheck, geração estável, compiler checks, lint e segurança permanecem.

Somente mudanças em módulos explicitamente cobertos de autoria/templates/observação/benchmark/view/Claude e seus testes selecionam a suíte crítica. Alterações em owner, lease, store, workspace, serviços, dependências, arquivos compartilhados, caminhos desconhecidos ou histórico ausente mantêm cobertura ampla. Main mantém a suíte completa de Agent Fabric. Nenhum teste existente foi removido ou assertion enfraquecida. O tempo total do GitHub Actions não foi medido e a nova configuração ainda não foi executada no GitHub.

## Correções da revisão independente

1. Comandos sem provedor usam declaração explícita do owner `tokenAccounting: "none"` e estado não aplicável; comandos arbitrários continuam desconhecidos. Uso informado inesperadamente é contabilizado.
2. Resolver não herda aprovação dos itens: recibo causal permite substituir a proveniência original, com nova avaliação completa e checks de item/final.
3. Freshness usa IDs dos recibos emitidos pelo owner, evitando reaproveitamento baseado em timestamps iguais ou relógio regressivo.
4. CI reduzida foi restringida para preservar regressões dos módulos centrais.
5. Recuperação foi exercitada com workspace/marker reais, além do encaminhamento simulado da thread.

A revisão daquela rodada não encontrou bloqueadores adicionais no conjunto examinado. A revisão cruzada posterior encontrou e corrigiu bugs adicionais de recuperação, accounting, scopes, aprovação/evidências, Unicode, MCP e CI; veja `WORKFLOW_PROGRAM_COMPETITIVE_REVIEW.md` para os resultados atualizados e limites. Revisão estática e fixtures locais não certificam produção.

## Condições de operação e pendências externas

- OwnerMaxTokens é cumulativo sobre runs retidos e reservas finais; não se renova diariamente. É orçamento de admissão por tokens, sem preço de CPU/storage ou garantia de teto monetário.
- Trabalho em curso pode exceder a estimativa reservada; término desconhecido mantém reservas e exige reconciliação.
- Claude requer executável nativo compatível, versão >=2.1.259 e política cooperativa/rede explícita. A consulta de versão acontece antes de inferência no uso futuro; não foi executada nesta sessão.
- Retomada no workspace original e imagens nativas estão habilitadas para Codex. Claude não recebe essas garantias neste adapter.
- Imagem entregue não significa imagem compreendida. Protocolo simulado não demonstra qualidade de programação.
- Owner background reutiliza o startup local existente; nenhum serviço global foi instalado e nenhum owner permanente foi iniciado nesta entrega.
- Snapshot incremental, GC destrutivo, cache de respostas entre runs e owner distribuído continuam extensões condicionais, conforme o plano.
- G4–G6 — qualidade externa, eficiência representativa e superioridade competitiva — exigem avaliação posterior. Não são inferidos dos testes locais.

Os artefatos gerados foram atualizados pelo gerador, sem edição manual. Arquivos não rastreados preexistentes foram preservados. Alterações permanecem no checkout para revisão.
