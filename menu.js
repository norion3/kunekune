/**
 * ==============================================================================
 * 『くねくねバトル オンライン』ボトムシートメニュー (menu.js)
 * v26.2.0 メニュー外タップ即時終了＆動的HOSTバッジ版:
 * ・【メニュー外タップ終了】ボトムシートの背後（画面上部〜中央の暗い余白部分）を
 * 　タップした際、✕ボタンを押さずとも即座にメニューを閉じるイベントハンドラを配備
 * ・【誤閉塞完全防止】ボトムシート内部（#bottom-sheet）の操作（タブ切替、チャット入力、
 * 　スクロール等）は stopPropagation() で確実に保護し、操作中の意図しない誤閉塞を100%防止
 * ・【動的HOSTバッジ解決】ホスト昇格時に空き枠AIスロット0からHOSTバッジを解除し、新ホストへ正確にHOSTを動的付与
 * ・GravityRouter を gravity_router.js へ完全委譲し、ボトムシートUI専任化
 * ・シングル・マルチ共通：走者タブ内に最大定員6名分のスロット枠を常時整然と確保
 * ・実走者タップ時のGRAVITYプロフィール画面安全起動
 * ・右上の共有 [↑] ボタン直下の分離型いいね誘導アンカー (#like-guide-anchor) 制御
 * ==============================================================================
 */

import {
    CREATOR_MAIN_INTERNAL_UID,
    CREATOR_SUB_INTERNAL_UID,
    SNAKE_COLORS,
    MAX_PLAYERS
} from './constants.js';

import { Danmaku } from './danmaku.js';
import { GravityRouter } from './gravity_router.js';

export { GravityRouter };

export class MenuManager {
    constructor() {
        this.isOpen = false;
        this.currentTab = 'chat'; // 'chat' | 'players' | 'custom' | 'creator'
        this.onCustomChange = null; // (face, color) => void
        this.selectedFace = 'normal';
        this.selectedColor = SNAKE_COLORS[0];

        this._lastParticipantSignature = '';
    }

    init(onCustomChange) {
        this.onCustomChange = onCustomChange;

        const btnMenu = document.getElementById('btn-menu');
        const btnClose = document.getElementById('btn-close-menu');
        const overlay = document.getElementById('menu-overlay');
        const sheet = document.getElementById('bottom-sheet');

        if (btnMenu) {
            btnMenu.onclick = (e) => {
                e.stopPropagation();
                this.toggle();
            };
        }
        if (btnClose) {
            btnClose.onclick = (e) => {
                e.stopPropagation();
                this.close();
            };
        }

        // ★ メニュー外（背景オーバーレイ）タップで即座にメニューを閉じる
        if (overlay) {
            const handleOverlayDismiss = (e) => {
                // タップされた対象がシート内部ではなくオーバーレイ背景そのものである場合のみ閉じる
                if (e.target === overlay) {
                    if (e.cancelable) e.preventDefault();
                    e.stopPropagation();
                    this.close();
                }
            };

            overlay.addEventListener('click', handleOverlayDismiss);
            overlay.addEventListener('touchend', handleOverlayDismiss, { passive: false });
        }

        // ボトムシート内部の操作がオーバーレイに貫通して誤閉塞するのを完全ガード
        if (sheet) {
            const stopBubble = (e) => {
                e.stopPropagation();
            };
            sheet.onclick = stopBubble;
            sheet.ontouchstart = stopBubble;
            sheet.ontouchend = stopBubble;
            sheet.ontouchmove = stopBubble;
        }

        this.bindTabs();
        this.bindChatChips();
        this.bindChatInput();
        this.bindCustomPicker();
        this.bindCreatorLinks();
        this.checkAvatarAvailability();
    }

    /**
     * GRAVITYユーザーアバター画像の存在確認と「マイアイコン」ボタンの活性化
     */
    checkAvatarAvailability() {
        const btnAvatar = document.getElementById('btn-face-avatar');
        const imgAvatar = document.getElementById('avatar-preview-img');
        if (!btnAvatar || !imgAvatar) return;

        const portraitUrl = (window.NetworkManager && window.NetworkManager.myUser && window.NetworkManager.myUser.portrait)
            ? window.NetworkManager.myUser.portrait
            : '';

        if (portraitUrl) {
            imgAvatar.src = portraitUrl;
            btnAvatar.style.display = 'flex';

            if (!window.userAvatarImgInstance) {
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.src = portraitUrl;
                window.userAvatarImgInstance = img;
            }
        }
    }

    toggle() {
        if (this.isOpen) {
            this.close();
        } else {
            this.checkAvatarAvailability();
            // メニュー展開時に走者一覧を最新スロット情報で再同期
            if (window.NetworkManager && Array.isArray(window.NetworkManager.slots)) {
                this.updateParticipants(window.NetworkManager.slots);
            }
            this.open();
        }
    }

    open() {
        this.isOpen = true;
        const sheet = document.getElementById('bottom-sheet');
        const overlay = document.getElementById('menu-overlay');
        if (overlay) {
            overlay.style.display = 'block';
            overlay.style.pointerEvents = 'auto'; // 背景タップを受け付けられるように有効化
        }
        if (sheet) {
            requestAnimationFrame(() => sheet.classList.add('open'));
        }
    }

    close() {
        this.isOpen = false;
        const sheet = document.getElementById('bottom-sheet');
        const overlay = document.getElementById('menu-overlay');
        const likeAnchor = document.getElementById('like-guide-anchor');

        if (sheet) sheet.classList.remove('open');
        if (likeAnchor) likeAnchor.classList.remove('show');

        setTimeout(() => {
            if (!this.isOpen && overlay) {
                overlay.style.display = 'none';
                overlay.style.pointerEvents = 'none';
            }
        }, 280);
    }

    switchTab(tabName) {
        this.currentTab = tabName;

        document.querySelectorAll('.sheet-tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabName);
        });
        document.querySelectorAll('.sheet-tab-content').forEach(content => {
            content.style.display = content.id === `tab-pane-${tabName}` ? 'block' : 'none';
        });

        // 「走者」タブが開かれた際、常に最新のスロット情報を即時再評価
        if (tabName === 'players' && window.NetworkManager && Array.isArray(window.NetworkManager.slots)) {
            this.updateParticipants(window.NetworkManager.slots);
        }

        // 「製作者」タブの時のみ、右上の「↑」直下に分離型いいね誘導アンカーを表示
        const likeAnchor = document.getElementById('like-guide-anchor');
        if (likeAnchor) {
            if (tabName === 'creator') {
                likeAnchor.classList.add('show');
            } else {
                likeAnchor.classList.remove('show');
            }
        }
    }

    bindTabs() {
        const tabs = document.querySelectorAll('.sheet-tab-btn');
        tabs.forEach(tab => {
            tab.onclick = (e) => {
                e.stopPropagation();
                this.switchTab(tab.dataset.tab);
            };
        });
    }

    bindChatChips() {
        const chips = document.querySelectorAll('.chat-chip');
        chips.forEach(chip => {
            chip.onclick = (e) => {
                e.stopPropagation();
                const text = chip.innerText.trim();

                // 二重表示の根絶: NetworkManager.queueChat に一本化
                if (window.NetworkManager && typeof window.NetworkManager.queueChat === 'function') {
                    window.NetworkManager.queueChat(text);
                } else {
                    const myName = (window.localPlayerInstance && window.localPlayerInstance.name) ? window.localPlayerInstance.name : 'あなた';
                    Danmaku.push(myName, text, this.selectedColor);
                }
                this.close();
            };
        });
    }

    bindChatInput() {
        const inputEl = document.getElementById('chat-input-text');
        const btnSend = document.getElementById('btn-send-chat');

        const sendMsg = () => {
            if (!inputEl) return;
            const text = inputEl.value.trim();
            if (text.length > 0) {
                const safeText = text.slice(0, 15);

                // 二重表示の根絶: NetworkManager.queueChat に一本化
                if (window.NetworkManager && typeof window.NetworkManager.queueChat === 'function') {
                    window.NetworkManager.queueChat(safeText);
                } else {
                    const myName = (window.localPlayerInstance && window.localPlayerInstance.name) ? window.localPlayerInstance.name : 'あなた';
                    Danmaku.push(myName, safeText, this.selectedColor);
                }

                inputEl.value = '';
                inputEl.blur();
                this.close();
            }
        };

        if (btnSend) btnSend.onclick = (e) => { e.stopPropagation(); sendMsg(); };
        if (inputEl) {
            inputEl.onkeydown = (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    sendMsg();
                }
            };
        }
    }

    bindCustomPicker() {
        // 顔選択（SVG表情アイコンプレビューボタン ＆ マイアイコン）
        const faceBtns = document.querySelectorAll('.custom-face-btn');
        faceBtns.forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                faceBtns.forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                this.selectedFace = btn.dataset.face;
                if (this.onCustomChange) this.onCustomChange(this.selectedFace, this.selectedColor);
            };
        });

        // カラー選択（8色）
        const colorBtns = document.querySelectorAll('.custom-color-btn');
        colorBtns.forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                colorBtns.forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                this.selectedColor = btn.dataset.color;
                if (this.onCustomChange) this.onCustomChange(this.selectedFace, this.selectedColor);
            };
        });
    }

    bindCreatorLinks() {
        const linkCreator = document.getElementById('link-creator-profile');
        const linkDev = document.getElementById('link-dev-news');

        if (linkCreator) {
            linkCreator.onclick = (e) => {
                e.stopPropagation();
                GravityRouter.openProfile(CREATOR_MAIN_INTERNAL_UID);
            };
        }
        if (linkDev) {
            linkDev.onclick = (e) => {
                e.stopPropagation();
                GravityRouter.openProfile(CREATOR_SUB_INTERNAL_UID);
            };
        }
    }

    /**
     * 走者一覧の更新
     */
    updateParticipants(playerList) {
        const listContainer = document.getElementById('participants-list');
        const tabCount = document.getElementById('players-tab-count');
        if (!listContainer) return;

        const netMgr = (typeof window !== 'undefined' && window.NetworkManager) ? window.NetworkManager : null;
        const slotsSource = (netMgr && Array.isArray(netMgr.slots))
            ? netMgr.slots
            : (Array.isArray(playerList) ? playerList : []);

        let humanCount = 0;
        for (let i = 0; i < MAX_PLAYERS; i++) {
            const slot = slotsSource[i];
            if (slot && !slot.isAI) {
                humanCount++;
            }
        }
        if (humanCount === 0) humanCount = 1;

        if (tabCount) {
            tabCount.innerText = `(${humanCount}/${MAX_PLAYERS})`;
        }

        const isNetHost = netMgr ? Boolean(netMgr.isHost) : false;
        const mySlot = netMgr ? netMgr.mySlot : 0;
        const myUserId = (netMgr && netMgr.myUser) ? String(netMgr.myUser.user_id) : 'local_user';

        const signature = slotsSource.slice(0, MAX_PLAYERS).map(s => {
            if (!s) return 'empty';
            return `${s.slot}_${s.userId || ''}_${s.name || ''}_${s.portrait || ''}_${s.isAI}_${s.isHost || false}`;
        }).join('|') + `_host:${isNetHost}_mySlot:${mySlot}`;

        if (signature === this._lastParticipantSignature && listContainer.children.length === MAX_PLAYERS) {
            return;
        }
        this._lastParticipantSignature = signature;

        listContainer.innerHTML = '';

        for (let i = 0; i < MAX_PLAYERS; i++) {
            const slotData = slotsSource[i];
            const isAssigned = slotData && !slotData.isAI;
            const isMe = isAssigned && (slotData.slot === mySlot || String(slotData.userId) === myUserId);

            let isCurrentHost = false;
            if (isAssigned) {
                if (isMe) {
                    isCurrentHost = isNetHost;
                } else if (slotData.isHost !== undefined) {
                    isCurrentHost = Boolean(slotData.isHost);
                } else {
                    isCurrentHost = (i === 0 && !isNetHost);
                }
            }

            const slotColor = (slotData && slotData.color) ? slotData.color : SNAKE_COLORS[i % SNAKE_COLORS.length];
            const displayName = isAssigned 
                ? (slotData.name || (isCurrentHost ? 'ホスト' : `プレイヤー ${i + 1}`))
                : `CPU ${i + 1} (空き枠)`;
            const portraitUrl = isAssigned ? (slotData.portrait || '') : '';
            const targetUid = isAssigned ? slotData.userId : null;

            const row = document.createElement('div');
            row.className = 'participant-row';
            row.style.cssText = `
                display: flex;
                align-items: center;
                background: ${isAssigned ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.04)'};
                border: 1px solid ${isAssigned ? (isMe ? 'rgba(0, 229, 255, 0.5)' : 'rgba(255, 255, 255, 0.2)') : 'rgba(255, 255, 255, 0.08)'};
                border-radius: 10px;
                padding: 8px 12px;
                margin-bottom: 6px;
                cursor: ${isAssigned && targetUid && targetUid !== 'local_user' ? 'pointer' : 'default'};
                transition: background 0.15s, border-color 0.15s;
            `;

            let avatarHtml = '';
            if (portraitUrl) {
                avatarHtml = `
                    <img src="${portraitUrl}" alt="Avatar" style="
                        width: 36px;
                        height: 36px;
                        border-radius: 50%;
                        object-fit: cover;
                        border: 2px solid ${slotColor};
                        margin-right: 10px;
                        flex-shrink: 0;
                    ">
                `;
            } else {
                const badgeInitial = isAssigned ? displayName.charAt(0) : 'CPU';
                avatarHtml = `
                    <div class="participant-avatar" style="
                        width: 36px;
                        height: 36px;
                        border-radius: 50%;
                        background-color: ${isAssigned ? slotColor : 'rgba(255, 255, 255, 0.12)'};
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        color: #ffffff;
                        font-weight: 800;
                        font-size: ${isAssigned ? '14px' : '10px'};
                        margin-right: 10px;
                        flex-shrink: 0;
                        border: 1.5px solid ${isAssigned ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.1)'};
                    ">
                        ${badgeInitial}
                    </div>
                `;
            }

            const hostBadgeHtml = isCurrentHost && isAssigned
                ? `<span style="font-size: 10px; font-weight: 800; color: #fde047; background: rgba(250, 204, 21, 0.2); border: 1px solid rgba(250, 204, 21, 0.5); padding: 1px 5px; border-radius: 4px; margin-left: 6px;">HOST</span>`
                : '';
            
            const meBadgeHtml = isMe
                ? `<span style="font-size: 10px; font-weight: 800; color: #38bdf8; margin-left: 4px;">(あなた)</span>`
                : '';

            const statusHtml = isAssigned
                ? `<div class="participant-status" style="color: #34d399; font-size: 11px; margin-top: 2px;">● プレイ中</div>`
                : `<div class="participant-status" style="color: #94a3b8; font-size: 11px; margin-top: 2px;">○ 自動参戦中</div>`;

            const actionArrowHtml = isAssigned && targetUid && targetUid !== 'local_user'
                ? `<div class="participant-arrow" style="color: #38bdf8; font-size: 16px; font-weight: bold; margin-left: 8px;">↗</div>`
                : `<div class="participant-arrow" style="color: rgba(255,255,255,0.2); font-size: 14px; margin-left: 8px;">-</div>`;

            row.innerHTML = `
                ${avatarHtml}
                <div class="participant-info" style="flex: 1; text-align: left; overflow: hidden;">
                    <div class="participant-name" style="color: ${isAssigned ? '#ffffff' : '#94a3b8'}; font-size: 13px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center;">
                        <span>${displayName}</span>
                        ${meBadgeHtml}
                        ${hostBadgeHtml}
                    </div>
                    ${statusHtml}
                </div>
                ${actionArrowHtml}
            `;

            if (isAssigned && targetUid && targetUid !== 'local_user' && targetUid !== 'null' && String(targetUid).trim() !== '') {
                row.onclick = (e) => {
                    e.stopPropagation();
                    GravityRouter.openProfile(targetUid);
                };
            }

            listContainer.appendChild(row);
        }
    }
}

export const Menu = new MenuManager();