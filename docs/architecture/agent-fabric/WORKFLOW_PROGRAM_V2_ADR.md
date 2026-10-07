# Agent Fabric workflow runtime: decisão normativa



Status: implementado em desenvolvimento, 2026-10-07. O usuário dispensou compatibilidade com Forge legado. Não há interpretador operatorVersion 1 nem migração automática de checkpoints antigos. Use runs novos ao trocar a semântica do runtime.



## Autoria e estrutura



TypeScript finito com 50 construtores públicos produz JSON IR schemaVersion 2/operatorVersion 2. O lowerer não executa código: aceita imports nomeados do módulo Forge, const, dados finitos, spreads de objetos const, `as const`, `satisfies` e imports de tipos de autoria. Rejeita callbacks, acesso ao filesystem, chamadas arbitrárias e loops JavaScript. Tipos nominais distinguem refs de schemas, executores, políticas, aceitação, populações, receitas e programas. JSON IR também é aceito diretamente; ambos passam pelo mesmo validador owner e pelas mesmas verificações de tipos/esquemas.



O grafo inclui dependências de dados e `after`. Posição textual não ordena roots: `sequence` ordena filhos, `parallel` executa filhos requeridos com diagnóstico collect-all ou cancel-siblings. Blocks com vários filhos exigem `result`; shorthand de um filho é permitido. Branch, loop, map e subworkflow têm contextos léxicos explícitos. Loop retorna estado final. Map retorna envelope de coleção com itens identificados, outcome separado do dado, resultados, falhas e seal. IDs de membros usam NFC antes da unicidade, comparação UTF-8 e encoding único de segmentos. Coleções são finitas e seladas.



## Owner, limites e recuperação



Um owner exclusivo por diretório de estado usa lease com PID/token/epoch. Um segundo owner vivo é rejeitado; morte permite recuperação conservadora. O scheduler limita atividades, não controles pais: owner 4, run por política e scopes ancestrais por map. Fairness round robin entre runs elegíveis. Fila é persistida antes da admissão; limite absoluto de run vale também na fila.



Intent/debit/reserva são persistidos antes de execute. Tentativa sem resultado observado é uncertain e retém sua reserva; restart reconstitui reservas. Timeout/cancel não prova término de árvore de processos. Worker sem confirmação de cancelamento não bloqueia close indefinidamente; permanece uncertain, sem redispatch ou apply. Reconciliação exige observação externa, não mera intenção de repetir. Resultado observado mas inválido é invalid_output e libera slot. A preparação cancelada não é despachada.



Completed íntegro do MESMO run é reutilizado antes de preparar workspace/adapter. Digests fecham executor, inputs, candidato, escopo e contratos pinados. Artifact perdido/corrompido bloqueia; não vira cache miss. Isso não é cache entre runs e não prova replay exatamente uma vez de efeitos externos. Repair checkpointa rounds/assessment/infra antes da fase; resume não repõe débitos.



Wait é waiting e não falha. Irmãos independentes continuam; eventos e deadlines absolutos acordam o scheduler enquanto o owner está vivo. Restart requer resume explícito. Eventos têm request CAS, identidade, target/generation/type/correlation, schema, proveniência, subject e expiry. Idempotência inclui subject/expiry. O host deve autenticar a origem da proveniência; texto vindo de worker não vira autorização humana.



Barrier replan invalida ramos alterados e dependentes, preservando intactos; additive preserva templates existentes. Fenced replan é opt-in e conservador: parada global e uncertain até observação. Não há fencing local distribuído. Política/contrato/executor atuais são conferidos novamente antes de NOVO dispatch e apply; fatos históricos continuam legíveis.



## Candidatos e aceitação



Executor read não tem autoridade de alteração; isolated-write produz deltas com beforeimages em clones. Command é cooperativo; não se apresenta como sandbox forte. Codex usa sandbox e rede desabilitada; subprocessos/agentes internos não ganham garantia fictícia de quota agregada. Só owner registra CandidateRef, DeltaRef e receipts a partir de tentativas observadas.



Owner AcceptanceContract declara critérios, obrigações por item/final, checks distintos e bindings de assessments. Autor não omite checks mandatórios. AssessmentContext traz candidato, invocation/assessment IDs, obrigações, ambiente e EvidenceRefs. Capturas PNG/JPEG/WebP têm limites de bytes/dimensões/pixels, origem da tentativa, candidato/build/env/item/route/viewport/state. Consumidores recebem arquivos readonly; metadata só não prova render correto ou qualidade visual. Limites: 8 MiB/imagem, 32 MiB/lote, 100 imagens/lote.



Repair assess-first evita edição sem defeito. Aprovação exige findings vazios, checks passados e cobertura integral das obrigações. Report incompleto é inconclusive, sem edição. Infra/capture inválida é diferente de finding visual. Item assessment fecha o ledger local; compose integra candidatos compatíveis. Conflito para em needs-resolution, sem merge automático. Final assessment recaptura e verifica TODA a população sobre o candidato integrado atual; receipts locais antigos não substituem aceitação final.



Gate exige o mesmo candidato, contratos, geração, seal, cobertura e tentativas distintas observadas. Partial/quorum exigem permissão owner e não aprovam por si uma obrigação all-required. Quorum tem threshold explícito e espera todos os outcomes assentarem. Collect-all produz diagnóstico e não avalia result de scope requerido falho. Se aprovação humana for exigida, gate consome sinal autorizado bound ao candidato/contrato; decline/expiry/fabricação não aprovam. Apply é ação separada, com autorização, gate congelado, beforeimages e reconciliação de publicação incerta.



## Persistência, inspeção e limites



R2.2: envelopes format 3 contêm ponteiros para snapshot e nó de journal imutáveis SHA256; nós encadeiam parentRef/version/runId. O histórico acumulado e o snapshot não são duplicados no envelope. Escrita atômica/fsync publica o envelope por último. Runs novos usam program-runs-v3, sem migração. Mutação interna sem mudança não escreve checkpoint; receipts autenticados continuam persistidos. Owner e store compartilham recuperação de reclaim abandonado. Transações são serializadas por run; definitions validadas são memoizadas pelo digest, sem dispensar verificação do envelope. History, explain, artifact-get e diff compartilham CLI/MCP/owner. Artifact-get só aceita refs alcançáveis pelo run; não lê paths livres.



A durabilidade é local, com owner vivo; não há promessa de serviço remoto/App fechado. Sem GC automático, cache cross-run, streaming ilimitado, race, código TS arbitrário, YAML nativo, múltiplos harnesses completos ou resolução automática. Nenhuma superioridade sobre Claude DW foi medida. Validação sem LLM é requisito: FORGE_FABRIC_TEST_MODE=1 recusa factories reais Codex; adapters determinísticos e SDK stubs são permitidos. Qualidade de modelo permanece fora da evidência.



## Correções R2.2



Plano: WORKFLOW_PROGRAM_V2_CORRECTIONS.md. Subworkflow herda signal/scopes/item/estado lexical e não substitui população. visualCases vincula captura a rota/viewport/estado/dimensões esperados; requiredEvidence segue o escopo das obrigações. Receipt batch commit é atômico com o resultado observado. Ref/operation/expression generics preservam conexões de autoria; schemas owner continuam a autoridade. program-explain expõe grafo/Mermaid e instâncias separadas.
