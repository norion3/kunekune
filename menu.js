/**
 * ==============================================================================
 * 『くねくねバトル オンライン』ボトムシートメニュー (menu.js)
 * v30.0.0 メニュー定型文＆チャットバッジ色カスタムカラー完全連動版:
 * ・【定型文チャット（chat-chip）バッジ色のカスタムカラー完全連動】
 * 　「よろしく！」「ごめんね！」等の定型文チップをタップした際、自画面の Danmaku.push
 * 　へ渡す badgeColor をシアン（#00e5ff）固定ではなく、Menu.selectedColor / player.color
 * 　を絶対最優先で解決して投入！自機が黄色・ピンクなど選んだ色と寸分違わず一致した
 * 　バッジ枠・背景で画面上を流れる演出を完全実現
 * ・【自由入力チャット（#btn-send-chat）バッジ色のカスタムカラー完全連動】
 * ・【マルチプレイ送信（NetworkManager.queueChat）とローカル弾幕の完全両立】
 * ・【「プレイヤ」表記への刷新＆ソロ・マルチ表示完全切り分け維持】
 * ・【スマホ画面でのタブ幅1行保持】white-space: nowrap と適正パディングで折り返しを完全防止
 * ・【走者アイコン枠線(淵)のカスタムカラー完全連動維持】
 * ・【自機カスタムカラーの即時優先反映維持】localPlayerInstance.color 優先参照
 * ・【メニュー外余白ドラッグ完全遮断維持】ラバーバンド現象遮断
 * ・【メニュー外タップ終了維持】背後余白タップでの即時クローズ
 * ・【誤閉塞完全防止維持】ボトムシート内部の stopPropagation()
 * ・【動的HOSTバッジ解決維持】ホスト昇格時のHOSTバッジ正確表示
 * ・GravityRouter 連携維持
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

            // ★ メニュー外の余白エリアをドラッグした際、画面全体が上に引っ張られて白地が露出するバウンスを完全遮断
            overlay.addEventListener('touchmove', (e) => {
                if (e.target === overlay) {
                    if (e.cancelable) e.preventDefault();
                    e.stopPropagation();
                }
            }, { passive: false });
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

        // 「プレイヤ」タブが開かれた際、常に最新のスロット情報を即時再評価
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
            // スマホ画面幅でタブ文字が2行に折り返されないようCSSを保護
            tab.style.whiteSpace = 'nowrap';
            tab.style.padding = '8px 4px';
            tab.style.fontSize = '11px';

            tab.onclick = (e) => {
                e.stopPropagation();
                this.switchTab(tab.dataset.tab);
            };
        });
    }

    // =========================================================================
    // ★ 【自機バッジ色解決ヘルパー：メニュー選択カスタムカラーを絶対最優先】
    // =========================================================================
    _resolveMyBadgeColor() {
        if (this.selectedColor) {
            return this.selectedColor;
        }
        const p = (typeof window !== 'undefined' && window.localPlayerInstance) ? window.localPlayerInstance : null;
        if (p && p.color) {
            return p.color;
        }
        const netMgr = (typeof window !== 'undefined' && window.NetworkManager) ? window.NetworkManager : null;
        if (netMgr && netMgr.slots && netMgr.slots[netMgr.mySlot] && netMgr.slots[netMgr.mySlot].color) {
            return netMgr.slots[netMgr.mySlot].color;
        }
        return SNAKE_COLORS[0];
    }

    bindChatChips() {
        const chips = document.querySelectorAll('.chat-chip');
        chips.forEach(chip => {
            chip.onclick = (e) => {
                e.stopPropagation();
                const text = chip.innerText.trim();
                if (!text) return;

                const myPlayer = (typeof window !== 'undefined' && window.localPlayerInstance) ? window.localPlayerInstance : null;
                const myName = (myPlayer && myPlayer.name) ? myPlayer.name : 'あなた';
                const badgeColor = this._resolveMyBadgeColor();

                // 1. 自端末画面へカスタムカラーのバッジで即時弾幕を流す
                Danmaku.push(myName, text, badgeColor);

                // 2. マルチプレイ中の場合、他端末へパケット送信キューイング
                if (window.NetworkManager && typeof window.NetworkManager.queueChat === 'function') {
                    const mySlot = window.NetworkManager.mySlot !== undefined ? window.NetworkManager.mySlot : 0;
                    window.NetworkManager.queueChat(mySlot, text);
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

                const myPlayer = (typeof window !== 'undefined' && window.localPlayerInstance) ? window.localPlayerInstance : null;
                const myName = (myPlayer && myPlayer.name) ? myPlayer.name : 'あなた';
                const badgeColor = this._resolveMyBadgeColor();

                // 1. 自端末画面へカスタムカラーのバッジで即時弾幕を流す
                Danmaku.push(myName, safeText, badgeColor);

                // 2. マルチプレイ中の場合、他端末へパケット送信キューイング
                if (window.NetworkManager && typeof window.NetworkManager.queueChat === 'function') {
                    const mySlot = window.NetworkManager.mySlot !== undefined ? window.NetworkManager.mySlot : 0;
                    window.NetworkManager.queueChat(mySlot, safeText);
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
     * プレイヤ一覧の更新（ソロプレイ／マルチプレイ完全切り分け対応）
     */
    updateParticipants(playerList) {
        const listContainer = document.getElementById('participants-list');
        const tabBtn = document.querySelector('.sheet-tab-btn[data-tab="players"]');
        if (!listContainer) return;

        const netMgr = (typeof window !== 'undefined' && window.NetworkManager) ? window.NetworkManager : null;
        const isMulti = netMgr ? Boolean(netMgr.isMultiplayerActive) : false;

        const slotsSource = (netMgr && Array.isArray(netMgr.slots))
            ? netMgr.slots
            : (Array.isArray(playerList) ? playerList : []);

        // =========================================================================
        // 1. タブ表記の更新（「👥 プレイヤ」への統一 ＆ ソロ/マルチ人数切り替え）
        // =========================================================================
        let humanCount = 0;
        if (isMulti) {
            for (let i = 0; i < MAX_PLAYERS; i++) {
                const slot = slotsSource[i];
                if (slot && !slot.isAI) {
                    humanCount++;
                }
            }
            if (humanCount === 0) humanCount = 1;
        } else {
            humanCount = 1;
        }

        if (tabBtn) {
            const countText = isMulti ? `(${humanCount}/${MAX_PLAYERS})` : `(1/1)`;
            tabBtn.innerHTML = `👥 プレイヤ <span id="players-tab-count">${countText}</span>`;
        }

        const isNetHost = netMgr ? Boolean(netMgr.isHost) : false;
        const mySlot = netMgr ? netMgr.mySlot : 0;
        const myUserId = (netMgr && netMgr.myUser) ? String(netMgr.myUser.user_id) : 'local_user';

        // 表示する最大スロット数：ソロ時は自機1行のみ、マルチ時は全6枠
        const targetSlotCount = isMulti ? MAX_PLAYERS : 1;

        // =========================================================================
        // 2. キャッシュ判定シグネチャ（ソロ/マルチ状態と各スロット色・状態を網羅）
        // =========================================================================
        const signature = `multi:${isMulti}_` + slotsSource.slice(0, targetSlotCount).map(s => {
            if (!s) return 'empty';
            return `${s.slot}_${s.userId || ''}_${s.name || ''}_${s.portrait || ''}_${s.color || ''}_${s.isAI}_${s.isHost || false}`;
        }).join('|') + `_host:${isNetHost}_mySlot:${mySlot}_customCol:${this.selectedColor}`;

        if (signature === this._lastParticipantSignature && listContainer.children.length === targetSlotCount) {
            return;
        }
        this._lastParticipantSignature = signature;

        listContainer.innerHTML = '';

        // =========================================================================
        // 3. リスト行の生成
        // =========================================================================
        for (let i = 0; i < targetSlotCount; i++) {
            const slotData = slotsSource[i];
            const isAssigned = isMulti ? (slotData && !slotData.isAI) : true;
            const isMe = isMulti ? (isAssigned && (slotData.slot === mySlot || String(slotData.userId) === myUserId)) : true;

            let isCurrentHost = false;
            if (isMulti && isAssigned) {
                if (isMe) {
                    isCurrentHost = isNetHost;
                } else if (slotData.isHost !== undefined) {
                    isCurrentHost = Boolean(slotData.isHost);
                } else {
                    isCurrentHost = (i === 0 && !isNetHost);
                }
            }

            // 自機の場合は選択された最新カラー、それ以外はスロットカラーをダイレクトに反映
            let slotColor = (slotData && slotData.color) ? slotData.color : SNAKE_COLORS[i % SNAKE_COLORS.length];
            if (isMe && this.selectedColor) {
                slotColor = this.selectedColor;
            } else if (isMe && window.localPlayerInstance && window.localPlayerInstance.color) {
                slotColor = window.localPlayerInstance.color;
            }

            // 表示名：空き枠は「プレイヤ X (空き枠)」
            let displayName = '';
            if (isMulti) {
                displayName = isAssigned 
                    ? (slotData.name || (isCurrentHost ? 'ホスト' : `プレイヤ ${i + 1}`))
                    : `プレイヤ ${i + 1} (空き枠)`;
            } else {
                displayName = (window.localPlayerInstance && window.localPlayerInstance.name) 
                    ? window.localPlayerInstance.name 
                    : (slotData && slotData.name ? slotData.name : 'あなた');
            }

            const portraitUrl = isAssigned ? (slotData ? (slotData.portrait || '') : '') : '';
            const targetUid = isAssigned ? (slotData ? slotData.userId : null) : null;

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

            // アイコン部分：空き枠は「+」バッジ、自機・他走者はカスタムカラー枠線
            let avatarHtml = '';
            if (portraitUrl) {
                avatarHtml = `
                    <img src="${portraitUrl}" alt="Avatar" style="
                        width: 36px;
                        height: 36px;
                        border-radius: 50%;
                        object-fit: cover;
                        border: 2.5px solid ${slotColor};
                        box-shadow: 0 0 6px ${slotColor}55;
                        margin-right: 10px;
                        flex-shrink: 0;
                    ">
                `;
            } else {
                const badgeInitial = isAssigned ? displayName.charAt(0) : '+';
                avatarHtml = `
                    <div class="participant-avatar" style="
                        width: 36px;
                        height: 36px;
                        border-radius: 50%;
                        background-color: ${isAssigned ? slotColor : 'rgba(255, 255, 255, 0.08)'};
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        color: ${isAssigned ? '#ffffff' : '#38bdf8'};
                        font-weight: 800;
                        font-size: ${isAssigned ? '14px' : '18px'};
                        margin-right: 10px;
                        flex-shrink: 0;
                        border: 2px solid ${isAssigned ? slotColor : 'rgba(56, 189, 248, 0.35)'};
                        box-shadow: ${isAssigned ? `0 0 6px ${slotColor}55` : 'none'};
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
                : `<div class="participant-status" style="color: #94a3b8; font-size: 11px; margin-top: 2px;">○ 募集中</div>`;

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