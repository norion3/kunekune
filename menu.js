/**
 * ==============================================================================
 * 『くねくねバトル オンライン』ボトムシートメニュー ＆ ルーター (menu.js)
 * v24.0.0 走者6枠固定確保 ＆ GRAVITYアバター・プロフ完全連携版:
 * ・シングル・マルチ共通：走者タブ内に最大定員6名分のスロット枠を常時整然と確保
 * ・GRAVITY公式アバター写真（portrait）の円形トリミング高精細表示
 * ・実走者タップ時のGRAVITYプロフィール画面安全起動（GravityRouter）
 * ・右上の共有 [↑] ボタン直下の分離型いいね誘導アンカー (#like-guide-anchor) 制御
 * ・チャット送信時の二重表示防止一本化 ＆ 走者タブの変更検知差分更新
 * ==============================================================================
 */

import {
    CREATOR_MAIN_INTERNAL_UID,
    CREATOR_SUB_INTERNAL_UID,
    SNAKE_COLORS,
    MAX_PLAYERS
} from './constants.js';

import { Danmaku } from './danmaku.js';

// GRAVITYネイティブ画面安全起動ルーター（Universal Links誤爆・404クラッシュ防止）
export const GravityRouter = {
    openProfile(internalUid) {
        if (!internalUid || internalUid === 'local_user') return;
        const cleanId = String(internalUid).replace(/[^0-9]/g, '');
        if (!cleanId) return;

        const paramObj = {
            uid: Number(cleanId),
            selectedIndex: 0,
            web_url: 'https://www.gravity.place/user/' + cleanId,
            s: 'web',
            b: 'user'
        };
        const innerUrl = 'usercenter?0=' + encodeURIComponent(JSON.stringify(paramObj));
        const deepLink = 'slme://internal?type=5&ani=1&url=' + encodeURIComponent(innerUrl);

        const iframe = document.createElement('iframe');
        iframe.style.cssText = 'position:absolute;width:0;height:0;opacity:0;pointer-events:none;display:none;';
        iframe.src = deepLink;
        document.body.appendChild(iframe);
        setTimeout(() => {
            if (document.body.contains(iframe)) document.body.removeChild(iframe);
        }, 1000);
    }
};

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

        if (overlay) {
            overlay.onclick = (e) => {
                if (e.target === overlay) this.close();
            };
        }

        if (sheet) {
            sheet.onclick = (e) => {
                e.stopPropagation();
            };
            sheet.ontouchstart = (e) => {
                e.stopPropagation();
            };
            sheet.ontouchend = (e) => {
                e.stopPropagation();
            };
            sheet.ontouchmove = (e) => {
                e.stopPropagation();
            };
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
        if (overlay) overlay.style.display = 'block';
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
            if (!this.isOpen && overlay) overlay.style.display = 'none';
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
     * ★ 走者一覧の更新：シングルでもマルチでも最大定員6名枠を常時確保し、
     *    GRAVITYアバター写真表示およびプロフィール遷移（↗）を完全連携
     */
    updateParticipants(playerList) {
        const listContainer = document.getElementById('participants-list');
        const tabCount = document.getElementById('players-tab-count');
        if (!listContainer) return;

        // 全スロット（スロット0〜5）の参照を取得
        const slotsSource = (window.NetworkManager && Array.isArray(window.NetworkManager.slots))
            ? window.NetworkManager.slots
            : (Array.isArray(playerList) ? playerList : []);

        // 参加中の人間プレイヤー数をカウント
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

        // 差分検知シグネチャ（不要なDOM再構築防止）
        const signature = slotsSource.slice(0, MAX_PLAYERS).map(s => {
            if (!s) return 'empty';
            return `${s.slot}_${s.userId || ''}_${s.name || ''}_${s.portrait || ''}_${s.isAI}`;
        }).join('|');

        if (signature === this._lastParticipantSignature && listContainer.children.length === MAX_PLAYERS) {
            return;
        }
        this._lastParticipantSignature = signature;

        listContainer.innerHTML = '';

        const myUserId = (window.NetworkManager && window.NetworkManager.myUser)
            ? String(window.NetworkManager.myUser.user_id)
            : 'local_user';
        const mySlot = (window.NetworkManager) ? window.NetworkManager.mySlot : 0;

        // スロット0〜5（最大6枠）を必ず固定描画
        for (let i = 0; i < MAX_PLAYERS; i++) {
            const slotData = slotsSource[i];
            const isAssigned = slotData && !slotData.isAI;
            const isMe = isAssigned && (slotData.slot === mySlot || String(slotData.userId) === myUserId);
            const isHost = i === 0;

            const slotColor = (slotData && slotData.color) ? slotData.color : SNAKE_COLORS[i % SNAKE_COLORS.length];
            const displayName = isAssigned 
                ? (slotData.name || (isHost ? 'ホスト' : `プレイヤー ${i + 1}`))
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

            // アバター表示：画像があれば高精細円形サムネイル、なければ頭文字/CPUバッジ
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

            // 情報カラム（名前・ステータス・HOSTバッジ）
            const hostBadgeHtml = isHost && isAssigned
                ? `<span style="font-size: 10px; font-weight: 800; color: #fde047; background: rgba(250, 204, 21, 0.2); border: 1px solid rgba(250, 204, 21, 0.5); padding: 1px 5px; border-radius: 4px; margin-left: 6px;">HOST</span>`
                : '';
            
            const meBadgeHtml = isMe
                ? `<span style="font-size: 10px; font-weight: 800; color: #38bdf8; margin-left: 4px;">(あなた)</span>`
                : '';

            const statusHtml = isAssigned
                ? `<div class="participant-status" style="color: #34d399; font-size: 11px; margin-top: 2px;">● プレイ中</div>`
                : `<div class="participant-status" style="color: #94a3b8; font-size: 11px; margin-top: 2px;">○ 自動参戦中</div>`;

            // アクションアイコン（実走者の場合はプロフィールジャンプ矢印 ↗）
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

            // 実在ユーザー行タップ時：GRAVITY公式プロフィール画面へ即時ジャンプ
            if (isAssigned && targetUid && targetUid !== 'local_user') {
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