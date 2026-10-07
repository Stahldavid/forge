# Agent Fabric: plano de correção e acabamento R2.2

Objetivo: fechar os achados da revisão independente de 07/10/2026, mantendo TypeScript finito → IR → owner → scheduler → evidências → gate → apply. Sem compatibilidade legada e sem testes com LLM. Não é uma promessa de superioridade empírica sobre Claude DW.

## 1. Contexto e capacidades de subworkflow

Herdar signal, scopes de atividades, dependências e identidade do item. Manter item e estado do loop como contexto lexical do chamador; workflowInput é o input explícito do filho. O filho não pode substituir policy, acceptance nem population do root. Verificar map concurrency=1 com várias atividades no filho, cancel-siblings, identidade de item e contratos herdados.

## 2. Um protocolo de lease para owner e store

Unificar admissão por hardlink, identidade PID/token, assert antes de release e reclaim de titulares mortos. Recuperar guardas abandonados sem retirar leases vivos. Testes determinísticos cobrem guarda morta, guarda viva, owner morto, exclusão e identidade alterada. PID vivo desconhecido continua conservador; não prometer exatamente uma vez.

## 3. Obrigações e cobertura visual

Derivar captura somente das obrigações aplicáveis ao assessment. Obrigações item se expandem para o item corrente ou toda a população no assessment final; obrigações final só se aplicam na fase final. Introduzir population.visualCases, um caso por member com itemKey, route, viewport, state, width e height esperados. Catálogo informado deve cobrir exatamente os members e ter tuplas únicas. Conferir receipt contra o catálogo antes de registrar. Captura final recobre todos os casos ativos. Sem catálogo visual, a garantia continua cobertura por item; não inferir todas as UIs. Header de imagem não prova renderização nem qualidade visual.

Agrupar registros de capturas com o resultado observado da tentativa em uma transação; blobs são persistidos antes dela. Falha deixa blobs órfãos, nunca evidência aceita parcialmente.

## 4. Tipos de autoria

Adicionar generics de input/output nas refs, operações e expressões, output(operation), field com chaves verificadas e inputs tipados nos executores/subworkflows. Generics não substituem schemas do owner. Permitir inputSchema opcional no executor e validar antes de preparar/dispatch. O lowerer continua produzindo o mesmo IR, sem executar código. Testes de compilação devem demonstrar erros reais de tipo; exemplos devem baixar no mesmo lowerer.

## 5. Persistência e perfil determinístico

Remover a duplicação do snapshot inteiro no envelope e a regravação do histórico acumulado em cada transação. Persistir snapshot e nó de journal imutáveis, com parentRef/version/runId; publicar por último envelope compacto de ponteiros e receipts CAS. Read valida integridade e checkpoint; history percorre e valida cadeia/versionamento. Artefato perdido/corrompido bloqueia. Sem migração: runs antigos devem ser recriados.

Medir todos os bytes efetivamente escritos, divididos em snapshot, journal, envelope e artifacts, com perfil fixo em 12/48/96 itens, fault+resume e zero chamadas a modelo. Relatar custo local e limites sem extrapolar throughput de LLM. Não agrupar intent/debit/dispatch de modo que enfraqueça recuperação.

## 6. Autoria e inspeção

Expor grafo estático e Mermaid em program-explain, com tipos, dependências e estado; distinguir templates de expansões observadas. Adicionar template de map → subworkflow com input explícito e um exemplo de população visual desktop/mobile. Documentar diagnóstico, herança, tipos, persistência e limitações no guia público/ADR/skill do repo.

## Entrega e aceitação

Executar generate, check, typecheck, testes determinísticos direcionados e verify framework com FORGE_FABRIC_TEST_MODE=1. Nenhum provider/LLM real, deploy ou publicação npm é necessário para esta correção. Registrar resultados e limites em relatório de entrega. Preservar alterações anteriores e restaurar apenas ruído gerado que já estava limpo antes desta rodada.

## Estado final

Implementado e validado em desenvolvimento. Última suíte completa: 1679 aprovados, nenhuma falha, 4 skips condicionais existentes; 11 gates passaram. Evidência detalhada: WORKFLOW_PROGRAM_V2_CORRECTIONS_EVIDENCE.md. O runtime e a validação herdam o contexto lexical do filho; inferência mantém rejeição de campos inexistentes.
