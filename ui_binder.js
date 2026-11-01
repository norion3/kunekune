// ==============================================================================
// 『くねくねバトル オンライン』UIイベントバインダーモジュール (ui_binder.js)
// v21.2.0 ゲーム開始全端末ブロードキャスト連動版:
// ・待機室「ゲーム開始」ボタン押下時の NetworkManager.broadcastStartGame() 連携
// ・ホストの開始トリガーにより全ゲスト端末が待機室から一斉始動
// ・ロビーの作成/参加/更新リスナーは net_lobby_hooks.js へ完全一本化
// ・操作系（ソロ開始、ズーム、サウンド、ランキング、マップ、待機室、リトライ）の専任化
// ==============================================================================

import { Danmaku } from './danmaku.js';
import { Menu } from './menu.js';

/**
 * ズームボタンのdisabled状態を倍率に応じて更新
 * @param {number} zoomMultiplier 
 */
export function updateZoomButtonsState(zoomMultiplier) {
    const btnIn = document.getElementById('btn-zoom-in');
    const btnOut = document.getElementById('btn-zoom-out');
    if (btnIn) {
        btnIn.classList.toggle('disabled', zoomMultiplier >= 1.39);
    }
    if (btnOut) {
        btnOut.classList.toggle('disabled', zoomMultiplier <= 0.46);
    }
}

/**
 * 全UIボタンおよびメニューイベントのバインド初期化
 * @param {Object} ctx 
 */
export function initUIBindings(ctx) {
    const {
        input,
        hud,
        Sound,
        NetworkManager,
        initGame,
        UIController,
        EntryShield,
        getPlayer
    } = ctx;

    // 1. ズーム操作ボタン
    const btnZoomIn = document.getElementById('btn-zoom-in');
    const btnZoomOut = document.getElementById('btn-zoom-out');

    if (btnZoomIn) {
        btnZoomIn.onclick = (e) => {
            e.stopPropagation();
            input.zoomMultiplier = Math.min(1.40, input.zoomMultiplier + 0.12);
            updateZoomButtonsState(input.zoomMultiplier);
        };
    }
    if (btnZoomOut) {
        btnZoomOut.onclick = (e) => {
            e.stopPropagation();
            input.zoomMultiplier = Math.max(0.45, input.zoomMultiplier - 0.12);
            updateZoomButtonsState(input.zoomMultiplier);
        };
    }

    // 2. ランキング ＆ レーダーマップトグルボタン
    const btnToggleRanking = document.getElementById('btn-toggle-ranking');
    const btnToggleMap = document.getElementById('btn-toggle-map');

    if (btnToggleRanking) {
        btnToggleRanking.onclick = (e) => {
            e.stopPropagation();
            hud.toggleRanking();
        };
    }
    if (btnToggleMap) {
        btnToggleMap.onclick = (e) => {
            e.stopPropagation();
            hud.toggleMap();
        };
    }

    // 3. サウンドON/OFFボタン
    const soundBtn = document.getElementById('btn-sound');
    if (soundBtn) {
        soundBtn.onclick = (e) => {
            e.stopPropagation();
            const isMuted = Sound.toggleMute();
            soundBtn.classList.toggle('active', !isMuted);
            const iconOff = document.getElementById('icon-sound-off');
            const iconOn = document.getElementById('icon-sound-on');
            if (iconOff) iconOff.style.display = isMuted ? 'block' : 'none';
            if (iconOn) iconOn.style.display = isMuted ? 'none' : 'block';
        };
    }

    // 4. ロビー：ソロプレイ開始ボタン（1秒連打デバウンス付）
    const btnLobbySolo = document.getElementById('btn-lobby-solo');
    if (btnLobbySolo && !btnLobbySolo._hasSoloBound) {
        btnLobbySolo._hasSoloBound = true;
        let lastSoloTap = 0;
        const onSoloTap = (e) => {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            const now = Date.now();
            if (now - lastSoloTap < 1000) return;
            lastSoloTap = now;

            NetworkManager.isMultiplayerActive = false;
            NetworkManager.isHost = true;
            NetworkManager.mySlot = 0;
            initGame();
        };
        btnLobbySolo.addEventListener('touchend', onSoloTap, { passive: false });
        btnLobbySolo.addEventListener('click', onSoloTap);
    }

    // ※ ロビーの公開作成・プライベート作成・一覧更新・各参加ボタンは
    //    net_lobby_hooks.js（1秒デバウンス ＆ 先行待機室起動）へ一本化済み

    // 5. 待機室：ホスト専用ゲーム開始ボタン（★全端末一斉開始ブロードキャスト連携）
    const btnWaitingStart = document.getElementById('btn-waiting-start');
    if (btnWaitingStart && !btnWaitingStart._hasStartBound) {
        btnWaitingStart._hasStartBound = true;
        btnWaitingStart.onclick = (e) => {
            if (e) e.stopPropagation();
            if (!NetworkManager.isHost) return;

            // マルチプレイ時は全ゲスト端末へゲーム開始パケットを送信
            if (NetworkManager.isMultiplayerActive && typeof NetworkManager.broadcastStartGame === 'function') {
                NetworkManager.broadcastStartGame();
            }

            // ホスト自身のゲームを始動
            initGame();
        };
    }

    // 6. 待機室：退室ボタン
    const btnWaitingLeave = document.getElementById('btn-waiting-leave');
    if (btnWaitingLeave && !btnWaitingLeave._hasLeaveBound) {
        btnWaitingLeave._hasLeaveBound = true;
        btnWaitingLeave.onclick = async (e) => {
            if (e) e.stopPropagation();
            EntryShield.show('DISCONNECTING...', '退室しています...');
            await NetworkManager.exitRoom();
            EntryShield.hide();
            UIController.showLobby();
        };
    }

    // 7. メニュー着せ替えコールバック初期化
    Menu.init((face, color) => {
        const p = getPlayer();
        if (p) {
            p.face = face;
            p.color = color;
        }
        Danmaku.push('システム', 'アバターを変更しました', color, true);
    });

    // 8. リザルト画面：リトライボタン（リザルト画面即時非表示 ＆ 復帰）
    const btnRetry = document.getElementById('btn-retry');
    if (btnRetry && !btnRetry._hasRetryBound) {
        btnRetry._hasRetryBound = true;
        btnRetry.onclick = (e) => {
            if (e) e.stopPropagation();
            const overScreen = document.getElementById('over-screen');
            if (overScreen) {
                overScreen.style.display = 'none';
            }

            if (NetworkManager.isMultiplayerActive) {
                UIController.showWaitingRoom(NetworkManager.currentRoomId);
            } else {
                initGame();
            }
        };
    }
}