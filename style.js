/**
 * ==============================================================================
 * 『くねくねバトル オンライン』iOS WebKit & iPhone 干渉完全マスクスタイル (style.js)
 * Phase 3 改訂:
 * ・ボトムシートメニュー（4タブ均等・スライドアップ・8大定型文チップ）
 * ・右上「…」直下いいね誘導吹き出し（▲アロー連動）
 * ・ニコニコ風弾幕チャットレイヤー（4レーン・バッジ表示）
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
            position: fixed;
            font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', 'Hiragino Kaku Gothic ProN', sans-serif;
        }

        #game-canvas {
            display: block;
            width: 100%;
            height: 100%;
            touch-action: none;
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

        :root {
            --safe-top: 104px;
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

        /* --- 操作ボタンレイアウト --- */
        #btn-boost {
            position: absolute;
            bottom: calc(var(--safe-bottom) + 144px);
            right: 20px;
            width: 66px;
            height: 66px;
            border-radius: 50%;
            background: radial-gradient(circle, rgba(15, 23, 42, 0.92) 0%, rgba(2, 6, 23, 0.96) 100%);
            border: 2px solid #00e5ff;
            color: #00e5ff;
            display: flex;
            align-items: center;
            justify-content: center;
            pointer-events: auto;
            box-shadow: 0 0 16px rgba(0, 229, 255, 0.35), inset 0 0 10px rgba(0, 229, 255, 0.2);
            transition: transform 0.1s, border-color 0.2s, box-shadow 0.2s;
            cursor: pointer;
            z-index: 50;
        }
        #btn-boost svg {
            width: 28px;
            height: 28px;
            stroke: #00e5ff;
            filter: drop-shadow(0 0 4px #00e5ff);
            transition: transform 0.1s;
        }
        #btn-boost.active {
            transform: scale(0.92);
            border-color: #ff0055;
            box-shadow: 0 0 25px rgba(255, 0, 85, 0.8), inset 0 0 15px rgba(255, 0, 85, 0.4);
        }
        #btn-boost.active svg {
            stroke: #ff0055;
            filter: drop-shadow(0 0 6px #ff0055);
            transform: scale(1.15);
        }

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

        #btn-sound {
            position: absolute;
            bottom: var(--safe-bottom);
            left: 16px;
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

        /* ==========================================================================
           ニコニコ風弾幕チャットシステム (danmaku.js)
           ========================================================================== */
        #danmaku-container {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            overflow: hidden;
            z-index: 100;
        }
        .danmaku-item {
            position: absolute;
            right: -100%;
            white-space: nowrap;
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 14px;
            font-weight: 700;
            color: #ffffff;
            text-shadow: 1px 1px 3px rgba(0, 0, 0, 0.9);
            animation: danmaku-fly 4.5s linear forwards;
            pointer-events: none;
        }
        .danmaku-badge {
            font-size: 10px;
            font-weight: 800;
            padding: 2px 7px;
            border-radius: 10px;
            color: #0b051a;
        }
        .danmaku-system {
            color: #ffdd00;
        }
        @keyframes danmaku-fly {
            0% { transform: translateX(0); left: 100%; }
            100% { transform: translateX(-200%); left: -50%; }
        }

        /* ==========================================================================
           右上「…」直下 いいね誘導吹き出し（image_12完全準拠）
           ========================================================================== */
        #like-bubble {
            display: none;
            position: absolute;
            top: 54px;
            right: 12px;
            background: #0088cc;
            color: #ffffff;
            font-size: 13px;
            font-weight: 700;
            padding: 8px 14px;
            border-radius: 12px;
            box-shadow: 0 4px 16px rgba(0, 136, 204, 0.5);
            pointer-events: none;
            z-index: 200;
            white-space: nowrap;
        }
        #like-bubble::after {
            content: '';
            position: absolute;
            top: -7px;
            right: 16px;
            width: 0;
            height: 0;
            border-left: 7px solid transparent;
            border-right: 7px solid transparent;
            border-bottom: 7px solid #0088cc;
        }
        #like-bubble.show {
            display: block;
            animation: bubble-pop 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        }
        @keyframes bubble-pop {
            0% { transform: scale(0.6); opacity: 0; }
            100% { transform: scale(1); opacity: 1; }
        }

        /* ==========================================================================
           ボトムシートメニュー (menu.js / image_10〜12完全準拠)
           ========================================================================== */
        #menu-overlay {
            display: none;
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.55);
            backdrop-filter: blur(3px);
            -webkit-backdrop-filter: blur(3px);
            z-index: 150;
            pointer-events: auto;
        }
        #bottom-sheet {
            position: absolute;
            bottom: 0;
            left: 0;
            width: 100%;
            max-height: 72vh;
            background: linear-gradient(180deg, #0284c7 0%, #0369a1 100%);
            border-top-left-radius: 20px;
            border-top-right-radius: 20px;
            box-shadow: 0 -8px 30px rgba(0, 0, 0, 0.6);
            transform: translateY(100%);
            transition: transform 0.28s cubic-bezier(0.2, 0.9, 0.3, 1);
            display: flex;
            flex-direction: column;
            padding: 12px 16px calc(var(--safe-bottom) + 12px);
            z-index: 160;
        }
        #bottom-sheet.open {
            transform: translateY(0);
        }

        .sheet-drag-handle {
            width: 38px;
            height: 4px;
            background: rgba(255, 255, 255, 0.4);
            border-radius: 2px;
            margin: 0 auto 10px;
        }
        .sheet-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
        }
        .sheet-title {
            color: #ffffff;
            font-size: 16px;
            font-weight: 800;
            letter-spacing: 0.5px;
        }
        .sheet-close-btn {
            width: 28px;
            height: 28px;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.2);
            color: #ffffff;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 14px;
            font-weight: 800;
            cursor: pointer;
        }

        /* 4タブ均等グリッドバー */
        .sheet-tabs {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 6px;
            background: rgba(0, 0, 0, 0.2);
            padding: 4px;
            border-radius: 10px;
            margin-bottom: 14px;
        }
        .sheet-tab-btn {
            background: transparent;
            border: none;
            color: rgba(255, 255, 255, 0.7);
            font-size: 12px;
            font-weight: 700;
            padding: 8px 0;
            border-radius: 8px;
            cursor: pointer;
            text-align: center;
            transition: background 0.15s, color 0.15s;
        }
        .sheet-tab-btn.active {
            background: #0284c7;
            color: #ffffff;
            box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
        }

        /* CHAT: 8大定型文チップ (2列×4行) */
        .chat-chips-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
            margin-bottom: 14px;
        }
        .chat-chip {
            background: rgba(255, 255, 255, 0.12);
            border: 1px solid rgba(255, 255, 255, 0.2);
            border-radius: 8px;
            padding: 10px;
            color: #ffffff;
            font-size: 13px;
            font-weight: 700;
            text-align: center;
            cursor: pointer;
            transition: background 0.15s, transform 0.08s;
        }
        .chat-chip:active {
            background: rgba(255, 255, 255, 0.25);
            transform: scale(0.96);
        }

        /* CHAT: 自由入力バー */
        .chat-input-bar {
            display: flex;
            gap: 8px;
        }
        .chat-input-box {
            flex: 1;
            background: rgba(0, 0, 0, 0.3);
            border: 1px solid rgba(255, 255, 255, 0.2);
            border-radius: 8px;
            padding: 10px 12px;
            color: #ffffff;
            font-size: 13px;
            outline: none;
        }
        .chat-send-btn {
            background: #0ea5e9;
            color: #ffffff;
            border: none;
            border-radius: 8px;
            padding: 0 16px;
            font-size: 13px;
            font-weight: 700;
            cursor: pointer;
        }

        /* 走者一覧 (participants) */
        .participants-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
            max-height: 40vh;
            overflow-y: auto;
        }
        .participant-row {
            display: flex;
            align-items: center;
            background: rgba(255, 255, 255, 0.1);
            border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 10px;
            padding: 8px 12px;
            cursor: pointer;
        }
        .participant-avatar {
            width: 36px;
            height: 36px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #ffffff;
            font-weight: 800;
            font-size: 14px;
            margin-right: 10px;
        }
        .participant-info {
            flex: 1;
            text-align: left;
        }
        .participant-name {
            color: #ffffff;
            font-size: 14px;
            font-weight: 700;
        }
        .participant-status {
            color: #34d399;
            font-size: 11px;
            margin-top: 2px;
        }
        .participant-arrow {
            color: rgba(255, 255, 255, 0.6);
            font-size: 16px;
        }

        /* CUSTOM 着せ替えピッカー */
        .custom-panel {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .custom-label {
            color: #ffffff;
            font-size: 12px;
            font-weight: 700;
            text-align: left;
        }
        .custom-row {
            display: flex;
            justify-content: space-around;
            gap: 8px;
        }
        .custom-face-btn {
            flex: 1;
            background: rgba(0, 0, 0, 0.25);
            border: 2px solid transparent;
            border-radius: 8px;
            padding: 8px 4px;
            color: #ffffff;
            font-size: 12px;
            font-weight: 700;
            cursor: pointer;
        }
        .custom-face-btn.selected {
            border-color: #ffffff;
            background: rgba(255, 255, 255, 0.25);
        }
        .custom-color-btn {
            width: 32px;
            height: 32px;
            border-radius: 50%;
            border: 2px solid transparent;
            cursor: pointer;
        }
        .custom-color-btn.selected {
            border-color: #ffffff;
            transform: scale(1.15);
            box-shadow: 0 0 10px rgba(255, 255, 255, 0.8);
        }

        /* 製作者タブ (image_12完全準拠) */
        .creator-notice-card {
            background: rgba(0, 0, 0, 0.3);
            border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 10px;
            padding: 12px;
            color: #ffffff;
            font-size: 12px;
            line-height: 1.6;
            text-align: left;
            margin-bottom: 12px;
        }
        .creator-link-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: rgba(255, 255, 255, 0.1);
            border: 1px solid rgba(255, 255, 255, 0.2);
            border-radius: 10px;
            padding: 12px;
            margin-bottom: 8px;
            color: #ffffff;
            font-size: 13px;
            font-weight: 700;
            cursor: pointer;
        }
        .creator-link-row:active {
            background: rgba(255, 255, 255, 0.2);
        }
    `;
    document.head.appendChild(styleEl);
}