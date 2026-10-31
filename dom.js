// ==============================================================================
// 『くねくねバトル オンライン』自律DOMマウントモジュール (dom.js)
// v20.9.0 UIクリーン化＆ユーザーネーム同期版:
// ・ランキングパネルヘッダーの不要な「SCORE:」表示を完全撤去（「順位: ○ / ○」のみに統一）
// ・GRAVITYユーザーネーム即時同期メソッド (updateLobbyGreeting) を配備
// ・main.js から要求される EntryShield (通信中保護画面) 完全実装
// ・左下SVGボタングループ ＆ 右下MENU底辺完全統一配置
// ==============================================================================

import { SNAKE_COLORS } from './constants.js';

// ==============================================================================
// 接続中・非同期処理保護オーバーレイ (EntryShield)
// 非同期処理中（ルーム作成・入退室等）のユーザー誤操作・連打をロック
// ==============================================================================
export const EntryShield = {
    el: null,
    titleEl: null,
    subEl: null,

    ensure() {
        if (this.el) return;
        this.el = document.createElement('div');
        this.el.id = 'entry-shield-overlay';
        this.el.style.cssText = `
            display: none;
            position: fixed;
            inset: 0;
            background: rgba(11, 5, 26, 0.85);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            z-index: 9999;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            color: #ffffff;
            pointer-events: auto;
        `;
        this.el.innerHTML = `
            <div style="
                width: 44px;
                height: 44px;
                border: 3px solid rgba(0, 229, 255, 0.2);
                border-top-color: #00e5ff;
                border-radius: 50%;
                animation: entry-spin 0.8s linear infinite;
                margin-bottom: 16px;
            "></div>
            <style>
                @keyframes entry-spin { to { transform: rotate(360deg); } }
            </style>
            <div id="entry-shield-title" style="font-size: 16px; font-weight: 800; color: #00e5ff; letter-spacing: 1px;">CONNECTING...</div>
            <div id="entry-shield-sub" style="font-size: 12px; color: #bae6fd; margin-top: 6px;">通信中...</div>
        `;
        document.body.appendChild(this.el);
        this.titleEl = document.getElementById('entry-shield-title');
        this.subEl = document.getElementById('entry-shield-sub');
    },

    show(title = 'CONNECTING...', sub = '通信処理中...') {
        this.ensure();
        if (this.titleEl) this.titleEl.innerText = title;
        if (this.subEl) this.subEl.innerText = sub;
        this.el.style.display = 'flex';
    },

    hide() {
        if (this.el) {
            this.el.style.display = 'none';
        }
    }
};

/**
 * ロビー画面のユーザー名表示を即時更新する関数
 */
export function updateLobbyGreeting(userName) {
    const greetingEl = document.getElementById('lobby-greeting');
    if (greetingEl && userName && userName !== 'あなた') {
        greetingEl.innerHTML = `ようこそ <strong style="color:#ffdd00;">${userName}</strong> さん`;
    }
}

export function mountDOM() {
    if (document.getElementById('game-canvas')) return;

    // 1. メインゲームCanvas
    const canvas = document.createElement('canvas');
    canvas.id = 'game-canvas';
    document.body.appendChild(canvas);

    // 2. 弾幕チャットレイヤー
    const danmakuContainer = document.createElement('div');
    danmakuContainer.id = 'danmaku-container';
    document.body.appendChild(danmakuContainer);

    // 3. UIレイヤーコンテナ
    const uiLayer = document.createElement('div');
    uiLayer.id = 'ui-layer';
    uiLayer.innerHTML = `
        <!-- 左上：ランキング展開パネル（★ SCORE表示を撤去し順位のみに統一） -->
        <div id="stats-box" style="display: none;">
            <div class="stats-header-row">
                <span>順位: <strong id="val-rank" style="color:#ffdd00; font-size:15px;">1</strong> / <span id="val-total">50</span></span>
            </div>
            <hr>
            <div id="leaderboard-list"></div>
        </div>

        <!-- 右上「…」直下 いいね誘導吹き出し -->
        <div id="like-bubble">メニューから「❤️いいね」してね！</div>

        <!-- 左下ボタングループ（ズーム＋/ー、サウンド、ランキング、マップ） -->
        <div class="bottom-left-group">
            <!-- 縦並びズーム（＋/ー）ボタン -->
            <div class="zoom-controls-col">
                <button id="btn-zoom-in" type="button" class="btn-zoom" aria-label="Zoom In">
                    <svg viewBox="0 0 24 24">
                        <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
                    </svg>
                </button>
                <button id="btn-zoom-out" type="button" class="btn-zoom" aria-label="Zoom Out">
                    <svg viewBox="0 0 24 24">
                        <path d="M19 13H5v-2h14v2z"/>
                    </svg>
                </button>
            </div>

            <!-- サウンドON/OFFトグル（SVGスピーカー） -->
            <button id="btn-sound" type="button" class="bottom-round-btn" aria-label="Toggle Sound">
                <svg id="icon-sound-off" viewBox="0 0 24 24">
                    <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
                </svg>
                <svg id="icon-sound-on" viewBox="0 0 24 24" style="display: none;">
                    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
                </svg>
            </button>

            <!-- ランキングON/OFFトグル（SVGトロフィー） -->
            <button id="btn-toggle-ranking" type="button" class="bottom-round-btn" aria-label="Toggle Ranking">
                <svg viewBox="0 0 24 24">
                    <path d="M19 5h-2V3H7v2H5c-1.1 0-2 .9-2 2v1c0 2.55 1.92 4.63 4.39 4.94A5.01 5.01 0 0 0 11 15.9V19H7v2h10v-2h-4v-3.1c1.78-.37 3.22-1.75 3.61-3.96C19.08 11.63 21 9.55 21 7V5h-2zm-14 3V7h2v3.8c-1.21-.39-2-1.48-2-2.8zm12 2.8V7h2v1c0 1.32-.79 2.41-2 2.8z"/>
                </svg>
            </button>

            <!-- レーダーON/OFFトグル（SVGグリッドマップ） -->
            <button id="btn-toggle-map" type="button" class="bottom-round-btn active" aria-label="Toggle Map">
                <svg viewBox="0 0 24 24">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
                </svg>
            </button>
        </div>

        <!-- 右下：BOOST（下から168px） ＆ MENU（下から24px・底辺完全一致） -->
        <div id="btn-boost">
            <svg viewBox="0 0 24 24">
                <path d="M13 6l6 6-6 6M5 6l6 6-6 6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
            </svg>
        </div>

        <div id="btn-menu">
            <svg viewBox="0 0 24 24">
                <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
            </svg>
            MENU
        </div>

        <!-- 仮想ジョイスティック -->
        <div id="joystick-base">
            <div id="joystick-knob"></div>
        </div>
    `;
    document.body.appendChild(uiLayer);

    // 4. ボトムシートメニュー（全画面暗転・ブラー撤廃版）
    const menuOverlay = document.createElement('div');
    menuOverlay.id = 'menu-overlay';
    menuOverlay.innerHTML = `
        <div id="bottom-sheet">
            <div class="sheet-drag-handle"></div>
            <div class="sheet-header">
                <div class="sheet-title">GAME MENU</div>
                <div id="btn-close-menu" class="sheet-close-btn">✕</div>
            </div>

            <div class="sheet-tabs">
                <button class="sheet-tab-btn active" data-tab="chat">💬 CHAT</button>
                <button class="sheet-tab-btn" data-tab="players">👥 走者 <span id="players-tab-count">(1)</span></button>
                <button class="sheet-tab-btn" data-tab="custom">🎨 CUSTOM</button>
                <button class="sheet-tab-btn" data-tab="creator">+ 製作者</button>
            </div>

            <div id="tab-pane-chat" class="sheet-tab-content">
                <div style="font-size: 11px; color: rgba(255,255,255,0.7); text-align: left; margin-bottom: 8px;">タップで即送信</div>
                <div class="chat-chips-grid">
                    <div class="chat-chip">よろしく！</div>
                    <div class="chat-chip">ナイス！</div>
                    <div class="chat-chip">ありがとう！</div>
                    <div class="chat-chip">ごめんね！</div>
                    <div class="chat-chip">まってー！</div>
                    <div class="chat-chip">おつかれさま！</div>
                    <div class="chat-chip">ドンマイ！</div>
                    <div class="chat-chip">もう1回！</div>
                </div>
                <div class="chat-input-bar">
                    <input type="text" id="chat-input-text" class="chat-input-box" placeholder="メッセージを入力..." maxlength="15">
                    <button id="btn-send-chat" class="chat-send-btn">送信</button>
                </div>
            </div>

            <div id="tab-pane-players" class="sheet-tab-content" style="display: none;">
                <div id="participants-list" class="participants-list"></div>
            </div>

            <div id="tab-pane-custom" class="sheet-tab-content" style="display: none;">
                <div class="custom-panel">
                    <div class="custom-label">顔タイプ</div>
                    <div class="custom-row">
                        <button class="custom-face-btn selected" data-face="normal">ノーマル</button>
                        <button class="custom-face-btn" data-face="angry">いかり</button>
                        <button class="custom-face-btn" data-face="happy">にこにこ</button>
                        <button class="custom-face-btn" data-face="cool">クール</button>
                        <button class="custom-face-btn" data-face="cute">キュート</button>
                    </div>

                    <div class="custom-label" style="margin-top: 8px;">カラー（8色対応）</div>
                    <div class="custom-colors-grid">
                        ${SNAKE_COLORS.map((col, idx) => `
                            <div class="custom-color-btn ${idx === 0 ? 'selected' : ''}" style="background-color: ${col};" data-color="${col}"></div>
                        `).join('')}
                    </div>
                </div>
            </div>

            <div id="tab-pane-creator" class="sheet-tab-content" style="display: none;">
                <div class="creator-notice-card">
                    遊んでくれてありがとうございます！<br>
                    <strong style="color: #ffdd00;">楽しかったら右上の [...] から いいね を押してね</strong><br>
                    ご意見やご要望もお気軽にどうぞ！
                </div>
                <div id="link-creator-profile" class="creator-link-row">
                    <span>👤 製作者プロフィール</span>
                    <span>↗</span>
                </div>
                <div id="link-dev-news" class="creator-link-row">
                    <span>📢 ゲーム開発・告知</span>
                    <span>↗</span>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(menuOverlay);

    // 5. リザルト画面モーダル
    const overScreen = document.createElement('div');
    overScreen.id = 'over-screen';
    overScreen.innerHTML = `
        <div class="result-panel">
            <h2 class="result-title">GAME OVER</h2>
            <div class="result-stats-table">
                <div class="result-row">
                    <span class="result-row-label">最終順位</span>
                    <span id="res-rank" class="result-row-val">1 位</span>
                </div>
                <div class="result-row">
                    <span class="result-row-label">スコア</span>
                    <span id="res-score" class="result-row-val">0</span>
                </div>
                <div class="result-row">
                    <span class="result-row-label">撃破数</span>
                    <span id="res-kills" class="result-row-val">0</span>
                </div>
                <div class="result-row">
                    <span class="result-row-label">生存時間</span>
                    <span id="res-time" class="result-row-val">0 秒</span>
                </div>
                <div class="result-row">
                    <span class="result-row-label">最大サイズ</span>
                    <span id="res-size" class="result-row-val">0</span>
                </div>
            </div>
            <div class="result-actions">
                <button id="btn-retry" class="result-btn btn-retry">リトライ</button>
                <button id="btn-submit-score" class="result-btn btn-submit-score">得点送信</button>
            </div>
        </div>
    `;
    document.body.appendChild(overScreen);

    // 6. マルチプレイロビー画面
    const lobbyOverlay = document.createElement('div');
    lobbyOverlay.id = 'lobby-overlay';
    lobbyOverlay.innerHTML = `
        <div class="lobby-card">
            <div class="lobby-title">くねくねバトル</div>
            <div id="lobby-greeting" class="lobby-subtitle">ようこそ プレイヤー さん</div>

            <button id="btn-lobby-solo" type="button" class="btn-lobby-hero">▶ 1人で遊ぶ (ソロ)</button>

            <div class="lobby-btn-row">
                <button id="btn-lobby-public" type="button" class="btn-lobby-sub btn-green">公開ルーム作成</button>
                <button id="btn-lobby-private" type="button" class="btn-lobby-sub btn-teal">プライベート作成</button>
            </div>

            <div class="room-list-box">
                <div class="room-list-header">
                    <span>公開ルーム一覧</span>
                    <button id="btn-refresh-rooms" type="button" class="btn-refresh-mini">更新</button>
                </div>
                <div id="room-list-container" class="room-list-container">
                    <div class="room-list-empty">公開ルームはありません</div>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(lobbyOverlay);

    // 7. マッチング待機室画面
    const waitingOverlay = document.createElement('div');
    waitingOverlay.id = 'waiting-overlay';
    waitingOverlay.innerHTML = `
        <div class="waiting-card">
            <div id="waiting-room-tag" class="waiting-room-tag">ROOM #-----</div>
            <div class="waiting-title">マッチング待機中</div>
            <div class="waiting-divider"></div>
            <div id="waiting-members-list" class="waiting-members-list"></div>
            <button id="btn-waiting-start" type="button" class="btn-lobby-hero" style="display: none;">ゲーム開始</button>
            <button id="btn-waiting-leave" type="button" class="btn-waiting-leave">ロビーへ戻る</button>
        </div>
    `;
    document.body.appendChild(waitingOverlay);

    // 8. ローダースピナーの自動フェード消去
    const loaderShield = document.getElementById('loader-shield');
    if (loaderShield) {
        loaderShield.style.transition = 'opacity 0.25s ease';
        loaderShield.style.opacity = '0';
        setTimeout(() => {
            if (loaderShield.parentNode) loaderShield.parentNode.removeChild(loaderShield);
        }, 250);
    }
}