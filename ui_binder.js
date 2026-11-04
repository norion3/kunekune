// ==============================================================================
// 『くねくねバトル オンライン』UIイベントバインダーモジュール (ui_binder.js)
// v29.0.0 デバッグ用無敵シールドボタン連携＆リトライ適正化版:
// ・【デバッグ用無敵シールドボタン(#btn-god-mode)イベントバインド】
// 　左下のリセットボタン直上に配置された無敵シールドボタンのタップイベントを実装。
// 　タップごとに自機の isGodMode をトグル切り替えし、ボタンの active クラス（発光）
// 　と完全連動！ bindFastTap により背後Canvasへのタッチ貫通・誤爆を完全遮断
// ・【リトライ明示連携(isExplicitRetry)】
// 　リトライボタン押下時に initGame(true, true) を実行！
// 　main.js のゲームオーバー防護壁に対し「ユーザー本人の手動タップである」ことを
// 　明示的に伝達し、安全かつ確実にリスポーン画面遷移を実行
// ・【リトライタップ反応性向上】
// 　リトライボタンのデバウンスを旧 800ms から 300ms へ適正化。
// 　再戦時のタップ反応の鈍さを解消し、テンポの良いリスポーンを実現
// ・【ズーム境界判定の浮動小数点誤差吸収】
// 　zoomMultiplier の丸め誤差を考慮し、updateZoomButtonsState の閾値を
// 　<= 0.211 で確実にキャッチ。下限(0.20)到達時にボタンを確実に disabled 化
// ・【タッチ貫通根絶維持】bindFastTap による背面ジョイスティック誤爆完全遮断
// ・【待機室開始デバウンス維持】btnWaitingStart の 1000ms 連打ガード配備
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
        btnIn.classList.toggle('disabled', zoomMultiplier >= 1.48);
    }
    if (btnOut) {
        // 下限0.20に対し、浮動小数点の計算誤差を吸収して確実にdisabledスタイルを付与
        btnOut.classList.toggle('disabled', zoomMultiplier <= 0.211);
    }
}

/**
 * モバイルタップの300ms遅延を解消し、かつ背後Canvasへのイベント貫通を防ぐ安全な高速バインドヘルパー
 * @param {HTMLElement} element 対象DOM
 * @param {Function} handler 実行ハンドラ
 */
function bindFastTap(element, handler) {
    if (!element) return;
    let lastTapTime = 0;

    // touchstart 発生時に即座に親・背面Canvasへの伝播を遮断（ジョイスティック暴発根絶）
    element.addEventListener('touchstart', (e) => {
        if (e) {
            e.stopPropagation();
        }
    }, { passive: false });

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

    // 1. ズーム操作ボタン（高速タップ対応＆下限解放レンジ化）
    const btnZoomIn = document.getElementById('btn-zoom-in');
    const btnZoomOut = document.getElementById('btn-zoom-out');

    if (btnZoomIn && !btnZoomIn._hasZoomInBound) {
        btnZoomIn._hasZoomInBound = true;
        bindFastTap(btnZoomIn, () => {
            input.zoomMultiplier = Math.min(1.50, Math.round((input.zoomMultiplier + 0.12) * 100) / 100);
            updateZoomButtonsState(input.zoomMultiplier);
        });
    }

    if (btnZoomOut && !btnZoomOut._hasZoomOutBound) {
        btnZoomOut._hasZoomOutBound = true;
        bindFastTap(btnZoomOut, () => {
            // 下限 0.20 まで安全に解放（浮動小数点丸めガード付き）
            input.zoomMultiplier = Math.max(0.20, Math.round((input.zoomMultiplier - 0.12) * 100) / 100);
            updateZoomButtonsState(input.zoomMultiplier);
        });
    }

    // 2. ランキング ＆ レーダーマップトグルボタン（高速タップ対応＆貫通防止）
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

    // 3. サウンドON/OFFボタン（高速タップ対応＆貫通防止）
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

    // 4. ワールドリセットボタン（ソロ専用・高速タップ対応＆貫通防止）
    const btnWorldReset = document.getElementById('btn-world-reset');
    if (btnWorldReset && !btnWorldReset._hasResetBound) {
        btnWorldReset._hasResetBound = true;
        bindFastTap(btnWorldReset, () => {
            // マルチプレイ中は同期保護のためリセット不可
            if (NetworkManager && NetworkManager.isMultiplayerActive) {
                return;
            }
            // リザルト画面が出ている場合は閉じる
            const overScreen = document.getElementById('over-screen');
            if (overScreen) {
                overScreen.style.display = 'none';
            }
            // isRespawn = false, isExplicitRetry = true により、新品の世界を再生成
            initGame(false, true);
        });
    }

    // 5. ★ デバッグ用：無敵シールドボタン（高速タップ対応＆貫通防止＆トグル連動）
    const btnGodMode = document.getElementById('btn-god-mode');
    if (btnGodMode && !btnGodMode._hasGodModeBound) {
        btnGodMode._hasGodModeBound = true;

        bindFastTap(btnGodMode, () => {
            const p = getPlayer();
            if (p) {
                p.isGodMode = !p.isGodMode;
                btnGodMode.classList.toggle('active', p.isGodMode);
            }
        });
    }

    // 6. ロビー：ソロプレイ開始ボタン（1秒連打デバウンス付＆貫通防止）
    const btnLobbySolo = document.getElementById('btn-lobby-solo');
    if (btnLobbySolo && !btnLobbySolo._hasSoloBound) {
        btnLobbySolo._hasSoloBound = true;
        let lastSoloTap = 0;

        btnLobbySolo.addEventListener('touchstart', (e) => {
            if (e) e.stopPropagation();
        }, { passive: false });

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
            initGame(false, true);
        };
        btnLobbySolo.addEventListener('touchend', onSoloTap, { passive: false });
        btnLobbySolo.addEventListener('click', onSoloTap);
    }

    // 7. 待機室：ホスト専用ゲーム開始ボタン（1000ms連打デバウンス配備＆一斉開始連携＆貫通防止）
    const btnWaitingStart = document.getElementById('btn-waiting-start');
    if (btnWaitingStart && !btnWaitingStart._hasStartBound) {
        btnWaitingStart._hasStartBound = true;
        let lastStartTapTime = 0;

        btnWaitingStart.addEventListener('touchstart', (e) => {
            if (e) e.stopPropagation();
        }, { passive: false });

        const onStartTap = (e) => {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            if (!NetworkManager.isHost) return;

            const now = Date.now();
            if (now - lastStartTapTime < 1000) return; // 1000ms デバウンスで二重起動防止
            lastStartTapTime = now;

            if (NetworkManager.isMultiplayerActive && typeof NetworkManager.broadcastStartGame === 'function') {
                NetworkManager.broadcastStartGame();
            }

            initGame(false, true);
        };

        btnWaitingStart.addEventListener('touchend', onStartTap, { passive: false });
        btnWaitingStart.addEventListener('click', onStartTap);
    }

    // 8. 待機室：退室ボタン（貫通防止）
    const btnWaitingLeave = document.getElementById('btn-waiting-leave');
    if (btnWaitingLeave && !btnWaitingLeave._hasLeaveBound) {
        btnWaitingLeave._hasLeaveBound = true;
        btnWaitingLeave.addEventListener('touchstart', (e) => {
            if (e) e.stopPropagation();
        }, { passive: false });

        btnWaitingLeave.onclick = async (e) => {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            EntryShield.show('DISCONNECTING...', '退室しています...');
            await NetworkManager.exitRoom();
            EntryShield.hide();
            UIController.showLobby();
        };
    }

    // 9. メニュー着せ替えコールバック初期化
    Menu.init((face, color) => {
        const p = getPlayer();
        if (p) {
            p.face = face;
            p.color = color;
        }
    });

    // 10. リザルト画面：リトライボタン（直接リスポーン再戦化＆貫通防止＆300ms適正デバウンス）
    const btnRetry = document.getElementById('btn-retry');
    if (btnRetry && !btnRetry._hasRetryBound) {
        btnRetry._hasRetryBound = true;
        let lastRetryTap = 0;

        btnRetry.addEventListener('touchstart', (e) => {
            if (e) e.stopPropagation();
        }, { passive: false });

        const onRetryTap = (e) => {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            const now = Date.now();
            if (now - lastRetryTap < 300) return; // 300ms デバウンスへ適正化
            lastRetryTap = now;

            const overScreen = document.getElementById('over-screen');
            if (overScreen) {
                overScreen.style.display = 'none';
            }

            // isRespawn = true, isExplicitRetry = true でゲームオーバー防護を正規に解除して再開
            initGame(true, true);
        };

        btnRetry.addEventListener('touchend', onRetryTap, { passive: false });
        btnRetry.addEventListener('click', onRetryTap);
    }
}