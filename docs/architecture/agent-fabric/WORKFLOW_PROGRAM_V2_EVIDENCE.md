# Evidências: Agent Fabric workflows R2.1

Data: 2026-10-07. Base do trabalho: 083077bdc9aee74e81d941a67c3c38bd31d8e2d0, forgeos 0.1.0-alpha.70. Implementação de desenvolvimento; não é uma publicação npm. O usuário dispensou compatibilidade legada e proibiu testes reais com LLM. Nenhum piloto SDK/modelo foi executado nesta implementação; relatos de pilotos anteriores não são evidência da revisão atual.

> Registro da implementação R2.1. A revisão posterior R2.2 corrige herança de subworkflow/locks/capturas e muda o formato de persistência; consulte WORKFLOW_PROGRAM_V2_CORRECTIONS.md e WORKFLOW_PROGRAM_V2_CORRECTIONS_EVIDENCE.md. Os números abaixo são históricos desta rodada R2.1.

## Núcleo entregue

DSL/IR operatorVersion 2 com cinquenta construtores de autoria e quinze controles. Grafo com dependências de dados/after, sequence/parallel e Blocks explícitos. Quotas de atividades em owner/run/scopes, reserva/debit/queue persistidos, owner exclusivo, waiting e deadlines, completed íntegro reutilizado antes de prepare, replan seletivo e incerteza conservadora. Contratos owner por item/final, evidência binária imutável, review/checks/capturas ligados ao candidato, ledger local, compose, aceitação final integral e aprovação humana separada de apply. Catálogo API e exemplo atuais em docs/agent-fabric-programs.md e examples/agent-fabric-v2/ui-audit.workflow.ts. Skill distribuída atualizada.

## Verificações focadas

Uma execução focada completou 93 testes em cinco arquivos, zero falhas e 311 assertions: program-v2, program-v2-process, program-workflows, program-ui-fixture e codex-sdk-worker. SDK usa factories simuladas. Checks adicionais cobrem tipos/results dentro de Blocks/map e callbacks tardios de SDK: o owner antigo não altera o sucessor. O typecheck passou, incluindo o mesmo exemplo TS compilado/lowered e uma prova negativa de refs nominais. Testes de commands/apply executam processos Node determinísticos e Git temporário, não modelos.

A verificação ampla inicial encontrou exports de adapters stale, uma expectativa de teste que assumia ordem de receipts com IDs aleatórios e um timeout isolado na fixture antiga de limpeza de pacote. Exports foram regenerados; expectativa passou a localizar conteúdo/candidato sem assumir ordem; a fixture antiga passou isoladamente sem alteração. Um teste novo de deadline foi ajustado para estabelecer primeiro reservas incertas com prazo normal e só então exercitar a fila bloqueada com prazo curto; assim não assume throughput do host durante a admissão. A execução ampla final passou: onze gates, 279 arquivos/71 chunks, 1667 testes e zero falhas; nenhum gate pulado. O callback tardio recebeu adicionalmente 43 testes focados e typecheck após sua alteração; outputs de geração/adapters foram reconferidos no fechamento. O primeiro resultado não é representado como sucesso.

## P2: fixture UI

Vinte páginas HTML locais com três defeitos conhecidos, executores command determinísticos e owner inventory: exatamente três implementações, 43 capturas (20 iniciais + 3 após correção + 20 finais), 20 capturas frescas finais e 21 obrigações finais satisfeitas. Destino preservado porque o exemplo não chama apply. Uma fixture separada usou Edge headless sobre uma página HTML local e produziu três screenshots reais (baseline, candidato corrigido e final), uma implementação, duas obrigações finais e zero LLM. Nenhuma prova de qualidade visual/modelo é inferida dessas fixtures.

## P3: profiling determinístico

Script reproduzível: scripts/benchmark-fabric-workflows.ts. Dataset congelado: doze itens, delay simulado 3 ms, uma falha em item-7, concorrência permitida quatro, três repetições com owner close/reopen/resume. Digest sha256:58c9295b62663693d909726bfef8e2ae3779d20507caabfd9161b705f46e3412.

| Repetição | Inicial ms | Recuperação ms | Attempts | Calls na recuperação | Calls intactos repetidos | Disk bytes |
|---|---:|---:|---:|---:|---:|---:|
| 1 | 1389 | 1124 | 13 | 1 | 0 | 2141322 |
| 2 | 1343 | 1224 | 13 | 1 | 0 | 2141031 |
| 3 | 1374 | 1147 | 13 | 1 | 0 | 2141472 |

As tarefas simuladas de 3 ms apresentaram pico observado um devido à persistência; não se confunde limite quatro com overlap efetivo. Métricas incluem transações/tempo/bytes por owner e retained disk. Serialização por run resolveu contenção; validação de definitions é memoizada por digest, mantendo checks de envelope/artifact. Não há comparação de velocidade com datasets antigos diferentes, benchmark Claude, custo/token real ou superioridade de produto comprovada.

## Rastreabilidade da matriz

| Cenários | Evidência técnica |
|---|---|
| T01–T09, T11–T16 | program-workflows + program-v2: grafo/controle/scopes, eventos/deadlines, reprise, falhas/reservas, artefatos e replan |
| T10 | aprovação/declínio vinculados a candidato; owner gate rejeita receipt fabricado; nenhuma autorização por dado de worker |
| T17, T22, T34, T42 | intent/debits persistidos, repair limitado/restart, outputs sem observação, gap de parent commit, SDK stub e fuse real-factory |
| T18–T23, T26, T36–T37 | UI fixtures: imagem inválida/ambiente errado/cobertura incompleta/check omitido/final completo/regressão final, zero-edits quando correto |
| T24–T25, T27–T29 | commands reais em Git temporário: conflitos, diamond/beforeimages, gate/candidate, apply idempotente/uncertain, readonly sem autoridade |
| T30–T31 | finite AST, tipos/schema, IDs/ciclos, import/callback/I/O rejeitados, bounded expansion |
| T32 | sandbox/capabilities e defaults SDK verificados com factory simulada; isolamento command cooperativo declarado, sem promessa de controle de agentes internos |
| T33 | revogação live bloqueia novo dispatch; histórico completado continua legível; apply revalida owner |
| T38–T40 | quorum explícito/settled, collect-all diagnóstico, NFC/encoding/order e user data separada de outcome |
| T41 | owner exclusivo, restart incerto e reconstrução/liberação de reservas; filesystem power-loss e todos os interleavings não são alegados |
| T35, T43 | Fora do núcleo: não existe GC/resolução automática; nenhuma extensão foi ativada |

Limites: sem cache cross-run, distributed execution, live fencing local, race/streaming ilimitado, GC/resolução automática ou múltiplos harnesses completos. Durabilidade é local com owner vivo; nem qualidade LLM, produção, App fechado ou superioridade sobre Claude DW foram verificados. Testes de modelos dependem de autorização futura e não são gates desta entrega.
