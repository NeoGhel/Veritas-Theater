console.log("Teatro em Vídeo | Arquivo main.js carregado pelo Foundry!");

const MODULE_ID = "teatro-video";
const SOCKET_NAME = `module.${MODULE_ID}`;

// Estado atual de todos os vídeos na tela
// { [actorId]: { src: "", x: 0, y: 0, mirrored: false, side: 'left'|'right' } }
let activeVideos = {};

let $container;

// -------------------------------------------------------------
// INICIALIZAÇÃO E CONFIGURAÇÕES
// -------------------------------------------------------------
Hooks.once('init', () => {
    game.settings.register(MODULE_ID, "actorScale", {
        name: "Escala dos Personagens",
        hint: "Define a altura base dos personagens no Teatro em Vídeo.",
        scope: "world", // Compartilhado por todos os jogadores
        config: false,  // Escondido do menu padrão
        type: Number,
        default: 48,    // 48vh (20% menor que o antigo 60vh)
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

    game.settings.register(MODULE_ID, "activeVideosState", {
        scope: "world",
        config: false,
        type: Object,
        default: {}
    });
});

function saveState() {
    if (!game.user.isGM) return;
    if (ui.teatroSaveTimeout) clearTimeout(ui.teatroSaveTimeout);
    ui.teatroSaveTimeout = setTimeout(() => {
        game.settings.set(MODULE_ID, "activeVideosState", activeVideos);
    }, 1000);
}

function updateGlobalScale(value) {
    document.documentElement.style.setProperty('--teatro-scale', `${value}vh`);
}

Hooks.once('ready', () => {
    console.log("Teatro em Vídeo | Inicializando módulo (Multi-Actor)");

    // Carrega o estado sincronizado salvo e a escala inicial
    activeVideos = game.settings.get(MODULE_ID, "activeVideosState") || {};
    updateGlobalScale(game.settings.get(MODULE_ID, "actorScale"));

    // Injetar container na tela principal
    const html = `
        <div id="teatro-video-container"></div>
    `;
    $('body').append(html);
    $container = $('#teatro-video-container');

    // Garante que o painel seja populado ao entrar no jogo
    updateVideoDOM();

    // Escuta dos Sockets
    game.socket.on(SOCKET_NAME, (data) => {
        handleSocketAction(data);
    });
});

// -------------------------------------------------------------
// SOCKETS
// -------------------------------------------------------------
function emitSocketData(data) {
    game.socket.emit(SOCKET_NAME, data);
    saveState();
}

function handleSocketAction(data) {
    if (data.action === "add" || data.action === "update") {
        activeVideos[data.id] = data.state;
        updateVideoDOM();
    } else if (data.action === "remove") {
        delete activeVideos[data.id];
        updateVideoDOM();
    } else if (data.action === "drag") {
        if (activeVideos[data.id]) {
            activeVideos[data.id].baseX = data.baseX;
            activeVideos[data.id].playerOffsetX = data.playerOffsetX;
            updateVideoTransform(data.id);
        }
    } else if (data.action === "mirror") {
        if (activeVideos[data.id]) {
            activeVideos[data.id].mirrored = data.mirrored;
            updateVideoTransform(data.id);
        }
    }
    saveState();
}

// -------------------------------------------------------------
// -------------------------------------------------------------
// RENDERIZAÇÃO DE VÍDEOS E IMAGENS
// -------------------------------------------------------------
function updateVideoDOM() {
    const currentIds = Object.keys(activeVideos);
    
    // Remover vídeos que não estão mais no estado
    $container.find('.teatro-actor-wrapper').each(function() {
        const id = $(this).data('id');
        if (!currentIds.includes(String(id))) {
            $(this).remove();
        }
    });

    // Adicionar vídeos novos
    currentIds.forEach(id => {
        if ($container.find(`.teatro-actor-wrapper[data-id="${id}"]`).length === 0) {
            const state = activeVideos[id];
            const actor = game.actors.get(id);
            const name = actor ? actor.name : "Desconhecido";
            
            const isVideo = state.src.endsWith('.webm') || state.src.endsWith('.mp4');
            const mediaHTML = isVideo 
                ? `<video class="teatro-media-player" src="${state.src}" autoplay loop muted playsinline></video>`
                : `<img class="teatro-media-player" src="${state.src}" />`;

            const $wrapper = $(`
                <div class="teatro-actor-wrapper" data-id="${id}">
                    ${mediaHTML}
                    <div class="teatro-actor-nameplate">${name}</div>
                </div>
            `);
            
            $container.append($wrapper);
            
            if (isVideo) {
                let playPromise = $wrapper.find('video')[0].play();
                if (playPromise !== undefined) {
                  playPromise.catch(error => console.warn(`Teatro em Vídeo | Auto-play interceptado para ${id}:`, error));
                }
            }

            // Aplicar posição e espelhamento iniciais
            updateVideoTransform(id);

            // Adicionar Event Listeners
            const canInteract = game.user.isGM || (actor && actor.isOwner);
            if (canInteract) {
                attachVideoListeners($wrapper, id);
            } else {
                $wrapper.css('pointer-events', 'none');
            }
        }
    });

    if (ui.teatroControlPanel && ui.teatroControlPanel.rendered) {
        ui.teatroControlPanel.syncActiveStates();
    }
}

function updateVideoTransform(id) {
    const state = activeVideos[id];
    if (!state) return;
    const $v = $container.find(`.teatro-actor-wrapper[data-id="${id}"]`);
    if ($v.length > 0) {
        const totalX = (state.baseX || 0) + (state.playerOffsetX || 0);
        $v.css('transform', `translate(calc(-50% + ${totalX}px), 0px)`);
        // Espelhamento na imagem apenas
        $v.find('.teatro-media-player').css('transform', `scaleX(${state.mirrored ? -1 : 1})`);
    }
}

// -------------------------------------------------------------
// EVENTOS DE INTERAÇÃO COM O VÍDEO (DRAG & DROP)
// -------------------------------------------------------------
function attachVideoListeners($video, id) {
    let isDragging = false;
    let startX;

    $video.on('mousedown', (e) => {
        if (e.button === 0) {
            isDragging = true;
            const state = activeVideos[id];
            const isGM = game.user.isGM;
            
            if (isGM) {
                startX = e.clientX - (state.baseX || 0);
            } else {
                startX = e.clientX - (state.playerOffsetX || 0);
            }
            $video.css('cursor', 'grabbing');
        }
    });

    $(window).on('mousemove', (e) => {
        if (!isDragging) return;
        const state = activeVideos[id];
        const isGM = game.user.isGM;
        
        let targetX = e.clientX - startX;
        
        if (isGM) {
            // Mestre: Limites de tela (window.innerWidth / 2 é do centro até a borda)
            const limit = window.innerWidth / 2;
            const max = limit - 100; // Deixa 100px pra não sumir
            const min = -limit + 100;
            
            if (targetX > max) targetX = max;
            if (targetX < min) targetX = min;
            
            state.baseX = targetX;
        } else {
            // Jogador: Limite de dois dedos e meio (150px) do centro base
            if (targetX > 150) targetX = 150;
            if (targetX < -150) targetX = -150;
            
            state.playerOffsetX = targetX;
        }
        
        updateVideoTransform(id);
        
        // Emite o drag em tempo real
        emitSocketData({ action: "drag", id: id, baseX: state.baseX, playerOffsetX: state.playerOffsetX });
    });

    $(window).on('mouseup', (e) => {
        if (e.button === 0 && isDragging) {
            isDragging = false;
            $video.css('cursor', 'grab');
        }
    });

    $video.on('contextmenu', (e) => {
        e.preventDefault();
        const state = activeVideos[id];
        state.mirrored = !state.mirrored;
        updateVideoTransform(id);
        emitSocketData({ action: "mirror", id: id, mirrored: state.mirrored });
    });
}

// -------------------------------------------------------------
// BOTÃO FLUTUANTE INDEPENDENTE (Bypass do Sistema)
// -------------------------------------------------------------
// Como o seu sistema (Multiversus) está quebrando/escondendo a coluna secundária
// do Foundry, criamos um botão independente que fica logo abaixo dos controles na esquerda.
Hooks.once('ready', () => {
    if (!game.user.isGM) return;

    const $btn = $(`
        <div id="teatro-independent-btn" title="Abrir Teatro (Teatro em Vídeo)">
            <i class="fas fa-theater-masks"></i>
        </div>
    `);
    
    $('body').append($btn);
    
    let isDraggingBtn = false;
    let dragStartX, dragStartY, initialLeft, initialTop;

    $btn.on('mousedown', (e) => {
        if (e.button === 0) {
            isDraggingBtn = true;
            dragStartX = e.clientX;
            dragStartY = e.clientY;
            const offset = $btn.offset();
            initialLeft = offset.left;
            initialTop = offset.top;
            $btn.css({ transition: 'none', cursor: 'grabbing' });
            e.preventDefault();
        }
    });

    $(window).on('mousemove', (e) => {
        if (!isDraggingBtn) return;
        let newLeft = initialLeft + (e.clientX - dragStartX);
        let newTop = initialTop + (e.clientY - dragStartY);

        const btnWidth = $btn.outerWidth();
        const btnHeight = $btn.outerHeight();
        const maxLeft = window.innerWidth - btnWidth;
        const maxTop = window.innerHeight - btnHeight;

        if (newLeft < 0) newLeft = 0;
        if (newLeft > maxLeft) newLeft = maxLeft;
        if (newTop < 0) newTop = 0;
        if (newTop > maxTop) newTop = maxTop;

        $btn.css({ left: newLeft + 'px', top: newTop + 'px', bottom: 'auto', right: 'auto' });
    });

    $(window).on('mouseup', (e) => {
        if (e.button === 0 && isDraggingBtn) {
            isDraggingBtn = false;
            $btn.css({ transition: '', cursor: 'pointer' });
        }
    });
    
    $btn.on('click', (e) => {
        if (Math.abs(e.clientX - dragStartX) > 3 || Math.abs(e.clientY - dragStartY) > 3) return;
        if (!ui.teatroControlPanel) {
            ui.teatroControlPanel = new TeatroControlPanel();
        }
        ui.teatroControlPanel.render(true);
    });
});

// -------------------------------------------------------------
// JANELA DO PAINEL DE CONTROLE (APPLICATION)
// -------------------------------------------------------------
class TeatroControlPanel extends Application {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: "teatro-control-panel",
            title: "Painel do Teatro",
            template: "modules/teatro-video/templates/control-panel.html",
            width: 320,
            height: 450,
            resizable: true,
            classes: ["teatro-app"]
        });
    }

    getData() {
        let unassigned = [];
        const actorFolders = game.folders.filter(f => f.type === "Actor");

        // Retorna apenas atores que o usuário pode interagir
        const isMV = game.modules.get("multiversus-rpg")?.active;

        const getAccessibleActors = (actorsCollection) => {
            return actorsCollection.filter(a => {
                if (!game.user.isGM && !a.isOwner) return false;
                
                let src = a.img;
                let customMedia = a.getFlag(MODULE_ID, 'customMedia');
                let halfbody = a.flags?.["multiversus-rpg"]?.halfBodyImg || a.flags?.["multiversus-rpg"]?.halfbody || a.flags?.["multiversus-rpg"]?.halfBody || a.flags?.["multiversus-rpg"]?.Halfbody;
                if (customMedia) {
                    src = customMedia;
                } else if (isMV && halfbody) {
                    src = halfbody;
                }

                return typeof src === "string" && (src.endsWith(".webm") || src.endsWith(".mp4") || src.endsWith(".gif") || src.endsWith(".webp") || src.endsWith(".png") || src.endsWith(".jpg") || src.endsWith(".jpeg"));
            }).map(a => {
                let src = a.img;
                let customMedia = a.getFlag(MODULE_ID, 'customMedia');
                let halfbody = a.flags?.["multiversus-rpg"]?.halfBodyImg || a.flags?.["multiversus-rpg"]?.halfbody || a.flags?.["multiversus-rpg"]?.halfBody || a.flags?.["multiversus-rpg"]?.Halfbody;
                if (customMedia) {
                    src = customMedia;
                } else if (isMV && halfbody) {
                    src = halfbody;
                }
                
                return {
                    id: a.id,
                    name: a.name,
                    img: src,
                    active: !!activeVideos[a.id]
                };
            });
        };

        const folderMap = new Map();
        actorFolders.forEach(f => {
            const parentId = f.folder ? (f.folder.id || f.folder) : null;
            folderMap.set(f.id, {
                id: f.id,
                name: f.name,
                folder: parentId,
                actors: getAccessibleActors(f.contents),
                children: []
            });
        });

        const rootFolders = [];
        for (let [id, node] of folderMap) {
            if (node.folder && folderMap.has(node.folder)) {
                folderMap.get(node.folder).children.push(node);
            } else {
                rootFolders.push(node);
            }
        }

        function pruneEmpty(folders) {
            for (let i = folders.length - 1; i >= 0; i--) {
                const f = folders[i];
                pruneEmpty(f.children);
                if (f.actors.length === 0 && f.children.length === 0) {
                    folders.splice(i, 1);
                }
            }
        }
        pruneEmpty(rootFolders);

        function buildFolderHTML(folder) {
            const getCount = (f) => f.actors.length + f.children.reduce((acc, c) => acc + getCount(c), 0);
            const totalActors = getCount(folder);

            let html = `
            <div class="teatro-folder" data-folder-id="${folder.id}">
                <h3 class="teatro-folder-header">
                    <i class="fas fa-folder"></i> ${folder.name}
                    <span class="teatro-folder-count">(${totalActors})</span>
                </h3>
                <div class="teatro-folder-content">
            `;
            
            if (folder.actors.length > 0) {
                html += `<div class="teatro-actor-list" style="display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 5px;">`;
                folder.actors.forEach(actor => {
                    const activeClass = actor.active ? "active" : "";
                    html += `
                        <div class="teatro-actor-item ${activeClass}" data-actor-id="${actor.id}">
                            <img class="teatro-actor-img" src="${actor.img}" alt="${actor.name}" title="${actor.name}" />
                            <span class="teatro-actor-name">${actor.name}</span>
                        </div>
                    `;
                });
                html += `</div>`;
            }
            
            if (folder.children.length > 0) {
                html += `<div class="teatro-subfolders" style="margin-left: 10px; border-left: 1px solid rgba(255,255,255,0.1); padding-left: 5px;">`;
                folder.children.forEach(child => {
                    html += buildFolderHTML(child);
                });
                html += `</div>`;
            }

            html += `
                </div>
            </div>`;
            return html;
        }

        let folderHTML = "";
        rootFolders.forEach(f => {
            folderHTML += buildFolderHTML(f);
        });

        const rootActors = game.actors.filter(a => !a.folder);
        unassigned = getAccessibleActors(rootActors);

        return {
            folderHTML: folderHTML,
            unassigned: unassigned,
            hasNoActors: rootFolders.length === 0 && unassigned.length === 0,
            isGM: game.user.isGM,
            currentScale: game.settings.get(MODULE_ID, "actorScale")
        };
    }

    syncActiveStates() {
        if (!this.rendered) return;
        this.element.find('.teatro-actor-item').each(function() {
            const id = $(this).data('actor-id');
            if (activeVideos[id]) {
                $(this).addClass('active');
            } else {
                $(this).removeClass('active');
            }
        });
    }

    activateListeners(html) {
        super.activateListeners(html);

        // Barra de Pesquisa
        html.find('#teatro-search-input').on('input', e => {
            const term = e.currentTarget.value.toLowerCase();
            
            if (term === "") {
                html.find('.teatro-actor-item').show();
                html.find('.teatro-folder').show();
                return;
            }

            html.find('.teatro-actor-item').hide();
            html.find('.teatro-folder').hide();

            html.find('.teatro-folder').each(function() {
                const folderName = $(this).find('.teatro-folder-header').first().text().toLowerCase();
                if (folderName.includes(term)) {
                    $(this).show();
                    $(this).find('.teatro-actor-item').show();
                    $(this).parents('.teatro-folder').show();
                }
            });

            html.find('.teatro-actor-item').each(function() {
                const actorName = $(this).find('.teatro-actor-name').text().toLowerCase();
                if (actorName.includes(term)) {
                    $(this).show();
                    $(this).parents('.teatro-folder').show();
                }
            });

            html.find('.teatro-folder:visible').each(function() {
                $(this).children('.teatro-folder-content').show();
            });
        });

        // Configuração de Escala (apenas GM)
        html.find('#teatro-scale-slider').on('input', e => {
            const val = e.currentTarget.value;
            html.find('#teatro-scale-val').text(`${val}%`);
            updateGlobalScale(val); // Preview em tempo real apenas para quem arrasta
        });
        
        html.find('#teatro-scale-slider').on('change', async e => {
            const val = Number(e.currentTarget.value);
            await game.settings.set(MODULE_ID, "actorScale", val); // Salva e sincroniza
        });

        // Sanfona de Pastas (Agora isolado para subpastas)
        html.find('.teatro-folder-header').click(e => {
            const $content = $(e.currentTarget).siblings('.teatro-folder-content').first();
            $content.slideToggle(200);
            e.stopPropagation();
        });

        // Adicionar/Remover Vídeo do Ator
        html.find('.teatro-actor-item').click(e => {
            const id = $(e.currentTarget).data('actor-id');
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

                // Lógica de auto-justaposição
                let newBaseX = 0;
                if (count > 0) {
                    const step = Math.ceil(count / 2);
                    const isRight = count % 2 === 1;
                    newBaseX = 300 * step * (isRight ? 1 : -1);
                }

                const isMV = game.modules.get("multiversus-rpg")?.active;
                let src = actor.img;
                let customMedia = actor.getFlag(MODULE_ID, 'customMedia');
                let halfbody = actor.flags?.["multiversus-rpg"]?.halfBodyImg || actor.flags?.["multiversus-rpg"]?.halfbody || actor.flags?.["multiversus-rpg"]?.halfBody || actor.flags?.["multiversus-rpg"]?.Halfbody;
                if (customMedia) {
                    src = customMedia;
                } else if (isMV && halfbody) {
                    src = halfbody;
                }
                
                const isRightSide = count % 2 === 1;

                activeVideos[id] = {
                    src: src,
                    baseX: newBaseX,
                    playerOffsetX: 0,
                    y: 0,
                    mirrored: isRightSide,
                    side: isRightSide ? 'right' : 'left'
                };
                
                updateVideoDOM();
                emitSocketData({ action: "add", id: id, state: activeVideos[id] });
            }
        });
    }
}

// -------------------------------------------------------------
// BOTÃO NO CABEÇALHO DA FICHA
// -------------------------------------------------------------
Hooks.on('getActorSheetHeaderButtons', (sheet, buttons) => {
    if (!game.user.isGM && !sheet.actor.isOwner) return;

    buttons.unshift({
        label: "Teatro",
        class: "teatro-media-btn",
        icon: "fas fa-film",
        onclick: () => {
            const currentMedia = sheet.actor.getFlag(MODULE_ID, 'customMedia') || "";
            new Dialog({
                title: "Configurar Mídia do Teatro",
                content: `
                    <div class="form-group">
                        <label>URL da Mídia (Imagem ou Vídeo):</label>
                        <input type="text" id="teatro-custom-media-input" value="${currentMedia}" style="width: 100%; box-sizing: border-box; margin-top: 5px; margin-bottom: 10px;" placeholder="Ex: https://exemplo.com/midia.webm">
                        <p class="notes" style="font-size: 12px; color: var(--color-text-dark-secondary);">Deixe em branco para usar o Halfbody ou Avatar padrão.</p>
                    </div>
                `,
                buttons: {
                    save: {
                        icon: '<i class="fas fa-check"></i>',
                        label: "Salvar",
                        callback: (html) => {
                            const val = html.find('#teatro-custom-media-input').val().trim();
                            if (val) {
                                sheet.actor.setFlag(MODULE_ID, 'customMedia', val).then(() => {
                                    ui.notifications.info("Mídia do Teatro atualizada!");
                                });
                            } else {
                                sheet.actor.unsetFlag(MODULE_ID, 'customMedia').then(() => {
                                    ui.notifications.info("Mídia do Teatro removida (usando padrão)!");
                                });
                            }
                        }
                    },
                    cancel: {
                        icon: '<i class="fas fa-times"></i>',
                        label: "Cancelar"
                    }
                },
                default: "save"
            }).render(true);
        }
    });
});
