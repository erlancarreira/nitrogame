export type Language = "en" | "pt";

export const TEXTS = {
    en: {
        // Main Menu
        startEngine: "START ENGINE",
        ultimateExperience: "ULTIMATE RACING EXPERIENCE",
        mode: "Mode",
        local: "LOCAL",
        online: "ONLINE",
        code: "Code",
        localRace: "LOCAL RACE",
        localDesc: "Play with bots on your device",
        onlineMulti: "ONLINE MULTIPLAYER",
        onlineDesc: "Race against friends worldwide",
        back: "Back",
        driverProfile: "DRIVER PROFILE",
        driverName: "Driver Name",
        color: "COLOR",
        changeModel: "Change Model",
        goRace: "GO RACE!",
        backModes: "Back to Modes",
        trackSelect: "TRACK SELECTION",
        raceConfig: "RACE CONFIG",
        laps: "LAPS",
        loading: "Loading...",

        // Multiplayer Lobby Setup
        multiplayer: "MULTIPLAYER",
        createLobby: "Create Lobby (Host)",
        orJoinExisting: "OR JOIN EXISTING",
        enterLobbyCode: "Enter Lobby Code",
        joinLobby: "Join Lobby",
        cancel: "Cancel",
        lobbyCode: "LOBBY CODE",
        copied: "Copied!",
        copyCode: "Copy",
        shareWhatsapp: "WhatsApp",
        connecting: "CONNECTING...",
        players: "PLAYERS",
        changePack: "Change Pack",
        waitingForHost: "WAITING FOR HOST",
        mapLabel: "Map",
        lapsLabel: "Laps",
        hostConfiguring: "HOST IS CONFIGURING RACE...",

        // Connection Status
        creatingLobby: "Creating Lobby...",
        lobbyCreated: "Lobby Created!",
        failedCreateLobby: "Failed to create lobby",
        connectingStatus: "Connecting...",
        connected: "Connected!",
        disconnectedFromHost: "Disconnected from host",
        lobbyNotFound: "Lobby not found!",

        // HUD
        go: "GO!",
        lap: "LAP",
        time: "TIME",
        pos: "POS",
        leaderboard: "LEADERBOARD",
        steering: "STEERING",
        speed: "SPEED",
        controls: "CONTROLS",
        controlsHint: "SPACE = Drift | R = Reset",
        debug: "DEBUG",

        // Pause
        pauseTitle: "PAUSED",
        pauseResume: "RESUME",
        pauseBack: "BACK TO MENU",
        pauseHint: "Press ESC to resume or choose an option below.",

        // Settings
        settingsTitle: "Settings",
        settingsAudio: "Audio",
        settingsVolume: "Master Volume",
        settingsMute: "Mute",
        settingsUnmute: "Unmute",
        settingsGraphics: "Graphics",
        settingsQuality: "Quality",
        settingsHigh: "High",
        settingsLow: "Low",
        settingsControls: "Controls",
        settingsKb: "WASD / Arrows — Drive | Space — Drift | Shift — Item | ESC — Pause",

        // Rematch
        rematch: "Rematch",
        rematchHostOnly: "Waiting for host...",

        // Tutorial
        howtoTitle: "How to Play",
        howtoMovement: "Drive: WASD or Arrows | Drift: Space | Item: Shift/E | Pause: ESC",
        howtoObjective: "Finish the set number of laps faster than rivals. Hit checkpoints in order.",
        howtoItems: "Items: Mushrooms (boost), Bananas/Oil (traps), Red Shell (homing), Star (invincible).",
        howtoOnline: "Online: Host starts, bots simulated by host, keep ping low for smooth play.",
        howtoClose: "Close",

        // Error Boundary
        errorTitle: "Oops! The game crashed",
        errorPhys: "Physics error (WASM panic). This can happen on extreme collisions.",
        errorContext: "WebGL context lost. Your GPU may be overloaded.",
        errorGeneric: "Something unexpected happened in the game engine.",
        errorRetry: "TRY AGAIN",
        errorReload: "RELOAD PAGE",

        // Results
        raceComplete: "RACE FINISHED!",
        finalResults: "FINAL STANDINGS",
        yourPosition: "Your Position:",
        yourTime: "Your Time:",
        backToMenu: "BACK TO MENU",

        // Suffixes logic is handled separately usually, but we can map positions if needed or just keep st/nd/rd/th for en and ° for pt
    },
    pt: {
        // Main Menu
        startEngine: "LIGAR MOTORES",
        ultimateExperience: "EXPERIÊNCIA DE CORRIDA SUPREMA",
        mode: "Modo",
        local: "LOCAL",
        online: "ONLINE",
        code: "Código",
        localRace: "CORRIDA LOCAL",
        localDesc: "Jogue contra bots no seu dispositivo",
        onlineMulti: "MULTIPLAYER ONLINE",
        onlineDesc: "Corra contra amigos do mundo todo",
        back: "Voltar",
        driverProfile: "PERFIL DO PILOTO",
        driverName: "Nome do Piloto",
        color: "COR",
        changeModel: "Mudar Modelo",
        goRace: "CORRER!",
        backModes: "Voltar para Modos",
        trackSelect: "SELEÇÃO DE PISTA",
        raceConfig: "CONFIGURAÇÃO",
        laps: "VOLTAS",
        loading: "Carregando...",

        // Multiplayer Lobby Setup
        multiplayer: "MULTIPLAYER",
        createLobby: "Criar Sala (Host)",
        orJoinExisting: "OU ENTRE EM UMA SALA",
        enterLobbyCode: "Digite o Código da Sala",
        joinLobby: "Entrar na Sala",
        cancel: "Cancelar",
        lobbyCode: "CÓDIGO DA SALA",
        copied: "Copiado!",
        copyCode: "Copiar",
        shareWhatsapp: "WhatsApp",
        connecting: "CONECTANDO...",
        players: "JOGADORES",
        changePack: "Mudar Pack",
        waitingForHost: "AGUARDANDO O HOST",
        mapLabel: "Pista",
        lapsLabel: "Voltas",
        hostConfiguring: "O HOST ESTÁ CONFIGURANDO A CORRIDA...",

        // Connection Status
        creatingLobby: "Criando Sala...",
        lobbyCreated: "Sala Criada!",
        failedCreateLobby: "Falha ao criar sala",
        connectingStatus: "Conectando...",
        connected: "Conectado!",
        disconnectedFromHost: "Desconectado do host",
        lobbyNotFound: "Sala não encontrada!",

        // HUD
        go: "VAI!",
        lap: "VOLTA",
        time: "TEMPO",
        pos: "POS",
        leaderboard: "CLASSIFICAÇÃO",
        steering: "DIREÇÃO",
        speed: "VELOCIDADE",
        controls: "CONTROLES",
        controlsHint: "ESPAÇO = Drift | R = Reiniciar",
        debug: "DEBUG",

        // Pause
        pauseTitle: "PAUSADO",
        pauseResume: "CONTINUAR",
        pauseBack: "VOLTAR AO MENU",
        pauseHint: "Aperte ESC para continuar ou escolha uma opção.",

        // Settings
        settingsTitle: "Configurações",
        settingsAudio: "Áudio",
        settingsVolume: "Volume Geral",
        settingsMute: "Silenciar",
        settingsUnmute: "Ativar som",
        settingsGraphics: "Gráficos",
        settingsQuality: "Qualidade",
        settingsHigh: "Alta",
        settingsLow: "Baixa",
        settingsControls: "Controles",
        settingsKb: "WASD / Setas — Dirigir | Espaço — Drift | Shift — Item | ESC — Pausa",

        // Rematch
        rematch: "Revanche",
        rematchHostOnly: "Aguardando o host...",

        // Tutorial
        howtoTitle: "Como Jogar",
        howtoMovement: "Dirigir: WASD ou Setas | Drift: Espaço | Item: Shift/E | Pausa: ESC",
        howtoObjective: "Complete as voltas antes dos rivais. Passe nos checkpoints na ordem.",
        howtoItems: "Itens: Cogumelo (turbo), Banana/Óleo (armadilhas), Casco Vermelho (perseguidor), Estrela (invencível).",
        howtoOnline: "Online: Host inicia, bots rodando no host, mantenha ping baixo para suavidade.",
        howtoClose: "Fechar",

        // Error Boundary
        errorTitle: "Ops! O jogo travou",
        errorPhys: "Erro de física (WASM panic). Isso pode ocorrer em colisões extremas.",
        errorContext: "WebGL perdeu o contexto. Sua GPU pode estar sobrecarregada.",
        errorGeneric: "Algo inesperado aconteceu no motor do jogo.",
        errorRetry: "TENTAR NOVAMENTE",
        errorReload: "RECARREGAR PÁGINA",

        // Results
        raceComplete: "CORRIDA FINALIZADA!",
        finalResults: "RESULTADO FINAL",
        yourPosition: "Sua Posição:",
        yourTime: "Seu Tempo:",
        backToMenu: "VOLTAR AO MENU",
    }
};

export function getPositionSuffix(pos: number, lang: Language) {
    if (lang === "pt") return "º";

    // English default
    const j = pos % 10;
    const k = pos % 100;
    if (j === 1 && k !== 11) return "st";
    if (j === 2 && k !== 12) return "nd";
    if (j === 3 && k !== 13) return "rd";
    return "th";
}
