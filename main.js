console.log("Teatro em Vídeo | Arquivo main.js carregado pelo Foundry! (v1.1.8)");

const MODULE_ID = "teatro-video";
const SOCKET_NAME = `module.${MODULE_ID}`;
const DEFAULT_AURA_COLOR = "#d8c381";

const AURA_PRESETS = [
    { color: "#d8c381", name: "Dourado (Padrão)" },
    { color: "#ff4757", name: "Carmesim" },
    { color: "#00d2ff", name: "Ciano" },
    { color: "#a855f7", name: "Roxo" },
    { color: "#2ed573", name: "Esmeralda" },
    { color: "#ffa502", name: "Âmbar" },
    { color: "#ff6b81", name: "Rosa" },
    { color: "#ffffff", name: "Branco Puro" }
];

const EMOTE_DEFINITIONS = {
    jump:   { cls: "anim-jump",   duration: 470,  icon: "fa-arrow-up",  label: "Pular",      hint: "Pulinho (Shift + Clique)" },
    shake:  { cls: "anim-shake",  duration: 460,  icon: "fa-bolt",      label: "Impacto",    hint: "Impacto / Susto (Alt + Clique)" },
    shiver: { cls: "anim-shiver", duration: 980,  icon: "fa-snowflake", label: "Tremilique", hint: "Tremilique de frio/medo (Ctrl + Clique)" },
    laugh:  { cls: "anim-laugh",  duration: 800,  icon: "fa-laugh",     label: "Risada",     hint: "Risada / Deboche" },
    sigh:   { cls: "anim-sigh",   duration: 1130, icon: "fa-wind",      label: "Suspiro",    hint: "Suspiro / Cansaço" },
    sway:   { cls: "anim-sway",   duration: 1080, icon: "fa-dizzy",     label: "Cambalear",  hint: "Tontura / Ferimento" },
    talk:   { cls: "anim-talk",   duration: 400,  icon: "fa-comment",   label: "Fala",       hint: "Pulso de fala" }
};

const ALL_ANIM_CLASSES = Object.values(EMOTE_DEFINITIONS).map(d => d.cls).join(" ");

// Estado atual de todos os atores em cena
// { [actorId]: { src, baseX, playerOffsetX, y, mirrored, side, highlighted, auraColor, zIndex } }
let activeVideos = {};

let $container;
let $blurLayer;

// Controle global de drag para evitar vazamento de listeners
let dragContext = null;
let zCounter = 1;

// -------------------------------------------------------------
// UTILITÁRIOS DE MÍDIA, CORES DE AURA E SEGURANÇA DE HTML
// -------------------------------------------------------------
function escapeHtml(str) {
    const text = String(str ?? "");
    if (foundry?.utils?.escapeHTML) return foundry.utils.escapeHTML(text);
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function normalizeHexColor(color) {
    if (!color) return DEFAULT_AURA_COLOR;
    const raw = typeof color === "object" && color.css ? String(color.css) : String(color);
    const trimmed = raw.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toLowerCase();
    if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
        return ("#" + trimmed[1] + trimmed[1] + trimmed[2] + trimmed[2] + trimmed[3] + trimmed[3]).toLowerCase();
    }
    return DEFAULT_AURA_COLOR;
}

function getCurrentUserHexColor() {
    return normalizeHexColor(game.user?.color?.css || game.user?.color || "#44aaff");
}

function getAuraCssVars(hexColor) {
    const hex = normalizeHexColor(hexColor);
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    // Mistura 55% branco + 45% cor da aura para o texto do nome sempre brilhar legível
    const textR = Math.round(255 * 0.55 + r * 0.45);
    const textG = Math.round(255 * 0.55 + g * 0.45);
    const textB = Math.round(255 * 0.55 + b * 0.45);
    return {
        "--actor-aura-color": hex,
        "--actor-aura-glow": `rgba(${r}, ${g}, ${b}, 0.52)`,
        "--actor-aura-outer": `rgba(${r}, ${g}, ${b}, 0.85)`,
        "--actor-aura-text": `rgb(${textR}, ${textG}, ${textB})`
    };
}

function getActorAuraColor(actor) {
    if (!actor) return DEFAULT_AURA_COLOR;
    const saved = actor.getFlag(MODULE_ID, "auraColor");
    return saved ? normalizeHexColor(saved) : DEFAULT_AURA_COLOR;
}

function cleanMediaExt(src) {
    if (typeof src !== "string") return "";
    return src.trim().split("?")[0].split("#")[0].toLowerCase();
}

function isVideoSrc(src) {
    const clean = cleanMediaExt(src);
    return clean.endsWith(".webm") || clean.endsWith(".mp4") || clean.endsWith(".m4v") || clean.endsWith(".ogg");
}

function isValidMediaSrc(src, hasCustomMedia = false) {
    if (typeof src !== "string" || !src.trim()) return false;
    if (hasCustomMedia) return true;
    const clean = cleanMediaExt(src);
    return /\.(webm|mp4|m4v|ogg|gif|webp|png|jpg|jpeg|avif)$/.test(clean);
}

function hasCustomTheaterMedia(actor) {
    if (!actor) return false;
    const customMedia = actor.getFlag(MODULE_ID, "customMedia");
    return typeof customMedia === "string" && customMedia.trim() !== "";
}

function getActorMediaSrc(actor) {
    if (!actor) return "";
    const customMedia = actor.getFlag(MODULE_ID, "customMedia");
    if (typeof customMedia === "string" && customMedia.trim() !== "") {
        return customMedia.trim();
    }

    const isMV = game.modules.get("multiversus-rpg")?.active || game.system?.id === "multiversus-rpg";
    const mvFlags = actor.flags?.["multiversus-rpg"];
    const halfbody = mvFlags?.halfBodyImg || mvFlags?.halfbody || mvFlags?.halfBody || mvFlags?.Halfbody;

    if (isMV && typeof halfbody === "string" && halfbody.trim() !== "") {
        return halfbody.trim();
    }

    return actor.img || "";
}

function isActorEligible(actor) {
    if (!actor) return false;
    if (!game.user.isGM && !actor.isOwner) return false;
    const src = getActorMediaSrc(actor);
    return isValidMediaSrc(src, hasCustomTheaterMedia(actor));
}

function isPlayerSpotlightAllowed() {
    return Boolean(game.settings.get(MODULE_ID, "allowPlayerSpotlight"));
}

function canUserSpotlightActor(actorId) {
    if (game.user.isGM) return true;
    const actor = game.actors.get(actorId);
    return Boolean(actor && actor.isOwner) && isPlayerSpotlightAllowed();
}

// -------------------------------------------------------------
// POSICIONAMENTO INTELIGENTE NO CENTRO E LIMITES DE TELA
// -------------------------------------------------------------
function getSafeViewportHalfWidth() {
    return Math.max(120, Math.floor(window.innerWidth / 2) - 105);
}

function getSmartCenterSpawnX() {
    const maxCenterOffset = Math.max(80, Math.min(250, Math.floor((window.innerWidth - 500) / 2)));
    const rawCandidates = [0, 62, -62, 124, -124, 186, -186, 248, -248, 31, -31, 93, -93, 155, -155, 217, -217];
    const candidates = rawCandidates.filter(x => Math.abs(x) <= maxCenterOffset);
    if (candidates.length === 0) candidates.push(0);

    const occupiedPositions = Object.values(activeVideos).map(v => (v.baseX || 0) + (v.playerOffsetX || 0));

    for (const candidate of candidates) {
        const isOccupied = occupiedPositions.some(pos => Math.abs(pos - candidate) < 42);
        if (!isOccupied) {
            return candidate;
        }
    }

    let bestCandidate = 0;
    let lowestScore = Infinity;
    for (const candidate of candidates) {
        let crowding = 0;
        for (const pos of occupiedPositions) {
            const dist = Math.abs(pos - candidate);
            if (dist < 70) crowding += (70 - dist);
        }
        const score = crowding + Math.abs(candidate) * 0.05;
        if (score < lowestScore) {
            lowestScore = score;
            bestCandidate = candidate;
        }
    }

    return bestCandidate;
}

function createActorStageState(actor, spawnX) {
    const src = getActorMediaSrc(actor);
    const baseX = typeof spawnX === "number" ? spawnX : getSmartCenterSpawnX();
    const isRightSide = baseX > 15;
    zCounter += 1;

    return {
        src: src,
        baseX: baseX,
        playerOffsetX: 0,
        y: 0,
        mirrored: isRightSide,
        side: isRightSide ? "right" : "left",
        highlighted: false,
        auraColor: getActorAuraColor(actor),
        zIndex: zCounter
    };
}

function centerAllActiveActors() {
    const ids = Object.keys(activeVideos);
    if (ids.length === 0) return;

    ids.sort((a, b) => {
        const xA = (activeVideos[a].baseX || 0) + (activeVideos[a].playerOffsetX || 0);
        const xB = (activeVideos[b].baseX || 0) + (activeVideos[b].playerOffsetX || 0);
        return xA - xB;
    });

    const n = ids.length;
    if (n === 1) {
        activeVideos[ids[0]].baseX = 0;
        activeVideos[ids[0]].playerOffsetX = 0;
    } else {
        const maxSpan = Math.min(
            (n - 1) * 75,
            Math.max(120, Math.min(340, Math.floor((window.innerWidth - 480) / 2)))
        );
        const step = (maxSpan * 2) / (n - 1);
        ids.forEach((id, idx) => {
            const newX = Math.round(-maxSpan + idx * step);
            activeVideos[id].baseX = newX;
            activeVideos[id].playerOffsetX = 0;
            activeVideos[id].mirrored = newX > 20;
            activeVideos[id].side = newX > 20 ? "right" : "left";
        });
    }

    updateVideoDOM({ smoothMove: true });
    emitSocketData({ action: "sync", state: activeVideos, smoothMove: true });
}

// -------------------------------------------------------------
// INICIALIZAÇÃO E CONFIGURAÇÕES
// -------------------------------------------------------------
Hooks.once("init", () => {
    game.settings.register(MODULE_ID, "actorScale", {
        name: "Escala dos Personagens",
        hint: "Define a altura base dos personagens no Teatro em Vídeo.",
        scope: "world",
        config: false,
        type: Number,
        default: 48,
        onChange: value => updateGlobalScale(value)
    });

    game.settings.register(MODULE_ID, "maxActors", {
        name: "Máximo de Personagens na Cena",
        hint: "Define o limite máximo de personagens que o Mestre pode colocar no Teatro simultaneamente (Recomendado: 5 a 10).",
        scope: "world",
        config: true,
        type: Number,
        default: 10
    });

    game.settings.register(MODULE_ID, "sceneBlurIntensity", {
        name: "Intensidade do Blur de Cena (%)",
        hint: "Define a intensidade do desfoque no fundo da cena quando ativado pelo Mestre no painel (Padrão: 50%).",
        scope: "world",
        config: true,
        type: Number,
        range: {
            min: 10,
            max: 100,
            step: 5
        },
        default: 50,
        onChange: () => applySceneBlur()
    });

    game.settings.register(MODULE_ID, "allowPlayerSpotlight", {
        name: "Permitir Destaque pelos Jogadores",
        hint: "Permite que os jogadores ativem/desativem o destaque de fala no próprio personagem sem depender do Mestre (também controlável direto no Painel do Teatro).",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
        onChange: value => applyPlayerSpotlightPermission(value)
    });

    game.settings.register(MODULE_ID, "chatTalkPulse", {
        name: "Pulso ao Falar no Chat",
        hint: "Quando ativado, personagens em cena dão um leve pulso quando enviam uma mensagem no chat.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID, "sceneBlurEnabled", {
        scope: "world",
        config: false,
        type: Boolean,
        default: false,
        onChange: value => applySceneBlur(value)
    });

    game.settings.register(MODULE_ID, "activeVideosState", {
        scope: "world",
        config: false,
        type: Object,
        default: {},
        onChange: newState => {
            if (!game.user.isGM && !dragContext) {
                activeVideos = foundry.utils.deepClone(newState || {});
                updateVideoDOM();
            }
        }
    });
});

function saveState() {
    if (!game.user.isGM) return;
    if (ui.teatroSaveTimeout) clearTimeout(ui.teatroSaveTimeout);
    ui.teatroSaveTimeout = setTimeout(() => {
        game.settings.set(MODULE_ID, "activeVideosState", foundry.utils.deepClone(activeVideos));
    }, 600);
}

function updateGlobalScale(value) {
    document.documentElement.style.setProperty("--teatro-scale", `${value}vh`);
}

function applySceneBlur(forceEnabled) {
    const enabled = typeof forceEnabled === "boolean"
        ? forceEnabled
        : Boolean(game.settings.get(MODULE_ID, "sceneBlurEnabled"));
    const intensity = Number(game.settings.get(MODULE_ID, "sceneBlurIntensity") ?? 50);
    const blurPx = Math.round((intensity / 50) * 12 * 10) / 10;

    document.documentElement.style.setProperty("--teatro-blur-px", `${blurPx}px`);

    if ($blurLayer && $blurLayer.length > 0) {
        $blurLayer.toggleClass("active", enabled);
    }

    if (ui.teatroControlPanel && ui.teatroControlPanel.rendered) {
        ui.teatroControlPanel.syncBlurState(enabled, intensity);
    }
}

function applyPlayerSpotlightPermission(forceAllowed) {
    const allowed = typeof forceAllowed === "boolean" ? forceAllowed : isPlayerSpotlightAllowed();

    // Mostra/oculta o botão de Destaque na barra rápida dos jogadores em tempo real
    if ($container && !game.user.isGM) {
        $container.find(".teatro-qbtn-spotlight").toggle(allowed);
    }

    if (ui.teatroControlPanel && ui.teatroControlPanel.rendered) {
        ui.teatroControlPanel.syncPlayerSpotlightPermState(allowed);
    }
}

Hooks.once("ready", () => {
    console.log("Teatro em Vídeo | Inicializando módulo (Multi-Actor v1.1.8)");

    activeVideos = foundry.utils.deepClone(game.settings.get(MODULE_ID, "activeVideosState") || {});

    let reconciledChange = false;
    for (const [id, state] of Object.entries(activeVideos)) {
        const actor = game.actors.get(id);
        if (actor) {
            const latestSrc = getActorMediaSrc(actor);
            if (isValidMediaSrc(latestSrc, hasCustomTheaterMedia(actor)) && state.src !== latestSrc) {
                state.src = latestSrc;
                reconciledChange = true;
            }
            const latestAura = getActorAuraColor(actor);
            if (!state.auraColor || state.auraColor !== latestAura) {
                state.auraColor = latestAura;
                reconciledChange = true;
            }
        } else if (!state.auraColor) {
            state.auraColor = DEFAULT_AURA_COLOR;
        }
        if (typeof state.zIndex === "number" && state.zIndex > zCounter) {
            zCounter = state.zIndex;
        }
    }

    updateGlobalScale(game.settings.get(MODULE_ID, "actorScale"));

    $blurLayer = $(`<div id="teatro-backdrop-blur"></div>`);
    $container = $(`<div id="teatro-video-container"></div>`);
    $("body").append($blurLayer).append($container);

    applySceneBlur();
    updateVideoDOM();
    applyPlayerSpotlightPermission();

    if (reconciledChange && game.user.isGM) {
        saveState();
    }

    initGlobalStageListeners();

    game.socket.on(SOCKET_NAME, data => {
        handleSocketAction(data);
    });
});

// -------------------------------------------------------------
// OBSERVAÇÃO AUTOMÁTICA DE MUDANÇAS NAS FICHAS E PASTAS
// -------------------------------------------------------------
Hooks.on("updateActor", (actor, changes) => {
    if (!$container) return;

    const latestSrc = getActorMediaSrc(actor);
    const latestAura = getActorAuraColor(actor);
    const id = actor.id;

    // 1. Se o personagem está em cena, atualiza mídia, cor da aura ou nome em tempo real!
    if (activeVideos[id]) {
        let stageUpdated = false;
        if (isValidMediaSrc(latestSrc, hasCustomTheaterMedia(actor)) && activeVideos[id].src !== latestSrc) {
            activeVideos[id].src = latestSrc;
            stageUpdated = true;
        }

        if (activeVideos[id].auraColor !== latestAura) {
            activeVideos[id].auraColor = latestAura;
            stageUpdated = true;
        }

        if (stageUpdated || changes.name !== undefined) {
            updateVideoDOM();
            if (game.user.isGM) {
                saveState();
                if (stageUpdated) {
                    game.socket.emit(SOCKET_NAME, {
                        action: "update",
                        id: id,
                        state: activeVideos[id]
                    });
                }
            }
        }
    }

    // 2. Se o Painel de Controle estiver aberto, atualiza sem resetar scroll/pastas!
    if (ui.teatroControlPanel && ui.teatroControlPanel.rendered) {
        ui.teatroControlPanel.handleActorUpdated(actor, changes);
    }
});

Hooks.on("createActor", () => {
    if (ui.teatroControlPanel?.rendered) ui.teatroControlPanel.refreshPreservingState();
});

Hooks.on("deleteActor", actor => {
    if (activeVideos[actor.id]) {
        delete activeVideos[actor.id];
        updateVideoDOM();
        if (game.user.isGM) saveState();
    }
    if (ui.teatroControlPanel?.rendered) ui.teatroControlPanel.refreshPreservingState();
});

Hooks.on("createFolder", folder => {
    if (folder.type === "Actor" && ui.teatroControlPanel?.rendered) {
        ui.teatroControlPanel.refreshPreservingState();
    }
});

Hooks.on("updateFolder", folder => {
    if (folder.type === "Actor" && ui.teatroControlPanel?.rendered) {
        ui.teatroControlPanel.refreshPreservingState();
    }
});

Hooks.on("deleteFolder", folder => {
    if (folder.type === "Actor" && ui.teatroControlPanel?.rendered) {
        ui.teatroControlPanel.refreshPreservingState();
    }
});

Hooks.on("createChatMessage", message => {
    if (!$container) return;
    if (!game.settings.get(MODULE_ID, "chatTalkPulse")) return;
    const actorId = message.speaker?.actor;
    if (actorId && activeVideos[actorId]) {
        triggerActorAnimation(actorId, "talk");
    }
});

// -------------------------------------------------------------
// SOCKETS
// -------------------------------------------------------------
function emitSocketData(data, shouldSave = true) {
    game.socket.emit(SOCKET_NAME, data);
    if (shouldSave) saveState();
}

function handleSocketAction(data) {
    if (!data || !data.action) return;

    if (data.action === "add" || data.action === "update") {
        activeVideos[data.id] = data.state;
        if (data.state?.zIndex && data.state.zIndex > zCounter) zCounter = data.state.zIndex;
        updateVideoDOM();
    } else if (data.action === "remove") {
        delete activeVideos[data.id];
        updateVideoDOM();
    } else if (data.action === "removeAll") {
        activeVideos = {};
        updateVideoDOM();
    } else if (data.action === "sync") {
        activeVideos = data.state || {};
        updateVideoDOM({ smoothMove: Boolean(data.smoothMove) });
    } else if (data.action === "drag") {
        if (activeVideos[data.id]) {
            activeVideos[data.id].baseX = data.baseX;
            activeVideos[data.id].playerOffsetX = data.playerOffsetX;
            if (typeof data.zIndex === "number") {
                activeVideos[data.id].zIndex = data.zIndex;
                if (data.zIndex > zCounter) zCounter = data.zIndex;
            }
            updateVideoTransform(data.id);
        }
    } else if (data.action === "mirror") {
        if (activeVideos[data.id]) {
            activeVideos[data.id].mirrored = data.mirrored;
            updateVideoTransform(data.id);
        }
    } else if (data.action === "spotlight") {
        if (activeVideos[data.id]) {
            activeVideos[data.id].highlighted = Boolean(data.highlighted);
            if (data.auraColor) {
                activeVideos[data.id].auraColor = normalizeHexColor(data.auraColor);
            }
            if (typeof data.zIndex === "number") {
                activeVideos[data.id].zIndex = data.zIndex;
                if (data.zIndex > zCounter) zCounter = data.zIndex;
            }
            applyWrapperAuraVars(data.id);
            updateSpotlightClasses();
            updateVideoTransform(data.id);
            if (ui.teatroControlPanel?.rendered) ui.teatroControlPanel.syncActiveStates();
        }
    } else if (data.action === "auraColor") {
        if (activeVideos[data.id]) {
            activeVideos[data.id].auraColor = normalizeHexColor(data.auraColor);
            applyWrapperAuraVars(data.id);
            if (ui.teatroControlPanel?.rendered) ui.teatroControlPanel.syncActiveStates();
        }
    } else if (data.action === "clearSpotlight") {
        Object.values(activeVideos).forEach(s => { s.highlighted = false; });
        updateSpotlightClasses();
        Object.keys(activeVideos).forEach(id => updateVideoTransform(id));
        if (ui.teatroControlPanel?.rendered) ui.teatroControlPanel.syncActiveStates();
    } else if (data.action === "emote") {
        triggerActorAnimation(data.id, data.emote);
        return;
    } else if (data.action === "blur") {
        applySceneBlur(Boolean(data.enabled));
        return;
    } else if (data.action === "playerSpotlightPerm") {
        applyPlayerSpotlightPermission(Boolean(data.enabled));
        return;
    }

    saveState();
}

// -------------------------------------------------------------
// RENDERIZAÇÃO DE VÍDEOS, IMAGENS E BARRA INTERATIVA NA CENA
// -------------------------------------------------------------
function buildStageMediaElementHTML(src) {
    const safeSrc = escapeHtml(src);
    if (isVideoSrc(src)) {
        return `<video class="teatro-media-player" src="${safeSrc}" autoplay loop muted playsinline></video>`;
    }
    return `<img class="teatro-media-player" src="${safeSrc}" alt="" />`;
}

function buildQuickbarHTML(id, state) {
    const showSpotlightBtn = canUserSpotlightActor(id);
    const auraHex = normalizeHexColor(state.auraColor || DEFAULT_AURA_COLOR);
    const userHex = getCurrentUserHexColor();

    let swatchesHTML = AURA_PRESETS.map(p =>
        `<button type="button" class="teatro-swatch" data-swatch-color="${p.color}" style="background:${p.color};" title="${escapeHtml(p.name)}"></button>`
    ).join("");

    swatchesHTML += `<button type="button" class="teatro-swatch" data-swatch-color="${escapeHtml(userHex)}" style="background:${escapeHtml(userHex)};" title="Cor do seu Usuário"></button>`;
    swatchesHTML += `
        <label class="teatro-custom-color-wrap" title="Escolher qualquer cor personalizada">
            <input type="color" class="teatro-aura-picker" value="${escapeHtml(auraHex)}">
        </label>
    `;

    const emoteKeys = ["jump", "shake", "shiver", "laugh", "sigh", "sway"];
    const emotesHTML = emoteKeys.map(key => {
        const def = EMOTE_DEFINITIONS[key];
        return `
            <button type="button" class="teatro-emote-item" data-emote="${key}" title="${escapeHtml(def.hint)}">
                <i class="fas ${def.icon}"></i>
                <span>${escapeHtml(def.label)}</span>
            </button>
        `;
    }).join("");

    const removeBtnHTML = game.user.isGM
        ? `<button type="button" class="teatro-qbtn teatro-qbtn-remove" data-qaction="remove" title="Remover da cena"><i class="fas fa-times"></i></button>`
        : "";

    return `
        <div class="teatro-actor-quickbar">
            <button type="button" class="teatro-qbtn teatro-qbtn-spotlight ${state.highlighted ? "active" : ""}" data-qaction="spotlight" style="${showSpotlightBtn ? "" : "display: none;"}" title="Destacar fala (Duplo Clique)">
                <i class="fas fa-star"></i>
            </button>
            <button type="button" class="teatro-qbtn teatro-qbtn-aura" data-qaction="toggle-palette" title="Cor da Aura de Destaque">
                <i class="fas fa-palette"></i>
                <span class="teatro-aura-dot"></span>
            </button>
            <button type="button" class="teatro-qbtn" data-qaction="mirror" title="Espelhar (Botão Direito)">
                <i class="fas fa-arrows-alt-h"></i>
            </button>
            <button type="button" class="teatro-qbtn teatro-qbtn-emotes" data-qaction="toggle-emotes" title="Animações e Reações">
                <i class="fas fa-magic"></i>
            </button>
            ${removeBtnHTML}

            <div class="teatro-popover teatro-palette-popover">
                <div class="teatro-popover-title">Cor da Aura</div>
                <div class="teatro-palette-swatches">
                    ${swatchesHTML}
                </div>
            </div>

            <div class="teatro-popover teatro-emote-popover">
                <div class="teatro-popover-title">Expressões</div>
                <div class="teatro-emote-grid">
                    ${emotesHTML}
                </div>
            </div>
        </div>
    `;
}

function applyWrapperAuraVars(id) {
    if (!$container || !activeVideos[id]) return;
    const $wrapper = $container.find(`.teatro-actor-wrapper[data-id="${id}"]`);
    if ($wrapper.length === 0) return;

    const hex = normalizeHexColor(activeVideos[id].auraColor || DEFAULT_AURA_COLOR);
    const vars = getAuraCssVars(hex);
    for (const [prop, val] of Object.entries(vars)) {
        $wrapper[0].style.setProperty(prop, val);
    }

    const $picker = $wrapper.find(".teatro-aura-picker");
    if ($picker.length > 0 && $picker.val() !== hex) {
        $picker.val(hex);
    }
}

function playWrapperVideoIfNeeded($wrapper, id) {
    const videoEl = $wrapper.find("video")[0];
    if (videoEl) {
        const playPromise = videoEl.play();
        if (playPromise !== undefined) {
            playPromise.catch(error => console.warn(`Teatro em Vídeo | Auto-play interceptado para ${id}:`, error));
        }
    }
}

function updateVideoDOM(options = {}) {
    if (!$container) return;
    const currentIds = Object.keys(activeVideos);

    $container.find(".teatro-actor-wrapper").each(function() {
        const id = String($(this).attr("data-id"));
        if (!currentIds.includes(id)) {
            $(this).remove();
        }
    });

    currentIds.forEach(id => {
        const state = activeVideos[id];
        if (!state || !state.src) return;

        const actor = game.actors.get(id);
        const name = actor ? actor.name : "Desconhecido";
        if (!state.auraColor) {
            state.auraColor = actor ? getActorAuraColor(actor) : DEFAULT_AURA_COLOR;
        }
        const canInteract = game.user.isGM || Boolean(actor && actor.isOwner);

        let $wrapper = $container.find(`.teatro-actor-wrapper[data-id="${id}"]`);

        if ($wrapper.length === 0) {
            const mediaHTML = buildStageMediaElementHTML(state.src);
            const quickbarHTML = canInteract ? buildQuickbarHTML(id, state) : "";

            $wrapper = $(`
                <div class="teatro-actor-wrapper" data-id="${escapeHtml(id)}">
                    <div class="teatro-media-anim">
                        ${mediaHTML}
                    </div>
                    ${quickbarHTML}
                    <div class="teatro-actor-nameplate">${escapeHtml(name)}</div>
                </div>
            `);

            $wrapper.data("rendered-src", state.src);
            $container.append($wrapper);
            applyWrapperAuraVars(id);
            playWrapperVideoIfNeeded($wrapper, id);

            if (canInteract) {
                attachWrapperEvents($wrapper, id);
            } else {
                $wrapper.css("pointer-events", "none");
            }
        } else {
            const prevSrc = $wrapper.data("rendered-src");
            if (prevSrc !== state.src) {
                const $animBox = $wrapper.find(".teatro-media-anim");
                $animBox.html(buildStageMediaElementHTML(state.src));
                $wrapper.data("rendered-src", state.src);
                playWrapperVideoIfNeeded($wrapper, id);
            }

            const $nameplate = $wrapper.find(".teatro-actor-nameplate");
            if ($nameplate.text() !== name) {
                $nameplate.text(name);
            }

            applyWrapperAuraVars(id);
        }

        if (options.smoothMove) {
            $wrapper.addClass("smooth-move");
            setTimeout(() => $wrapper.removeClass("smooth-move"), 380);
        }

        updateVideoTransform(id);
    });

    updateSpotlightClasses();

    if (ui.teatroControlPanel && ui.teatroControlPanel.rendered) {
        ui.teatroControlPanel.syncActiveStates();
    }
}

function updateSpotlightClasses() {
    if (!$container) return;
    const anyHighlighted = Object.values(activeVideos).some(s => Boolean(s.highlighted));
    $container.toggleClass("has-spotlight", anyHighlighted);

    $container.find(".teatro-actor-wrapper").each(function() {
        const id = String($(this).attr("data-id"));
        const isLit = Boolean(activeVideos[id]?.highlighted);
        $(this).toggleClass("is-spotlight", isLit);
        $(this).find(".teatro-qbtn-spotlight").toggleClass("active", isLit);
    });
}

function updateVideoTransform(id) {
    const state = activeVideos[id];
    if (!state || !$container) return;
    const $v = $container.find(`.teatro-actor-wrapper[data-id="${id}"]`);
    if ($v.length > 0) {
        const safeLimit = getSafeViewportHalfWidth();
        const rawTotalX = (state.baseX || 0) + (state.playerOffsetX || 0);
        const clampedX = Math.max(-safeLimit, Math.min(safeLimit, rawTotalX));

        const baseZ = state.zIndex || 1;
        const effectiveZ = state.highlighted ? 500 + baseZ : baseZ;

        $v.css({
            transform: `translate(calc(-50% + ${clampedX}px), 0px)`,
            zIndex: effectiveZ
        });

        const dirX = state.mirrored ? -1 : 1;
        const highlightScale = state.highlighted ? 1.05 : 1;
        $v.find(".teatro-media-player").css(
            "transform",
            `scale(${dirX * highlightScale}, ${highlightScale})`
        );
    }
}

function triggerActorAnimation(id, emote) {
    if (!$container) return;
    const $anim = $container.find(`.teatro-actor-wrapper[data-id="${id}"] .teatro-media-anim`);
    if ($anim.length === 0) return;

    const def = EMOTE_DEFINITIONS[emote] || EMOTE_DEFINITIONS.jump;
    const prevTimer = $anim.data("animTimer");
    if (prevTimer) clearTimeout(prevTimer);

    $anim.removeClass(ALL_ANIM_CLASSES);
    void $anim[0].offsetWidth;
    $anim.addClass(def.cls);

    const nextTimer = setTimeout(() => {
        $anim.removeClass(def.cls);
        $anim.removeData("animTimer");
    }, def.duration);

    $anim.data("animTimer", nextTimer);
}

// -------------------------------------------------------------
// INTERAÇÕES NA CENA (DRAG, CLIQUES, AURA E EXPRESSÕES)
// -------------------------------------------------------------
function closeAllStagePopovers() {
    if (!$container) return;
    $container.find(".teatro-popover.open").removeClass("open");
    $container.find(".teatro-actor-quickbar.has-open-popover").removeClass("has-open-popover");
}

function toggleActorMirror(id) {
    const state = activeVideos[id];
    if (!state) return;
    state.mirrored = !state.mirrored;
    updateVideoTransform(id);
    emitSocketData({ action: "mirror", id: id, mirrored: state.mirrored });
}

function toggleActorSpotlight(id) {
    const state = activeVideos[id];
    if (!state) return;

    if (!canUserSpotlightActor(id)) {
        ui.notifications.warn("O Mestre restringiu o uso de Destaque de Fala apenas ao Mestre no momento.");
        return;
    }

    state.highlighted = !state.highlighted;
    if (state.highlighted) {
        zCounter += 1;
        state.zIndex = zCounter;
    }
    applyWrapperAuraVars(id);
    updateSpotlightClasses();
    updateVideoTransform(id);
    if (ui.teatroControlPanel?.rendered) ui.teatroControlPanel.syncActiveStates();
    emitSocketData({
        action: "spotlight",
        id: id,
        highlighted: state.highlighted,
        auraColor: state.auraColor,
        zIndex: state.zIndex
    });
}

let auraEmitThrottle = 0;
function updateActorAuraColorLive(id, rawColor, persistToActor = false) {
    const hex = normalizeHexColor(rawColor);
    const actor = game.actors.get(id);

    if (activeVideos[id]) {
        activeVideos[id].auraColor = hex;
        applyWrapperAuraVars(id);
        if (ui.teatroControlPanel?.rendered) ui.teatroControlPanel.syncActiveStates();

        const now = Date.now();
        if (persistToActor || now - auraEmitThrottle >= 60) {
            auraEmitThrottle = now;
            emitSocketData({ action: "auraColor", id: id, auraColor: hex }, persistToActor);
        }
    }

    if (persistToActor && actor && (game.user.isGM || actor.isOwner)) {
        actor.setFlag(MODULE_ID, "auraColor", hex);
    }
}

function triggerSyncedEmote(id, emote) {
    if (!activeVideos[id]) return;
    triggerActorAnimation(id, emote);
    emitSocketData({ action: "emote", id: id, emote: emote }, false);
}

function removeActorFromStage(id) {
    if (!game.user.isGM) return;
    if (!activeVideos[id]) return;
    delete activeVideos[id];
    updateVideoDOM();
    emitSocketData({ action: "remove", id: id });
}

function attachWrapperEvents($wrapper, id) {
    const $quickbar = $wrapper.find(".teatro-actor-quickbar");
    const $palettePop = $wrapper.find(".teatro-palette-popover");
    const $emotePop = $wrapper.find(".teatro-emote-popover");

    // Impede que interações na quickbar iniciem drag ou duplo clique no personagem
    $wrapper.on("mousedown dblclick", ".teatro-actor-quickbar", e => {
        e.stopPropagation();
    });

    $wrapper.on("click", ".teatro-qbtn", e => {
        e.preventDefault();
        e.stopPropagation();
        const qaction = $(e.currentTarget).attr("data-qaction");

        if (qaction === "spotlight") {
            toggleActorSpotlight(id);
        } else if (qaction === "mirror") {
            toggleActorMirror(id);
        } else if (qaction === "toggle-palette") {
            const willOpen = !$palettePop.hasClass("open");
            closeAllStagePopovers();
            $palettePop.toggleClass("open", willOpen);
            $quickbar.toggleClass("has-open-popover", willOpen);
        } else if (qaction === "toggle-emotes") {
            const willOpen = !$emotePop.hasClass("open");
            closeAllStagePopovers();
            $emotePop.toggleClass("open", willOpen);
            $quickbar.toggleClass("has-open-popover", willOpen);
        } else if (qaction === "remove") {
            removeActorFromStage(id);
        }
    });

    // Clique em cor predefinida da paleta
    $wrapper.on("click", ".teatro-swatch", e => {
        e.preventDefault();
        e.stopPropagation();
        const chosen = $(e.currentTarget).attr("data-swatch-color");
        updateActorAuraColorLive(id, chosen, true);
        closeAllStagePopovers();
    });

    // Seletor livre de cor da aura (<input type="color">)
    $wrapper.on("input", ".teatro-aura-picker", e => {
        e.stopPropagation();
        updateActorAuraColorLive(id, e.currentTarget.value, false);
    });

    $wrapper.on("change", ".teatro-aura-picker", e => {
        e.stopPropagation();
        updateActorAuraColorLive(id, e.currentTarget.value, true);
        closeAllStagePopovers();
    });

    // Clique em uma das 6 expressões
    $wrapper.on("click", ".teatro-emote-item", e => {
        e.preventDefault();
        e.stopPropagation();
        const emote = $(e.currentTarget).attr("data-emote");
        triggerSyncedEmote(id, emote);
        closeAllStagePopovers();
    });

    // Drag com botão esquerdo e atalhos rápidos Shift / Alt / Ctrl + Clique
    $wrapper.on("mousedown", e => {
        if (e.button !== 0) return;
        const state = activeVideos[id];
        if (!state) return;

        closeAllStagePopovers();

        if (e.shiftKey) {
            e.preventDefault();
            triggerSyncedEmote(id, "jump");
            return;
        }
        if (e.altKey) {
            e.preventDefault();
            triggerSyncedEmote(id, "shake");
            return;
        }
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            triggerSyncedEmote(id, "shiver");
            return;
        }

        zCounter += 1;
        state.zIndex = zCounter;
        updateVideoTransform(id);

        const currentOffset = game.user.isGM ? (state.baseX || 0) : (state.playerOffsetX || 0);
        dragContext = {
            id: id,
            startX: e.clientX - currentOffset,
            initialClientX: e.clientX,
            moved: false,
            lastEmitTime: 0
        };
        $wrapper.css("cursor", "grabbing");
    });

    // Duplo clique: Destacar quem está falando
    $wrapper.on("dblclick", e => {
        if ($(e.target).closest(".teatro-actor-quickbar").length > 0) return;
        e.preventDefault();
        e.stopPropagation();
        toggleActorSpotlight(id);
    });

    // Botão direito: Espelhar
    $wrapper.on("contextmenu", e => {
        e.preventDefault();
        e.stopPropagation();
        toggleActorMirror(id);
    });
}

function initGlobalStageListeners() {
    $(window).on("mousedown.teatroPopovers", e => {
        if ($(e.target).closest(".teatro-actor-quickbar").length === 0) {
            closeAllStagePopovers();
        }
    });

    $(window).on("mousemove.teatroStage", e => {
        if (!dragContext) return;
        const { id, startX, initialClientX } = dragContext;
        const state = activeVideos[id];
        if (!state) {
            dragContext = null;
            return;
        }

        if (Math.abs(e.clientX - initialClientX) > 3) {
            dragContext.moved = true;
        }

        let targetX = e.clientX - startX;

        if (game.user.isGM) {
            const safeLimit = getSafeViewportHalfWidth();
            targetX = Math.max(-safeLimit, Math.min(safeLimit, targetX));
            state.baseX = Math.round(targetX);
        } else {
            targetX = Math.max(-150, Math.min(150, targetX));
            state.playerOffsetX = Math.round(targetX);
        }

        updateVideoTransform(id);

        const now = Date.now();
        if (now - dragContext.lastEmitTime >= 35) {
            dragContext.lastEmitTime = now;
            game.socket.emit(SOCKET_NAME, {
                action: "drag",
                id: id,
                baseX: state.baseX,
                playerOffsetX: state.playerOffsetX,
                zIndex: state.zIndex
            });
        }
    });

    $(window).on("mouseup.teatroStage", e => {
        if (e.button !== 0 || !dragContext) return;
        const { id } = dragContext;
        const state = activeVideos[id];

        if ($container) {
            $container.find(`.teatro-actor-wrapper[data-id="${id}"]`).css("cursor", "grab");
        }

        if (state) {
            emitSocketData({
                action: "drag",
                id: id,
                baseX: state.baseX,
                playerOffsetX: state.playerOffsetX,
                zIndex: state.zIndex
            });
        }

        dragContext = null;
    });

    $(window).on("resize.teatroStage", () => {
        Object.keys(activeVideos).forEach(id => updateVideoTransform(id));
    });
}

// -------------------------------------------------------------
// BOTÃO FLUTUANTE INDEPENDENTE (Apenas Mestre)
// -------------------------------------------------------------
Hooks.once("ready", () => {
    if (!game.user.isGM) return;

    const $btn = $(`
        <div id="teatro-independent-btn" title="Abrir Painel do Teatro">
            <i class="fas fa-theater-masks"></i>
        </div>
    `);

    $("body").append($btn);

    try {
        const savedPos = JSON.parse(localStorage.getItem(`${MODULE_ID}.btnPos`) || "null");
        if (savedPos && typeof savedPos.left === "number" && typeof savedPos.top === "number") {
            const clampedLeft = Math.max(0, Math.min(window.innerWidth - 44, savedPos.left));
            const clampedTop = Math.max(0, Math.min(window.innerHeight - 44, savedPos.top));
            $btn.css({ left: `${clampedLeft}px`, top: `${clampedTop}px`, bottom: "auto", right: "auto" });
        }
    } catch (_) { /* ignore */ }

    let isDraggingBtn = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let initialLeft = 0;
    let initialTop = 0;

    $btn.on("mousedown", e => {
        if (e.button === 0) {
            isDraggingBtn = true;
            dragStartX = e.clientX;
            dragStartY = e.clientY;
            const offset = $btn.offset();
            initialLeft = offset.left;
            initialTop = offset.top;
            $btn.css({ transition: "none", cursor: "grabbing" });
            e.preventDefault();
        }
    });

    $(window).on("mousemove.teatroBtn", e => {
        if (!isDraggingBtn) return;
        let newLeft = initialLeft + (e.clientX - dragStartX);
        let newTop = initialTop + (e.clientY - dragStartY);

        const maxLeft = window.innerWidth - $btn.outerWidth();
        const maxTop = window.innerHeight - $btn.outerHeight();

        newLeft = Math.max(0, Math.min(maxLeft, newLeft));
        newTop = Math.max(0, Math.min(maxTop, newTop));

        $btn.css({ left: `${newLeft}px`, top: `${newTop}px`, bottom: "auto", right: "auto" });
    });

    $(window).on("mouseup.teatroBtn", e => {
        if (e.button === 0 && isDraggingBtn) {
            isDraggingBtn = false;
            $btn.css({ transition: "", cursor: "pointer" });
            const offset = $btn.offset();
            try {
                localStorage.setItem(`${MODULE_ID}.btnPos`, JSON.stringify({ left: offset.left, top: offset.top }));
            } catch (_) { /* ignore */ }
        }
    });

    $btn.on("click", e => {
        if (Math.abs(e.clientX - dragStartX) > 3 || Math.abs(e.clientY - dragStartY) > 3) return;
        if (!ui.teatroControlPanel) {
            ui.teatroControlPanel = new TeatroControlPanel();
        }
        if (ui.teatroControlPanel.rendered) {
            ui.teatroControlPanel.bringToTop();
        } else {
            ui.teatroControlPanel.render(true);
        }
    });
});

// -------------------------------------------------------------
// JANELA DO PAINEL DE CONTROLE (APPLICATION)
// -------------------------------------------------------------
class TeatroControlPanel extends Application {
    constructor(options = {}) {
        super(options);
        this.searchQuery = "";
        this._savedScrollTop = 0;
        this.collapsedFolders = this._loadCollapsedFolders();
    }

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: "teatro-control-panel",
            title: "Painel do Teatro",
            template: "modules/teatro-video/templates/control-panel.html",
            width: 365,
            height: 550,
            resizable: true,
            classes: ["teatro-app"]
        });
    }

    _getStorageKey() {
        const worldId = game.world?.id || "default";
        return `${MODULE_ID}.collapsedFolders.${worldId}`;
    }

    _loadCollapsedFolders() {
        try {
            const raw = localStorage.getItem(this._getStorageKey());
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) return new Set(parsed.map(String));
            }
        } catch (_) { /* ignore */ }
        return new Set();
    }

    _saveCollapsedFolders() {
        try {
            localStorage.setItem(this._getStorageKey(), JSON.stringify(Array.from(this.collapsedFolders)));
        } catch (_) { /* ignore */ }
    }

    getDirectAccessibleActorsForFolder(folderId) {
        let rawActors;
        if (folderId === "root") {
            rawActors = game.actors.filter(a => !a.folder);
        } else {
            rawActors = game.actors.filter(a => (a.folder?.id || a.folder) === folderId);
        }

        return rawActors.filter(a => isActorEligible(a)).map(a => {
            const mediaSrc = getActorMediaSrc(a);
            return {
                id: a.id,
                name: a.name,
                mediaSrc: mediaSrc,
                isVideo: isVideoSrc(mediaSrc),
                active: Boolean(activeVideos[a.id])
            };
        });
    }

    _buildActorCardHTML(actor) {
        const activeClass = actor.active ? "active" : "";
        const safeName = escapeHtml(actor.name);
        const safeSrc = escapeHtml(actor.mediaSrc);
        const thumbHTML = actor.isVideo
            ? `<video class="teatro-actor-img" src="${safeSrc}" muted loop playsinline preload="metadata"></video>
               <span class="teatro-actor-badge" title="Mídia em Vídeo"><i class="fas fa-video"></i></span>`
            : `<img class="teatro-actor-img" src="${safeSrc}" alt="${safeName}" loading="lazy" />`;

        return `
            <div class="teatro-actor-item ${activeClass}" data-actor-id="${escapeHtml(actor.id)}" data-media-src="${safeSrc}" title="${safeName}">
                <div class="teatro-actor-thumb-wrap">
                    ${thumbHTML}
                </div>
                <span class="teatro-actor-name">${safeName}</span>
            </div>
        `;
    }

    _buildFolderBlockHTML(folder, isUnassigned = false) {
        const getCount = f => f.actors.length + f.children.reduce((acc, c) => acc + getCount(c), 0);
        const totalActors = getCount(folder);
        const directCount = folder.actors.length;
        const isCollapsed = this.collapsedFolders.has(String(folder.id));
        const safeFolderName = escapeHtml(folder.name);
        const folderIcon = isUnassigned ? "fa-inbox" : "fa-folder";

        let addFolderBtnHTML = "";
        if (game.user.isGM && directCount > 0) {
            const allActive = folder.actors.every(a => Boolean(activeVideos[a.id]));
            const btnClass = allActive ? "teatro-folder-add-btn all-active" : "teatro-folder-add-btn";
            const btnIcon = allActive ? "fa-check" : "fa-user-plus";
            const btnText = allActive ? "Na Cena" : "+ Cena";
            const btnTitle = allActive
                ? `Todos os ${directCount} desta pasta estão em cena (clique para remover apenas eles)`
                : `Adicionar todos desta pasta à cena (${directCount} ${directCount === 1 ? "personagem" : "personagens"}, sem subpastas)`;

            addFolderBtnHTML = `
                <button type="button" class="${btnClass}" data-folder-id="${escapeHtml(folder.id)}" title="${escapeHtml(btnTitle)}">
                    <i class="fas ${btnIcon}"></i> <span>${btnText}</span>
                </button>
            `;
        }

        const countTitle = folder.children.length > 0
            ? `${directCount} diretamente nesta pasta · ${totalActors} somando subpastas`
            : `${directCount} ${directCount === 1 ? "personagem" : "personagens"}`;

        let html = `
        <div class="teatro-folder ${isCollapsed ? "collapsed" : ""}" data-folder-id="${escapeHtml(folder.id)}">
            <div class="teatro-folder-header">
                <div class="teatro-folder-title-group">
                    <i class="fas fa-chevron-down teatro-folder-caret"></i>
                    <i class="fas ${folderIcon}"></i>
                    <span class="teatro-folder-name" title="${safeFolderName}">${safeFolderName}</span>
                </div>
                <div class="teatro-folder-actions">
                    ${addFolderBtnHTML}
                    <span class="teatro-folder-count" title="${countTitle}">${totalActors}</span>
                </div>
            </div>
            <div class="teatro-folder-content" style="${isCollapsed ? "display: none;" : ""}">
        `;

        if (directCount > 0) {
            html += `<div class="teatro-actor-grid">`;
            folder.actors.forEach(actor => {
                html += this._buildActorCardHTML(actor);
            });
            html += `</div>`;
        }

        if (folder.children.length > 0) {
            html += `<div class="teatro-subfolders">`;
            folder.children.forEach(child => {
                html += this._buildFolderBlockHTML(child, false);
            });
            html += `</div>`;
        }

        html += `
            </div>
        </div>`;
        return html;
    }

    getData() {
        const actorFolders = game.folders.filter(f => f.type === "Actor");
        const folderMap = new Map();

        actorFolders.forEach(f => {
            const parentId = f.folder ? (f.folder.id || f.folder) : null;
            folderMap.set(f.id, {
                id: f.id,
                name: f.name,
                folder: parentId,
                sort: f.sort ?? 0,
                actors: this.getDirectAccessibleActorsForFolder(f.id),
                children: []
            });
        });

        const rootFolders = [];
        for (const [, node] of folderMap) {
            if (node.folder && folderMap.has(node.folder)) {
                folderMap.get(node.folder).children.push(node);
            } else {
                rootFolders.push(node);
            }
        }

        const sortFolders = list => {
            list.sort((a, b) => (a.sort - b.sort) || a.name.localeCompare(b.name));
            list.forEach(f => sortFolders(f.children));
        };
        sortFolders(rootFolders);

        const pruneEmpty = folders => {
            for (let i = folders.length - 1; i >= 0; i--) {
                const f = folders[i];
                pruneEmpty(f.children);
                if (f.actors.length === 0 && f.children.length === 0) {
                    folders.splice(i, 1);
                }
            }
        };
        pruneEmpty(rootFolders);

        let folderHTML = "";
        rootFolders.forEach(f => {
            folderHTML += this._buildFolderBlockHTML(f, false);
        });

        const unassignedActors = this.getDirectAccessibleActorsForFolder("root");
        let unassignedHTML = "";
        if (unassignedActors.length > 0) {
            unassignedHTML = this._buildFolderBlockHTML({
                id: "root",
                name: "Sem Pasta",
                actors: unassignedActors,
                children: []
            }, true);
        }

        return {
            folderHTML: folderHTML,
            unassignedHTML: unassignedHTML,
            hasNoActors: rootFolders.length === 0 && unassignedActors.length === 0,
            isGM: game.user.isGM,
            currentScale: game.settings.get(MODULE_ID, "actorScale"),
            blurEnabled: Boolean(game.settings.get(MODULE_ID, "sceneBlurEnabled")),
            blurIntensity: Number(game.settings.get(MODULE_ID, "sceneBlurIntensity") ?? 50),
            allowPlayerSpotlight: isPlayerSpotlightAllowed(),
            activeCount: Object.keys(activeVideos).length,
            maxActors: game.settings.get(MODULE_ID, "maxActors") || 10,
            searchQuery: this.searchQuery || ""
        };
    }

    handleActorUpdated(actor, changes) {
        if (!this.rendered || !this.element) return;

        if (changes.folder !== undefined) {
            this.refreshPreservingState();
            return;
        }

        const $item = this.element.find(`.teatro-actor-item[data-actor-id="${actor.id}"]`);
        const eligible = isActorEligible(actor);

        if (eligible && $item.length > 0) {
            const newSrc = getActorMediaSrc(actor);
            const oldSrc = $item.attr("data-media-src");

            if (newSrc !== oldSrc) {
                const safeName = escapeHtml(actor.name);
                const safeSrc = escapeHtml(newSrc);
                const video = isVideoSrc(newSrc);
                const thumbHTML = video
                    ? `<video class="teatro-actor-img" src="${safeSrc}" muted loop playsinline preload="metadata"></video>
                       <span class="teatro-actor-badge" title="Mídia em Vídeo"><i class="fas fa-video"></i></span>`
                    : `<img class="teatro-actor-img" src="${safeSrc}" alt="${safeName}" loading="lazy" />`;
                $item.find(".teatro-actor-thumb-wrap").html(thumbHTML);
                $item.attr("data-media-src", newSrc);
            }

            if (changes.name !== undefined) {
                $item.attr("title", actor.name);
                $item.find(".teatro-actor-name").text(actor.name);
            }

            this.syncActiveStates();
        } else if (eligible !== ($item.length > 0)) {
            this.refreshPreservingState();
        }
    }

    refreshPreservingState() {
        if (!this.rendered || !this.element) return;
        const $scrollBox = this.element.find(".teatro-panel-content");
        if ($scrollBox.length > 0) {
            this._savedScrollTop = $scrollBox.scrollTop();
        }
        this.render(false);
    }

    syncBlurState(enabled, intensity) {
        if (!this.rendered || !this.element) return;
        const $btn = this.element.find("#teatro-blur-btn");
        $btn.toggleClass("active", Boolean(enabled));
        $btn.find(".teatro-blur-label").text(enabled ? "Blur: ON" : "Blur: OFF");
        if (typeof intensity === "number") {
            $btn.attr("title", `Ativar/Desativar desfoque (~${intensity}%) no fundo da cena para todos`);
        }
    }

    syncPlayerSpotlightPermState(allowed) {
        if (!this.rendered || !this.element) return;
        const $btn = this.element.find("#teatro-player-spotlight-btn");
        $btn.toggleClass("unlocked", Boolean(allowed)).toggleClass("locked", !allowed);
        $btn.find("i").attr("class", `fas ${allowed ? "fa-unlock" : "fa-lock"}`);
        $btn.find(".teatro-perm-label").text(allowed ? "Destaque: Livre" : "Destaque: Só GM");
        $btn.attr(
            "title",
            allowed
                ? "Jogadores podem destacar o próprio personagem ao falar (clique para restringir só ao Mestre)"
                : "Apenas o Mestre pode ativar o destaque de fala (clique para liberar aos jogadores)"
        );
    }

    syncActiveStates() {
        if (!this.rendered || !this.element) return;

        // 1. Atualiza cards de atores
        this.element.find(".teatro-actor-item").each(function() {
            const id = String($(this).attr("data-actor-id"));
            $(this).toggleClass("active", Boolean(activeVideos[id]));
        });

        // 2. Atualiza botões "+ Cena" / "Na Cena" de cada pasta
        const self = this;
        this.element.find(".teatro-folder-add-btn").each(function() {
            const folderId = String($(this).attr("data-folder-id"));
            const directActors = self.getDirectAccessibleActorsForFolder(folderId);
            const count = directActors.length;
            const allActive = count > 0 && directActors.every(a => Boolean(activeVideos[a.id]));

            $(this).toggleClass("all-active", allActive);
            $(this).find("i").attr("class", `fas ${allActive ? "fa-check" : "fa-user-plus"}`);
            $(this).find("span").text(allActive ? "Na Cena" : "+ Cena");
            $(this).attr(
                "title",
                allActive
                    ? `Todos os ${count} desta pasta estão em cena (clique para remover apenas eles)`
                    : `Adicionar todos desta pasta à cena (${count} ${count === 1 ? "personagem" : "personagens"}, sem subpastas)`
            );
        });

        // 3. Atualiza barra rápida "Em Cena" no topo do painel
        const activeIds = Object.keys(activeVideos);
        this.element.find("#teatro-active-count").text(activeIds.length);

        const anySpotlight = activeIds.some(id => Boolean(activeVideos[id]?.highlighted));
        this.element.find("#teatro-clear-spotlight-btn").toggle(anySpotlight);

        const $strip = this.element.find("#teatro-active-strip");
        if ($strip.length > 0) {
            if (activeIds.length === 0) {
                $strip.html(`<span class="teatro-active-empty">Nenhum personagem em cena.</span>`);
            } else {
                let chipsHTML = "";
                activeIds.forEach(id => {
                    const actor = game.actors.get(id);
                    const name = escapeHtml(actor ? actor.name : "Desconhecido");
                    const state = activeVideos[id];
                    const isLit = Boolean(state?.highlighted);
                    const auraHex = normalizeHexColor(state?.auraColor || DEFAULT_AURA_COLOR);
                    chipsHTML += `
                        <div class="teatro-stage-chip ${isLit ? "is-spotlight" : ""}" data-actor-id="${escapeHtml(id)}" style="--chip-aura: ${escapeHtml(auraHex)};">
                            <label class="teatro-chip-color-wrap" style="background: ${escapeHtml(auraHex)};" title="Mudar cor da aura de ${name}">
                                <input type="color" class="teatro-chip-color-input" value="${escapeHtml(auraHex)}">
                            </label>
                            <span class="teatro-chip-name" data-chip-action="spotlight" title="Clique para destacar fala de ${name}">${name}</span>
                            <button type="button" class="teatro-chip-action" data-chip-action="mirror" title="Espelhar"><i class="fas fa-arrows-alt-h"></i></button>
                            <button type="button" class="teatro-chip-action remove" data-chip-action="remove" title="Remover da cena"><i class="fas fa-times"></i></button>
                        </div>
                    `;
                });
                $strip.html(chipsHTML);
            }
        }
    }

    _applySearchFilter(html, rawTerm) {
        const term = String(rawTerm || "").trim().toLowerCase();
        this.searchQuery = rawTerm || "";

        html.find("#teatro-search-clear").toggle(term.length > 0);

        if (term === "") {
            html.find(".teatro-actor-item").show();
            html.find(".teatro-folder").show();
            const collapsed = this.collapsedFolders;
            html.find(".teatro-folder").each(function() {
                const fId = String($(this).attr("data-folder-id"));
                const isCol = collapsed.has(fId);
                $(this).toggleClass("collapsed", isCol);
                $(this).children(".teatro-folder-content").toggle(!isCol);
            });
            return;
        }

        html.find(".teatro-actor-item").hide();
        html.find(".teatro-folder").hide();

        html.find(".teatro-folder").each(function() {
            const folderName = $(this).children(".teatro-folder-header").find(".teatro-folder-name").text().toLowerCase();
            if (folderName.includes(term)) {
                $(this).show();
                $(this).children(".teatro-folder-content").children(".teatro-actor-grid").children(".teatro-actor-item").show();
                $(this).parents(".teatro-folder").show();
            }
        });

        html.find(".teatro-actor-item").each(function() {
            const actorName = $(this).find(".teatro-actor-name").text().toLowerCase();
            if (actorName.includes(term)) {
                $(this).show();
                $(this).parents(".teatro-folder").show();
            }
        });

        html.find(".teatro-folder:visible").each(function() {
            $(this).removeClass("collapsed");
            $(this).children(".teatro-folder-content").show();
        });
    }

    activateListeners(html) {
        super.activateListeners(html);

        const $scrollBox = html.find(".teatro-panel-content");

        $scrollBox.on("scroll", e => {
            this._savedScrollTop = e.currentTarget.scrollTop;
        });

        if (this.searchQuery) {
            this._applySearchFilter(html, this.searchQuery);
        }
        if (this._savedScrollTop > 0) {
            $scrollBox.scrollTop(this._savedScrollTop);
        }

        this.syncActiveStates();

        // Barra de Pesquisa
        html.find("#teatro-search-input").on("input", e => {
            this._applySearchFilter(html, e.currentTarget.value);
        });

        html.find("#teatro-search-clear").on("click", e => {
            e.preventDefault();
            const $input = html.find("#teatro-search-input");
            $input.val("");
            this._applySearchFilter(html, "");
            $input.trigger("focus");
        });

        // Expandir / Recolher Todas as Pastas
        html.find("#teatro-expand-all-btn").on("click", e => {
            e.preventDefault();
            this.collapsedFolders.clear();
            this._saveCollapsedFolders();
            html.find(".teatro-folder").removeClass("collapsed");
            html.find(".teatro-folder-content").slideDown(160);
        });

        html.find("#teatro-collapse-all-btn").on("click", e => {
            e.preventDefault();
            const self = this;
            html.find(".teatro-folder").each(function() {
                const fId = String($(this).attr("data-folder-id"));
                self.collapsedFolders.add(fId);
                $(this).addClass("collapsed");
            });
            this._saveCollapsedFolders();
            html.find(".teatro-folder-content").slideUp(160);
        });

        // Escala dos Personagens (GM)
        html.find("#teatro-scale-slider").on("input", e => {
            const val = e.currentTarget.value;
            html.find("#teatro-scale-val").text(`${val}%`);
            updateGlobalScale(val);
        });

        html.find("#teatro-scale-slider").on("change", async e => {
            const val = Number(e.currentTarget.value);
            await game.settings.set(MODULE_ID, "actorScale", val);
        });

        html.find(".teatro-scale-row label").on("dblclick", async () => {
            if (!game.user.isGM) return;
            html.find("#teatro-scale-slider").val(48);
            html.find("#teatro-scale-val").text("48%");
            updateGlobalScale(48);
            await game.settings.set(MODULE_ID, "actorScale", 48);
        });

        // Botão de Blur na Cena (~50%) - Apenas Mestre
        html.find("#teatro-blur-btn").on("click", async e => {
            e.preventDefault();
            if (!game.user.isGM) return;
            const nextState = !game.settings.get(MODULE_ID, "sceneBlurEnabled");
            applySceneBlur(nextState);
            emitSocketData({ action: "blur", enabled: nextState }, false);
            await game.settings.set(MODULE_ID, "sceneBlurEnabled", nextState);
        });

        // Botão Liberar / Restringir Destaque pelos Jogadores - Apenas Mestre
        html.find("#teatro-player-spotlight-btn").on("click", async e => {
            e.preventDefault();
            if (!game.user.isGM) return;
            const nextAllowed = !isPlayerSpotlightAllowed();
            applyPlayerSpotlightPermission(nextAllowed);
            emitSocketData({ action: "playerSpotlightPerm", enabled: nextAllowed }, false);
            await game.settings.set(MODULE_ID, "allowPlayerSpotlight", nextAllowed);
        });

        // Centralizar / Organizar Todos em Cena
        html.find("#teatro-center-all-btn").on("click", e => {
            e.preventDefault();
            if (!game.user.isGM) return;
            centerAllActiveActors();
        });

        // Limpar Cena
        html.find("#teatro-remove-all-btn").on("click", e => {
            e.preventDefault();
            if (!game.user.isGM) return;
            activeVideos = {};
            updateVideoDOM();
            emitSocketData({ action: "removeAll" });
        });

        // Forçar Sincronização
        html.find("#teatro-force-sync-btn").on("click", e => {
            e.preventDefault();
            if (!game.user.isGM) return;
            for (const [id, state] of Object.entries(activeVideos)) {
                const actor = game.actors.get(id);
                if (actor) {
                    const latestSrc = getActorMediaSrc(actor);
                    if (isValidMediaSrc(latestSrc, hasCustomTheaterMedia(actor))) state.src = latestSrc;
                    state.auraColor = getActorAuraColor(actor);
                }
            }
            updateVideoDOM();
            emitSocketData({ action: "sync", state: activeVideos });
            emitSocketData({ action: "blur", enabled: Boolean(game.settings.get(MODULE_ID, "sceneBlurEnabled")) }, false);
            emitSocketData({ action: "playerSpotlightPerm", enabled: isPlayerSpotlightAllowed() }, false);
            ui.notifications.info("Sincronização forçada enviada aos jogadores.");
        });

        // Resetar Foco / Destaque de Fala
        html.find("#teatro-clear-spotlight-btn").on("click", e => {
            e.preventDefault();
            Object.values(activeVideos).forEach(s => { s.highlighted = false; });
            updateSpotlightClasses();
            Object.keys(activeVideos).forEach(id => updateVideoTransform(id));
            this.syncActiveStates();
            emitSocketData({ action: "clearSpotlight" });
        });

        // Interações nos chips da barra "Em Cena"
        html.find("#teatro-active-strip").on("click", "[data-chip-action]", e => {
            e.preventDefault();
            e.stopPropagation();
            const action = $(e.currentTarget).attr("data-chip-action");
            const id = String($(e.currentTarget).closest(".teatro-stage-chip").attr("data-actor-id"));
            if (!id || !activeVideos[id]) return;

            if (action === "spotlight") toggleActorSpotlight(id);
            else if (action === "mirror") toggleActorMirror(id);
            else if (action === "remove") removeActorFromStage(id);
        });

        // Seletor de cor da aura direto nos chips "Em Cena"
        html.find("#teatro-active-strip").on("input", ".teatro-chip-color-input", e => {
            e.stopPropagation();
            const id = String($(e.currentTarget).closest(".teatro-stage-chip").attr("data-actor-id"));
            if (!id) return;
            const hex = normalizeHexColor(e.currentTarget.value);
            $(e.currentTarget).closest(".teatro-chip-color-wrap").css("background", hex);
            $(e.currentTarget).closest(".teatro-stage-chip")[0].style.setProperty("--chip-aura", hex);
            updateActorAuraColorLive(id, hex, false);
        });

        html.find("#teatro-active-strip").on("change", ".teatro-chip-color-input", e => {
            e.stopPropagation();
            const id = String($(e.currentTarget).closest(".teatro-stage-chip").attr("data-actor-id"));
            if (!id) return;
            updateActorAuraColorLive(id, e.currentTarget.value, true);
        });

        // Botão "Adicionar todos da pasta à cena" (exclui subpastas!)
        html.on("click", ".teatro-folder-add-btn", e => {
            e.preventDefault();
            e.stopPropagation();
            if (!game.user.isGM) return;

            const folderId = String($(e.currentTarget).attr("data-folder-id"));
            const directActors = this.getDirectAccessibleActorsForFolder(folderId);
            if (directActors.length === 0) return;

            const allAlreadyActive = directActors.every(a => Boolean(activeVideos[a.id]));

            if (allAlreadyActive) {
                directActors.forEach(a => {
                    delete activeVideos[a.id];
                });
                updateVideoDOM();
                emitSocketData({ action: "sync", state: activeVideos });
                return;
            }

            const maxAllowed = game.settings.get(MODULE_ID, "maxActors") || 10;
            let addedCount = 0;
            let hitLimit = false;

            for (const actorData of directActors) {
                if (activeVideos[actorData.id]) continue;

                if (Object.keys(activeVideos).length >= maxAllowed) {
                    hitLimit = true;
                    break;
                }

                const actorDoc = game.actors.get(actorData.id);
                if (!actorDoc) continue;

                const spawnX = getSmartCenterSpawnX();
                activeVideos[actorData.id] = createActorStageState(actorDoc, spawnX);
                addedCount += 1;
            }

            if (hitLimit) {
                ui.notifications.warn(`Limite máximo de ${maxAllowed} personagens atingido (${addedCount} adicionados). Você pode aumentar esse limite nas Configurações do Jogo.`);
            }

            if (addedCount > 0) {
                updateVideoDOM();
                emitSocketData({ action: "sync", state: activeVideos });
            }
        });

        // Sanfona de Pastas
        html.on("click", ".teatro-folder-header", e => {
            if ($(e.target).closest(".teatro-folder-add-btn").length > 0) return;
            e.preventDefault();
            e.stopPropagation();

            const $folder = $(e.currentTarget).closest(".teatro-folder");
            const folderId = String($folder.attr("data-folder-id"));
            const $content = $folder.children(".teatro-folder-content");

            const willCollapse = !$folder.hasClass("collapsed");
            $folder.toggleClass("collapsed", willCollapse);

            if (willCollapse) {
                this.collapsedFolders.add(folderId);
                $content.slideUp(160);
            } else {
                this.collapsedFolders.delete(folderId);
                $content.slideDown(160);
            }
            this._saveCollapsedFolders();
        });

        // Adicionar/Remover Ator Individual
        html.on("click", ".teatro-actor-item", e => {
            e.preventDefault();
            e.stopPropagation();

            const id = String($(e.currentTarget).attr("data-actor-id"));
            const actor = game.actors.get(id);
            if (!actor) return;

            if (activeVideos[id]) {
                delete activeVideos[id];
                updateVideoDOM();
                emitSocketData({ action: "remove", id: id });
            } else {
                const count = Object.keys(activeVideos).length;
                const maxAllowed = game.settings.get(MODULE_ID, "maxActors") || 10;

                if (count >= maxAllowed) {
                    ui.notifications.warn(`O limite configurado é de ${maxAllowed} personagens simultâneos no Teatro.`);
                    return;
                }

                const spawnX = getSmartCenterSpawnX();
                activeVideos[id] = createActorStageState(actor, spawnX);

                updateVideoDOM();
                emitSocketData({ action: "add", id: id, state: activeVideos[id] });
            }
        });
    }
}

// -------------------------------------------------------------
// BOTÃO NO CABEÇALHO DA FICHA (MÍDIA + COR DA AURA DO TEATRO)
// -------------------------------------------------------------
Hooks.on("getActorSheetHeaderButtons", (sheet, buttons) => {
    if (!game.user.isGM && !sheet.actor.isOwner) return;

    buttons.unshift({
        label: "Teatro",
        class: "teatro-media-btn",
        icon: "fas fa-film",
        onclick: () => {
            const currentMedia = sheet.actor.getFlag(MODULE_ID, "customMedia") || "";
            const currentAura = getActorAuraColor(sheet.actor);
            const userHex = getCurrentUserHexColor();

            const presetSwatches = AURA_PRESETS.map(p =>
                `<button type="button" class="teatro-dialog-swatch" data-color="${p.color}" title="${escapeHtml(p.name)}" style="width:24px;height:24px;border-radius:50%;border:2px solid rgba(0,0,0,0.4);background:${p.color};cursor:pointer;padding:0;margin:0;"></button>`
            ).join("");

            const dlg = new Dialog({
                title: `Configurar Teatro — ${sheet.actor.name}`,
                content: `
                    <div class="form-group" style="margin-bottom: 12px;">
                        <label style="font-weight: bold;">URL ou Caminho da Mídia (Imagem ou Vídeo):</label>
                        <input type="text" id="teatro-custom-media-input" value="${escapeHtml(currentMedia)}" style="width: 100%; box-sizing: border-box; margin-top: 6px; margin-bottom: 4px;" placeholder="Ex: https://exemplo.com/midia.webm">
                        <p class="notes" style="font-size: 12px; color: var(--color-text-dark-secondary); margin: 0;">
                            Deixe em branco para usar automaticamente o Halfbody ou Avatar padrão da ficha.
                        </p>
                    </div>
                    <hr style="margin: 10px 0;">
                    <div class="form-group" style="margin-bottom: 10px;">
                        <label style="font-weight: bold; display: block; margin-bottom: 6px;">Cor da Aura de Destaque (Ao Falar):</label>
                        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                            <input type="color" id="teatro-custom-aura-input" value="${escapeHtml(currentAura)}" style="width: 42px; height: 30px; padding: 0; border: none; cursor: pointer;">
                            ${presetSwatches}
                            <button type="button" class="teatro-dialog-swatch" data-color="${escapeHtml(userHex)}" title="Usar Cor do seu Usuário" style="width:auto;height:24px;border-radius:12px;border:1px solid rgba(0,0,0,0.4);background:${escapeHtml(userHex)};color:#fff;text-shadow:0 1px 2px #000;font-size:11px;padding:0 8px;cursor:pointer;margin:0;">Cor do Jogador</button>
                        </div>
                    </div>
                `,
                buttons: {
                    save: {
                        icon: '<i class="fas fa-check"></i>',
                        label: "Salvar",
                        callback: async html => {
                            const val = html.find("#teatro-custom-media-input").val().trim();
                            const auraVal = normalizeHexColor(html.find("#teatro-custom-aura-input").val());

                            if (val) {
                                await sheet.actor.setFlag(MODULE_ID, "customMedia", val);
                            } else {
                                await sheet.actor.unsetFlag(MODULE_ID, "customMedia");
                            }

                            await sheet.actor.setFlag(MODULE_ID, "auraColor", auraVal);
                            updateActorAuraColorLive(sheet.actor.id, auraVal, false);
                            ui.notifications.info("Configurações do Teatro salvas!");
                        }
                    },
                    cancel: {
                        icon: '<i class="fas fa-times"></i>',
                        label: "Cancelar"
                    }
                },
                render: html => {
                    html.find(".teatro-dialog-swatch").on("click", ev => {
                        ev.preventDefault();
                        const chosen = $(ev.currentTarget).attr("data-color");
                        html.find("#teatro-custom-aura-input").val(normalizeHexColor(chosen));
                    });
                },
                default: "save"
            });

            dlg.render(true);
        }
    });
});
