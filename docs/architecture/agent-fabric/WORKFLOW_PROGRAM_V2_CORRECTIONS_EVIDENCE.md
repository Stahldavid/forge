# Evidências das correções Agent Fabric R2.2

Data: 07/10/2026. Fonte: working tree de C:/Users/stahl/Projects/forge, baseado em 083077bdc9aee74e81d941a67c3c38bd31d8e2d0 (forgeos 0.1.0-alpha.70). Não representa npm publicado, instalação global ou commit novo.

## Implementação

Subworkflow agora também recebe contexto lexical no preflight e na inferência de schemas, alinhado à execução; uso de item fora de map e campo inexistente continuam rejeitados.

As seis frentes de WORKFLOW_PROGRAM_V2_CORRECTIONS.md estão implementadas: herança de contexto de subworkflow; lease compartilhado com recuperação de guardas mortos; captura por escopo/catálogo visual; conexões genéricas com schemas owner; persistência compacta/journal encadeado/no-op; templates e grafo/Mermaid. Capturas de uma tentativa são registradas atomicamente com seu resultado observado. Formato 3 usa program-runs-v3 e preserva sem carregar os diretórios anteriores.

## Validação

FORGE_FABRIC_TEST_MODE=1 em todos os comandos das suítes determinísticas desta revisão. Nenhum provider/LLM real foi executado nessas suítes. Os executores de teste são fixtures locais ou adapters/SDK stubs. O smoke real autorizado separadamente está documentado abaixo.

- Generate, check e typecheck passaram.
- Rodada inicial: 90 testes/4 arquivos, zero falhas, incluindo fixture de 20 páginas.
- Rodada final direcionada: 43 testes/3 arquivos, zero falhas, incluindo templates/catálogo, quotas/cancelamento do filho, lock/reclaim, schema input/default, histórico compacto e fixture de empacotamento.
- Verificação framework final: 1679 aprovados, 0 falhas, 4 skips condicionais existentes; 280 arquivos/71 chunks; todos os 11 gates passaram. A última rodada inclui o novo teste lexical de subworkflow. Generate/check/typecheck e exports foram renovados depois da correção final.
- Regressão lexical adicional: 39 testes de workflows passaram, sem falhas. Os tipos de autoria incluem provas negativas via @ts-expect-error, compiladas no typecheck.

Duas tentativas anteriores de verify framework falharam: exports de adapters desatualizados e uma asserção de concorrência baseada em 20 ms; depois, timeout de 10 s da fixture de empacotamento sob carga. Adapters foram regenerados, o teste de overlap usa barreira determinística, cleanup das fixtures tem limite de 30 s e subprocesso de empacotamento tem limite de 60 s. As asserções foram preservadas; uma rodada completa com dois jobs passou; após a correção lexical final, outra rodada completa com quatro jobs também passou. Nenhum gate foi desativado.

## Perfil determinístico

Adapter fixo, tarefas de 3 ms, uma falha em item-7 e close/reopen/resume. Cada conjunto teve uma repetição. Dados e hashes estão em FABRIC_CORRECTIONS_PROFILE.json na entrega da conversa.

| Itens | Cold ms | Recovery ms | Disk bytes | Chamadas no recovery | Irmãos intactos repetidos | Transações recovery |
|---|---:|---:|---:|---:|---:|---:|
| 12 | 1930 | 1187 | 1008335 | 1 | 0 | 11 |
| 48 | 13927 | 11727 | 9775520 | 1 | 0 | 11 |
| 96 | 38570 | 26688 | 34308647 | 1 | 0 | 11 |

Snapshot bytes escritos no cold: 766630 / 8948318 / 32700773. Envelope: 32427 / 118436 / 233156. Journal: 25875 / 94820 / 186788. Métricas incluem bytes temporários efetivamente escritos; locks não estão incluídos nas categorias de conteúdo. Pico de atividades observado: 1 nas tarefas de 3 ms; teste com barreira verifica overlap de duas roots. Não inferir throughput a partir de tarefas curtas.

## Smoke real autorizado (2026-10-07)

Uma execução curta do ProgramRunService com o adapter Codex real, modelo gpt-6.1-sol, modo data, executor investigador somente leitura, dependências desativadas, uma tentativa e timeout de 60 s. Repositório Git temporário com um único arquivo; resultado persistido {"ok":true}, status completed, arquivo original intacto. Duração: 28.979 ms. Uso informado pelo SDK: 20.421 tokens de entrada, 0 em cache, 15 de saída. A entrada foi maior que o esperado apesar do prompt mínimo; não houve nova chamada para otimização.

Run: program-ec04371b16d7e8f844054d5b11ed011e. Thread Codex: 01a117e1-0e51-7261-ab3a-3e0cacd02432. Uma tentativa owner-visible concluída. O teste comprova o caminho básico owner/scheduler/workspace/SDK/schema/persistência; não comprova qualidade dos modelos, fluxos complexos, pixels de UI ou superioridade empírica sobre Claude DW. A restrição anterior de zero LLM aplica-se às suítes determinísticas; somente este smoke foi autorizado separadamente.

## Limites da evidência

## Gate de publicação Linux e correção concorrente

A primeira tentativa de publicação da alpha.71 (GitHub Actions 37676855215, commit bf77032f) foi bloqueada: 1.841 testes passaram, 5 tiveram skip condicional e um falhou. A corrida ocorria quando um replanejamento aditivo invalidava a versão semântica durante a persistência do gate; o erro "Gate inputs changed" interrompia o programa antes do recálculo. Não houve publicação dessa tentativa.

O runtime agora distingue a invalidação AF_PROGRAM_REVISED de falhas de execução, aguarda os irmãos e recalcula controles somente enquanto o programa segue executando com um plano diferente. Uma falha real de irmão tem prioridade e continua bloqueando conclusão. O teste usa barreira explícita antes do commit do gate e cobre ambos os casos, sem dependência de timing ou chamadas LLM.

## Limites do runtime

A validação direcionada também expôs uma corrida de shutdown: o ciclo era removido de active antes de terminar a leitura assíncrona do finalizador. close agora aguarda esse finalizador antes de liberar o owner, e um teste com barreira mantém a leitura pendente para verificar a retenção do ciclo. Nenhuma dessas correções usa chamadas LLM.

Snapshots completos ainda dominam armazenamento e custo computacional; a otimização remove duplicação/journal acumulado e writes sem mudança, mas não torna o custo linear. Tempos são locais sob carga e não comparam Claude DW. Não há medida de qualidade/custo/produtividade dos modelos. Catálogo visual delimita casos exigidos; header e metadata não comprovam pixels/estado reais. WebP continua limitado a VP8X. Commands são cooperativos; não há sandbox forte geral. Durabilidade continua local, sem exactly-once externo, GC automático ou serviço distribuído.
