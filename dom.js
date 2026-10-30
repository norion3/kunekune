/**
 * ==============================================================================
 * 『くねくねバトル オンライン』自律DOMマウントモジュール (dom.js)
 * Phase 3 改訂:
 * ・ボトムシートメニューDOM（4タブ均等・CHATチップ・走者・CUSTOM・製作者）
 * ・ニコニコ風弾幕チャットコンテナ（#danmaku-container）
 * ・右上いいね誘導吹き出し（#like-bubble）
 * ==============================================================================
 */

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
        <!-- 上部HUD -->
        <div id="hud">
            <div class="hud-group" style="position: relative;">
                <button id="btn-rank" class="hud-btn">RANKING</button>
                <div id="stats-box" class="stats-box" style="display: none;">
                    <div>順位: <span id="val-rank" style="color:#ffdd00; font-weight:bold;">1</span> / <span id="val-total">50</span></div>
                    <div>スコア: <span id="val-score" style="color:#00e5ff; font-weight:bold;">0</span></div>
                </div>
            </div>

            <div class="hud-group">
                <button id="btn-map" class="hud-btn">MAP: ON</button>
            </div>
        </div>

        <!-- 右上「…」直下 いいね誘導吹き出し（製作者タブ連動・実機完全準拠） -->
        <div id="like-bubble">メニューから「❤️いいね」してね！</div>

        <!-- 左下：サウンドボタン -->
        <div id="btn-sound">
            <svg id="icon-sound-off" viewBox="0 0 24 24">
                <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
            </svg>
            <svg id="icon-sound-on" viewBox="0 0 24 24" style="display: none;">
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
            </svg>
        </div>

        <!-- 右下2連ボタン -->
        <!-- 1. BOOSTボタン（最上段：親指スイートスポット・下から168px） -->
        <div id="btn-boost">
            <svg viewBox="0 0 24 24">
                <path d="M13 6l6 6-6 6M5 6l6 6-6 6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
            </svg>
        </div>

        <!-- 2. MENUボタン（中段：下から86px） -->
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

    // 4. ボトムシートメニュー ＆ オーバーレイ
    const menuOverlay = document.createElement('div');
    menuOverlay.id = 'menu-overlay';
    menuOverlay.innerHTML = `
        <div id="bottom-sheet">
            <div class="sheet-drag-handle"></div>
            <div class="sheet-header">
                <div class="sheet-title">GAME MENU</div>
                <div id="btn-close-menu" class="sheet-close-btn">✕</div>
            </div>

            <!-- 4タブ均等グリッドバー -->
            <div class="sheet-tabs">
                <button class="sheet-tab-btn active" data-tab="chat">💬 CHAT</button>
                <button class="sheet-tab-btn" data-tab="players">👥 走者 <span id="players-tab-count">(1)</span></button>
                <button class="sheet-tab-btn" data-tab="custom">🎨 CUSTOM</button>
                <button class="sheet-tab-btn" data-tab="creator">+ 製作者</button>
            </div>

            <!-- タブ1: CHAT -->
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

            <!-- タブ2: 走者 -->
            <div id="tab-pane-players" class="sheet-tab-content" style="display: none;">
                <div id="participants-list" class="participants-list"></div>
            </div>

            <!-- タブ3: CUSTOM -->
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

                    <div class="custom-label" style="margin-top: 6px;">カラー</div>
                    <div class="custom-row">
                        <div class="custom-color-btn selected" style="background-color: #00e5ff;" data-color="#00e5ff"></div>
                        <div class="custom-color-btn" style="background-color: #ff3366;" data-color="#ff3366"></div>
                        <div class="custom-color-btn" style="background-color: #ccff33;" data-color="#ccff33"></div>
                        <div class="custom-color-btn" style="background-color: #ff9933;" data-color="#ff9933"></div>
                        <div class="custom-color-btn" style="background-color: #cc66ff;" data-color="#cc66ff"></div>
                    </div>
                </div>
            </div>

            <!-- タブ4: 製作者 (image_12完全準拠) -->
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

    // 5. ローダーのスピナーを消去
    const loaderShield = document.getElementById('loader-shield');
    if (loaderShield) {
        loaderShield.style.transition = 'opacity 0.25s ease';
        loaderShield.style.opacity = '0';
        setTimeout(() => {
            if (loaderShield.parentNode) loaderShield.parentNode.removeChild(loaderShield);
        }, 250);
    }
}