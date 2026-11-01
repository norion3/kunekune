// ==============================================================================
// 『くねくねバトル オンライン』UIイベントバインダーモジュール (ui_binder.js)
// v25.3.0 死亡リトライ直接再戦化＆モバイル高速タッチレスポンス版:
// ・リトライ時に待機室へ幽閉されるデッドロックを根絶し、マルチ/ソロ問わず即座に戦場へ直接リスポーン再戦
// ・ホスト死亡リトライ時に戦っている生存ゲストが巻き添えリセットされる事故を完全防止
// ・ズーム・ランキング・マップ・サウンド操作へ touchend 高速タップリスナーを配備し、300ms操作遅延を解消
// ・メニュー着せ替え時の不要な自動弾幕ログ完全削除維持
// ・ホスト開始時の全ゲスト一斉始動 ＆ ロビー操作の net_lobby_hooks.js 一本化維持
// ==============================================================================

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
 * モバイルタップの300ms遅延を解消する安全な高速バインドヘルパー
 * @param {HTMLElement} element 対象DOM
 * @param {Function} handler 実行ハンドラ
 */
function bindFastTap(element, handler) {
    if (!element) return;
    let lastTapTime = 0;
    const onFastTap = (e) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        const now = Date.now();
        if (now - lastTapTime < 200) return; // 200ms デバウンス
        lastTapTime = now;
        handler(e);
    };
    element.addEventListener('touchend', onFastTap, { passive: false });
    element.addEventListener('click', onFastTap);
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

    // 1. ズーム操作ボタン（高速タップ対応）
    const btnZoomIn = document.getElementById('btn-zoom-in');
    const btnZoomOut = document.getElementById('btn-zoom-out');

    if (btnZoomIn && !btnZoomIn._hasZoomInBound) {
        btnZoomIn._hasZoomInBound = true;
        bindFastTap(btnZoomIn, () => {
            input.zoomMultiplier = Math.min(1.40, input.zoomMultiplier + 0.12);
            updateZoomButtonsState(input.zoomMultiplier);
        });
    }

    if (btnZoomOut && !btnZoomOut._hasZoomOutBound) {
        btnZoomOut._hasZoomOutBound = true;
        bindFastTap(btnZoomOut, () => {
            input.zoomMultiplier = Math.max(0.45, input.zoomMultiplier - 0.12);
            updateZoomButtonsState(input.zoomMultiplier);
        });
    }

    // 2. ランキング ＆ レーダーマップトグルボタン（高速タップ対応）
    const btnToggleRanking = document.getElementById('btn-toggle-ranking');
    const btnToggleMap = document.getElementById('btn-toggle-map');

    if (btnToggleRanking && !btnToggleRanking._hasRankBound) {
        btnToggleRanking._hasRankBound = true;
        bindFastTap(btnToggleRanking, () => {
            hud.toggleRanking();
        });
    }

    if (btnToggleMap && !btnToggleMap._hasMapBound) {
        btnToggleMap._hasMapBound = true;
        bindFastTap(btnToggleMap, () => {
            hud.toggleMap();
        });
    }

    // 3. サウンドON/OFFボタン（高速タップ対応）
    const soundBtn = document.getElementById('btn-sound');
    if (soundBtn && !soundBtn._hasSoundBound) {
        soundBtn._hasSoundBound = true;
        bindFastTap(soundBtn, () => {
            const isMuted = Sound.toggleMute();
            soundBtn.classList.toggle('active', !isMuted);
            const iconOff = document.getElementById('icon-sound-off');
            const iconOn = document.getElementById('icon-sound-on');
            if (iconOff) iconOff.style.display = isMuted ? 'block' : 'none';
            if (iconOn) iconOn.style.display = isMuted ? 'none' : 'block';
        });
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

    // 5. 待機室：ホスト専用ゲーム開始ボタン（全端末一斉開始ブロードキャスト連携）
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
    });

    // 8. ★ リザルト画面：リトライボタン（直接リスポーン再戦化）
    // マルチプレイ・ソロプレイを問わず、待機室に送還せず即座に戦場へ再出撃！
    // ゲストの待機室永久幽閉デッドロックと、ホスト操作による生存ゲスト強制リセットを完全解消。
    const btnRetry = document.getElementById('btn-retry');
    if (btnRetry && !btnRetry._hasRetryBound) {
        btnRetry._hasRetryBound = true;
        let lastRetryTap = 0;
        const onRetryTap = (e) => {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            const now = Date.now();
            if (now - lastRetryTap < 800) return;
            lastRetryTap = now;

            const overScreen = document.getElementById('over-screen');
            if (overScreen) {
                overScreen.style.display = 'none';
            }

            // ★ 待機室へ戻らず、その対戦セッション内で即座に直接リスポーン（isRespawn = true）
            initGame(true);
        };

        btnRetry.addEventListener('touchend', onRetryTap, { passive: false });
        btnRetry.addEventListener('click', onRetryTap);
    }
}