/**
 * ==============================================================================
 * 『くねくねバトル オンライン』iOS WebKit & iPhone 干渉完全マスクスタイル (style.js)
 * JavaScriptフォーマットによる動的スタイル注入（CSSキャッシュ事故完全防止）
 * ==============================================================================
 */

export function injectStyles() {
    if (document.getElementById('kunekune-style')) return;

    const styleEl = document.createElement('style');
    styleEl.id = 'kunekune-style';
    styleEl.textContent = `
        *, *::before, *::after {
            box-sizing: border-box;
            user-select: none;
            -webkit-user-select: none;
            -webkit-touch-callout: none;
            -webkit-tap-highlight-color: transparent;
        }

        html, body {
            margin: 0;
            padding: 0;
            width: 100%;
            height: 100%;
            background-color: #0b051a;
            overflow: hidden;
            position: fixed; /* iOSのオーバースクロール・バウンスを遮断 */
            font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', 'Hiragino Kaku Gothic ProN', sans-serif;
        }

        #game-canvas {
            display: block;
            width: 100%;
            height: 100%;
            touch-action: none; /* ブラウザ標準のパン・ピンチズームを遮断 */
        }

        #ui-layer {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 10;
        }

        /* 動的セーフエリア変数（main.js で環境検知して更新） */
        :root {
            --safe-top: 104px;       /* GRAVITY実機ヘッダー直下 */
            --safe-side: 16px;
            --safe-bottom: 24px;
        }

        /* --- 上部HUD --- */
        #hud {
            position: absolute;
            top: var(--safe-top);
            left: var(--safe-side);
            right: var(--safe-side);
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            pointer-events: none;
            transition: top 0.2s ease;
        }

        .hud-group {
            display: flex;
            align-items: center;
            gap: 8px;
            pointer-events: auto;
        }

        .hud-btn {
            background: rgba(15, 23, 42, 0.75);
            color: #ffffff;
            border: 1px solid rgba(255, 255, 255, 0.25);
            border-radius: 8px;
            padding: 6px 12px;
            font-size: 13px;
            font-weight: 700;
            letter-spacing: 0.5px;
            cursor: pointer;
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
            transition: background 0.2s, transform 0.1s;
        }
        .hud-btn:active {
            transform: scale(0.94);
            background: rgba(30, 41, 59, 0.9);
        }

        .stats-box {
            position: absolute;
            top: 40px;
            left: 0;
            background: rgba(15, 23, 42, 0.85);
            border: 1px solid rgba(0, 229, 255, 0.4);
            border-radius: 10px;
            padding: 8px 12px;
            color: white;
            font-size: 12px;
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            box-shadow: 0 6px 20px rgba(0, 0, 0, 0.6);
            min-width: 140px;
        }

        /* ==========================================================================
           右下3連ボタンレイアウト（親アプリの「ルーム招待 ⇧」完全回避）
           ========================================================================== */

        /* 1. BOOSTボタン（最上段：親指スイートスポット・下から168px） */
        #btn-boost {
            position: absolute;
            bottom: calc(var(--safe-bottom) + 144px);
            right: 20px;
            width: 66px;
            height: 66px;
            border-radius: 50%;
            background: radial-gradient(circle, rgba(15, 23, 42, 0.9) 0%, rgba(2, 6, 23, 0.95) 100%);
            border: 2px solid #00e5ff;
            color: #00e5ff;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            pointer-events: auto;
            box-shadow: 0 0 15px rgba(0, 229, 255, 0.35), inset 0 0 10px rgba(0, 229, 255, 0.2);
            transition: transform 0.1s, border-color 0.2s, box-shadow 0.2s;
            cursor: pointer;
            z-index: 50;
        }
        #btn-boost svg {
            width: 28px;
            height: 28px;
            fill: #00e5ff;
            filter: drop-shadow(0 0 4px #00e5ff);
            transition: transform 0.1s;
        }
        #btn-boost.active {
            transform: scale(0.92);
            border-color: #ff0055;
            box-shadow: 0 0 25px rgba(255, 0, 85, 0.8), inset 0 0 15px rgba(255, 0, 85, 0.4);
        }
        #btn-boost.active svg {
            fill: #ff0055;
            filter: drop-shadow(0 0 6px #ff0055);
            transform: scale(1.15);
        }

        /* 2. MENUボタン（中段：下から86px） */
        #btn-menu {
            position: absolute;
            bottom: calc(var(--safe-bottom) + 62px);
            right: 16px;
            width: 48px;
            height: 48px;
            border-radius: 50%;
            background: linear-gradient(135deg, #00b4d8, #0077b6);
            border: 1.5px solid rgba(255, 255, 255, 0.8);
            color: white;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            font-size: 9px;
            font-weight: 900;
            pointer-events: auto;
            box-shadow: 0 4px 14px rgba(0, 119, 182, 0.5);
            cursor: pointer;
            z-index: 50;
        }
        #btn-menu svg {
            width: 18px;
            height: 18px;
            fill: white;
            margin-bottom: 1px;
        }
        #btn-menu:active {
            transform: scale(0.92);
        }

        /* 3. サウンドボタン（最下段：下から24px・初期MUTE・ベクターSVG） */
        #btn-sound {
            position: absolute;
            bottom: var(--safe-bottom);
            right: 16px;
            width: 44px;
            height: 44px;
            border-radius: 50%;
            background: rgba(15, 23, 42, 0.85);
            border: 1.5px solid rgba(255, 255, 255, 0.3);
            color: white;
            display: flex;
            align-items: center;
            justify-content: center;
            pointer-events: auto;
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
            cursor: pointer;
            z-index: 50;
        }
        #btn-sound svg {
            width: 20px;
            height: 20px;
            fill: #94a3b8;
        }
        #btn-sound.sound-on svg {
            fill: #00e5ff;
            filter: drop-shadow(0 0 5px rgba(0, 229, 255, 0.6));
        }

        /* --- バーチャルジョイスティック --- */
        #joystick-base {
            display: none;
            position: absolute;
            width: 90px;
            height: 90px;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.1);
            border: 2px solid rgba(255, 255, 255, 0.3);
            pointer-events: none;
            transform: translate(-50%, -50%);
            z-index: 40;
        }
        #joystick-knob {
            position: absolute;
            top: 50%;
            left: 50%;
            width: 36px;
            height: 36px;
            border-radius: 50%;
            background: rgba(0, 229, 255, 0.8);
            box-shadow: 0 0 10px rgba(0, 229, 255, 0.6);
            transform: translate(-50%, -50%);
            pointer-events: none;
        }

        /* --- エントリーシールド --- */
        #entry-shield {
            position: absolute;
            top: 0; left: 0; width: 100%; height: 100%;
            background: #0b051a;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            z-index: 9999;
            transition: opacity 0.3s ease;
        }
        .spinner {
            width: 44px;
            height: 44px;
            border: 3px solid rgba(0, 229, 255, 0.2);
            border-top-color: #00e5ff;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
        }
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
        .shield-text {
            color: #00e5ff;
            font-size: 14px;
            font-weight: 700;
            letter-spacing: 2px;
            margin-top: 16px;
        }
    `;
    document.head.appendChild(styleEl);
}