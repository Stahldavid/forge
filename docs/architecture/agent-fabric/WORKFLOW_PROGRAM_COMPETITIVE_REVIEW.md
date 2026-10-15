# Forge Agent Fabric — revisão da implementação contra o plano

Data: 2026-10-10. Plano: `WORKFLOW_PROGRAM_COMPETITIVE_PLAN.md`.
Revisão e correções locais sobre a implementação em andamento, sem commit, push ou publicação.

## Método e resultado

Três subagentes revisaram módulos diferentes daqueles que implementaram: runtime, workers e autoria/CI. A integração principal revisou a interface pública MCP e os limites das evidências. A revisão encontrou bugs e lacunas de implementação, corrigidos nesta entrega. Testes determinísticos foram direcionados aos caminhos afetados; nenhum modelo Codex/Claude real foi executado.

## Correções por prioridade e módulo

| Prioridade / etapa | Problema encontrado | Mudança e critério de aceite |
|---|---|---|
| P0 / E3,E5 | Recuperação podia aceitar contexto/evidências diferentes; segunda recuperação podia perder a thread | `program-worker` vincula contexto entregue, observações adicionais e bytes das evidências ao fingerprint; `program-service` persiste threadId no novo dispatch. Retomada compatível passa e incompatibilidades bloqueiam antes do modelo. |
| P0 / E8 | Colisões arquivo/diretório e diferenças de caixa escapavam; resolver podia descartar arquivos fora de seu scope | `program-service` detecta colisões por trie e exige scope cobrindo todos os arquivos propostos. Resolver ainda produz candidato novo, com avaliação final nova. |
| P0 / E4 | Templates aceitavam contratos de aprovação/captura sem construir o fluxo necessário | `program-templates` exige approvalSchema compatível, cria waitEvent vinculado e gate autorizado; captura exige migration com population/evidence. Perfis não suportados são rejeitados antes do dispatch. |
| P0 / E1,E6 | Contadores inválidos ou semânticas misturadas podiam contaminar accounting | `program-observation` valida inteiros seguros, cached ≤ input e semântica por origem antes da persistência. Observações inválidas não alteram registro. |
| P1 / interface pública | MCP author-types sem argumentos exigia runId e falhava | `agent-memory/mcp` trata a ação separadamente. Chamada autenticada com `{}` chega ao owner; argumentos extras são rejeitados. |
| P1 / E4 | Autoria podia produzir scopes incompatíveis com executores/policy | Preflight intersecta permissões de acceptance/policy/executor e valida reviewers, checks, implementers e resolver, incluindo override explícito. |
| P1 / E2 | Capacidade em execução não podia diminuir pela API do host | `program-scheduler` e `program-service.updateRuntimeOptions` preservam attempts ativos e limitam novas admissões. Arquivo de configuração continua aplicado no startup/restart. |
| P1 / E6 | Usage desconhecido após apply não podia ser reconciliado | Reconciliação autenticada de usage aceita em applied, sem reabrir publicação, gate ou resume. |
| P1 / workers | UTF-8 dividido entre chunks podia ser corrompido | Workers command/Claude usam decodificação streaming; fixture de subprocesso local preserva caracteres multibyte. |
| P1 / CI | Bun retorna sucesso com filtro sem testes; guardas poderiam desaparecer silenciosamente | Política valida arquivos/nome dos testes; runner exige linha de resultado passing para cada gate crítico. Cobertura ampla continua nos módulos centrais. |
| P1 / lifecycle | Razão antiga de espera permanecia após aprovação e sucesso | Serviço limpa reason ao acordar e concluir validamente, preservando razões reais de falha e histórico. |
| P2 / E0 | Resumo individual não comparava equivalência entre relatórios | `compareBenchmarkReports` e CLI pareada verificam tasks/model/tools/context/contract/budget/criteria. Missing permanece null, contadores inválidos/overflow são rejeitados e entradas diferentes não autorizam superioridade controlada. |
| P2 / E7 | Perfil não separava cache/preparação/execução | `managed-environment` emite cache.verify/cache.copy/dependencies.install; worker observa workspace, environment, captura e execução, inclusive falhas. Duracões aninhadas não são soma de wall time. |

## Dependências e compatibilidade

- ApprovalSchema e evidence executors pertencem ao registro do owner; workers não autorizam aprovação humana.
- Resume depende de término observado, reconciliação, workspace original e fingerprint compatível. Markers antigos sem a nova vinculação não são reescritos para parecer compatíveis.
- Redução de capacidade usa API confiável do host. Não há watcher automático nem parâmetro de workflow alterando a capacidade global.
- Review/bugfix convenience templates não suportam diretamente captura de população; migration suporta o perfil explícito. Fluxos UI mais amplos continuam disponíveis via IR existente, não devem ser apresentados como autoria automática universal.
- Métricas de preparação podem ocorrer antes da admissão; orçamento de tokens não mede custo de CPU/storage e não garante teto monetário.

## Verificação focada

| Grupo | Evidência |
|---|---|
| Runtime | Quatro testes focados: counters inválidos/semântica, recuperação dupla, resize sem interrupção, reconciliação pós-apply e conflitos exact/hierarchy/case. Caso de conflito: 8,78 s após trie. |
| Workers | Dois testes direcionados, 23 assertions, aproximadamente 3 s; fingerprint adicional com 4 assertions. Git/contexto reais locais, sem provedor. |
| Interface pública | Dois testes, 17 assertions, 2,95 s; inclui owner HTTP local autenticado para MCP author-types. |
| Autoria/templates/benchmark/CI | Sete testes passaram em 4,99 s, incluindo aprovação humana consumida e gate novo. Seis testes unitários passaram em 316 ms após a guarda final de resultados de CI; sintaxe do runner válida. |
| Typecheck global e lint | Exit 0 em ambos. |
| Geração/export e framework | Geração, exports generic/codex e framework aprovados; 11 etapas, nenhuma falha, typecheck/testes omitidos somente nesta execução. Aviso existente FORGE_RLS_PGLITE_NOT_AUTHORITATIVE preservado. |

Os números correspondem a rodadas específicas e não devem ser somados como testes únicos. Verificação de framework omite suíte completa e repetição de typecheck, executados separadamente no escopo indicado. Não houve instalação de dependências, GitHub Actions ou inferência paga.

## O que ainda falta

1. **P0 de avaliação, G4–G6:** executar avaliação independente pareada de qualidade, eficiência e robustez em tarefas representativas. Depende de inputs controlados, critérios externos e medição completa. Sem essa evidência, não afirmar superioridade sobre Claude Code.
2. **P1 operacional:** smoke com versão real compatível do Claude CLI e execução da nova CI no GitHub. Fixtures de protocolo não comprovam compatibilidade instalada ou duração real da CI.
3. **P2 de conveniência:** ampliar templates review/bugfix para perfis UI/população, se necessário ao produto. Hoje a rejeição explícita impede gerar programas impossíveis; IR customizado oferece o fluxo completo.
4. **Condicionais do plano:** cache entre runs, snapshots incrementais, GC e owner distribuído permanecem extensões, dependentes de medição ou necessidade concreta. Não são apresentados como implementados.

Os artefatos gerados são atualizados pelo gerador. Mudanças permanecem locais; arquivos preexistentes foram preservados. Esta revisão delimita a implementação e suas evidências, sem certificar produção ou qualidade de modelos.
