Aqui está o status atualizado de cada item:

2. PROBLEMAS IMPORTANTES
Networking
Problema	Status
Event handler overwrites (onMessage =)	✅ Feito — migrado para EventEmitter pattern em networking.ts
Join timeout não limpa socket	✅ Feito — limpeza garantida em useOnlineLobby
Clock sync falha silenciosamente	✅ Feito — devLog agora loga em dev
Bots são locais (multiplayer)	✅ Feito — host simula bots e envia POS para clientes (renderizam como RemoteKart)
WebRTC fallback inconsistente	✅ Feito — POS sempre relayed via Socket.IO além do WebRTC (dedupe por timestamp)
Código / Type Safety
Problema	Status
~10 usos de any	✅ Feito — tipados (ack, racerStates, navigator, server relays)
BotKart physics diferente do KartPro	✅ Feito — BotKart agora usa mesmo preset/massa do KartPro
Banana/Oil Date.now()	✅ Feito → performance.now()
Banana.tsx dead code	✅ Feito — deletado
Server
Problema	Status
Validação de input	✅ Feito
generateRoomCode() recursão	✅ Feito — loop com fallback
Rate limiting	✅ Feito — limiters por socket (lobby/signaling/pos/clock)

3. FEATURES FALTANDO
Feature	Status
Menu de Pausa (ESC)	✅ Feito — ESC abre overlay com Resume/Back
Settings (audio, gráficos, controles)	✅ Feito — modal com volume/mute, qualidade, mapa de controles
Rematch / Próxima corrida	✅ Feito — botão de revanche (host online ou local)
Tutorial / Como Jogar	✅ Feito — modal How To Play (EN/PT) no menu
Modo espectador	❌ Pendente
Mais mapas	✅ Feito — 3 novos mapas (Volcano Rush, Crystal Caves, Cyber Loop) = 7 total
Sons faltando (volta, vitória, menu)	✅ Feito — lap complete, victory/finish, UI click/hover
Metadados/SEO (título, OG tags, generator)	✅ Feito — metadata Next completada (title, OG/Twitter, keywords)

4. MELHORIAS DE PERFORMANCE
Item	Status
forceUpdate nas pools	✅ Feito — pools de banana/óleo mutam in-place sem realloc
RemoteKart snapshot reciclagem	✅ Feito — pool reutiliza snapshots sem realloc
Track chevron → CSS animation	✅ Feito — chevrons usam material estático sem useFrame/JS per-frame
BotKart cachedGroundY stale	✅ Feito — cache invalida após 200ms e recasta
console.log produção	✅ Feito

5. ISSUES MENORES
Item	Status
FollowCamera props mortas	✅ Feito
TODO esquecido KartPro:16	✅ Feito — KartPro aceita preset via props
GameErrorBoundary i18n	✅ Feito — strings movidas p/ TEXTS (EN/PT)
60+ shadcn/ui não usados	✅ Feito — removidos 46 componentes (81%) + 28 deps + 112 pacotes npm
React Native/Expo deps sem uso	✅ Feito
Quer que eu continue com algum grupo específico? Os que teriam mais impacto imediato seriam:

Event handler overwrites + join timeout (estabilidade do networking)
Menu de Pausa (UX básica que todo jogo precisa)
BotKart physics alinhamento (gameplay)
Metadados/SEO (rápido de fazer)
