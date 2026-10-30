/**
 * ==============================================================================
 * 『くねくねバトル オンライン』自律DOMマウントモジュール (dom.js)
 * Phase 2 改訂:
 * ・サウンドボタンを左下へ再配置
 * ・右下はMENUとBOOSTのみに整理し、「ルーム招待 ⇧」との共存性を最大化
 * ==============================================================================
 */

export function mountDOM() {
    if (document.getElementById('game-canvas')) return;

    // 1. メインゲームCanvas
    const canvas = document.createElement('canvas');
    canvas.id = 'game-canvas';
    document.body.appendChild(canvas);

    // 2. UIレイヤーコンテナ
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

        <!-- 左下：サウンドボタン（初期MUTE・ベクターSVG・絵文字ゼロ） -->
        <div id="btn-sound">
            <svg id="icon-sound-off" viewBox="0 0 24 24">
                <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
            </svg>
            <svg id="icon-sound-on" viewBox="0 0 24 24" style="display: none;">
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
            </svg>
        </div>

        <!-- 右下2連ボタン（親アプリの「ルーム招待 ⇧」完全回避レイアウト） -->
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

    // 3. ローダーのスピナーを消去
    const loaderShield = document.getElementById('loader-shield');
    if (loaderShield) {
        loaderShield.style.transition = 'opacity 0.25s ease';
        loaderShield.style.opacity = '0';
        setTimeout(() => {
            if (loaderShield.parentNode) loaderShield.parentNode.removeChild(loaderShield);
        }, 250);
    }
}