/**
 * ==============================================================================
 * 『くねくねバトル オンライン』ボトムシートメニュー ＆ ルーター (menu.js)
 * v20.10.0 分離型いいね誘導＆顔プレビュー対応版:
 * ・右上の共有 [↑] ボタン直下の分離型いいね誘導アンカー (#like-guide-anchor) 制御
 * ・チャット送信時の Danmaku.push 重複呼び出し撤廃（一本化により二重表示バグ根絶）
 * ・走者一覧の変更検知差分更新（不要な DOM 破棄・ガタつき完全防止）
 * ・シート内スクロールと背景操作貫通遮断 (stopPropagation) の完全両立
 * ・GRAVITYネイティブ安全起動ルーター (GravityRouter: 非表示iframeキック)
 * ==============================================================================
 */

import { CREATOR_MAIN_INTERNAL_UID, CREATOR_SUB_INTERNAL_UID, SNAKE_COLORS } from './constants.js';
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
    }

    toggle() {
        if (this.isOpen) {
            this.close();
        } else {
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

        // ★「製作者」タブの時のみ、右上の「↑」直下に分離型いいね誘導アンカーを表示
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
        // 顔選択（SVG表情アイコンプレビューボタン）
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

    updateParticipants(playerList) {
        const listContainer = document.getElementById('participants-list');
        const tabCount = document.getElementById('players-tab-count');
        if (!listContainer) return;

        const list = Array.isArray(playerList) ? playerList : [];
        const count = list.length > 0 ? list.length : 1;
        if (tabCount) tabCount.innerText = `(${count})`;

        const signature = list.map(p => `${p.userId}_${p.name}_${p.color}`).join('|');
        if (signature === this._lastParticipantSignature && listContainer.children.length > 0) {
            return;
        }
        this._lastParticipantSignature = signature;

        listContainer.innerHTML = '';
        if (list.length === 0) {
            listContainer.innerHTML = '<div style="font-size:12px;color:rgba(255,255,255,0.6);padding:12px;text-align:center;">走者はいません</div>';
            return;
        }

        list.forEach(p => {
            const row = document.createElement('div');
            row.className = 'participant-row';
            row.innerHTML = `
                <div class="participant-avatar" style="background-color: ${p.color || '#00e5ff'};">
                    ${(p.name || 'P').charAt(0)}
                </div>
                <div class="participant-info">
                    <div class="participant-name">${p.name || 'プレイヤー'}</div>
                    <div class="participant-status">● プレイ中</div>
                </div>
                <div class="participant-arrow">↗</div>
            `;
            row.onclick = (e) => {
                e.stopPropagation();
                if (p.userId && p.userId !== 'local_user') {
                    GravityRouter.openProfile(p.userId);
                }
            };
            listContainer.appendChild(row);
        });
    }
}

export const Menu = new MenuManager();