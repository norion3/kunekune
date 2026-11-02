// ==============================================================================
// 『くねくねバトル オンライン』UIイベントバインダーモジュール (ui_binder.js)
// v27.5.0 ワールドリセットボタンバインド＆ソロ専用世界再生成版:
// ・【ワールドリセットボタンバインド】#btn-world-reset へ高速タップリスナー（bindFastTap）を配備
// 　ソロプレイ時限定で initGame(false) を呼び出し、巨大化したAI・餌・プレイヤーを新品のピラミッド生態系へ即座に再初期化
// ・マルチプレイ中は誤操作・同期破綻を防ぐためリセット要求を完全ガード
// ・【ズーム下限解放】対数ズーム刷新に伴い、手動縮小リミットを 0.45 から 0.20 まで大幅解放
// ・【ボタン状態適正化】updateZoomButtonsState の判定閾値を新レンジ（0.20 〜 1.50）へ同期
// ・【タッチ貫通根絶】bindFastTap に touchstart の stopPropagation() を配備し、MENU・音量・リセットボタンタップ時のジョイスティック誤爆を完全解消
// ・【待機室開始デバウンス】btnWaitingStart に 1000ms のタップデバウンスを配備し、ホスト連打による二重 initGame 実行を完全防止
// ・リトライ時に待機室へ幽閉されるデッドロックを根絶し、マルチ/ソロ問わず即座に戦場へ直接リスポーン再戦
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
        // 下限を 0.46 から 0.22 へ引き下げ、超広大な視野角への手動切り替えを許可
        btnOut.classList.toggle('disabled', zoomMultiplier <= 0.22);
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

    // ★ touchstart 発生時に即座に親・背面Canvasへの伝播を遮断（ジョイスティック暴発根絶）
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
            input.zoomMultiplier = Math.min(1.50, input.zoomMultiplier + 0.12);
            updateZoomButtonsState(input.zoomMultiplier);
        });
    }

    if (btnZoomOut && !btnZoomOut._hasZoomOutBound) {
        btnZoomOut._hasZoomOutBound = true;
        bindFastTap(btnZoomOut, () => {
            // 下限を 0.45 から 0.20 へ解放
            input.zoomMultiplier = Math.max(0.20, input.zoomMultiplier - 0.12);
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

    // ★ 4. ワールドリセットボタン（ソロ専用・高速タップ対応＆貫通防止）
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
            // isRespawn = false により、巨大化AI・ワールド餌・プレイヤーを完全に初期化して新品の世界を生成
            initGame(false);
        });
    }

    // 5. ロビー：ソロプレイ開始ボタン（1秒連打デバウンス付＆貫通防止）
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
            initGame();
        };
        btnLobbySolo.addEventListener('touchend', onSoloTap, { passive: false });
        btnLobbySolo.addEventListener('click', onSoloTap);
    }

    // 6. 待機室：ホスト専用ゲーム開始ボタン（1000ms連打デバウンス配備＆一斉開始連携＆貫通防止）
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

            initGame();
        };

        btnWaitingStart.addEventListener('touchend', onStartTap, { passive: false });
        btnWaitingStart.addEventListener('click', onStartTap);
    }

    // 7. 待機室：退室ボタン（貫通防止）
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

    // 8. メニュー着せ替えコールバック初期化
    Menu.init((face, color) => {
        const p = getPlayer();
        if (p) {
            p.face = face;
            p.color = color;
        }
    });

    // 9. リザルト画面：リトライボタン（直接リスポーン再戦化＆貫通防止）
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
            if (now - lastRetryTap < 800) return;
            lastRetryTap = now;

            const overScreen = document.getElementById('over-screen');
            if (overScreen) {
                overScreen.style.display = 'none';
            }

            initGame(true);
        };

        btnRetry.addEventListener('touchend', onRetryTap, { passive: false });
        btnRetry.addEventListener('click', onRetryTap);
    }
}