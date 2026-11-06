// ==============================================================================
// 『くねくねバトル オンライン』UIイベントバインダーモジュール (ui_binder.js)
// v34.0.0 ブーストボタン動的無効化（超軽量状態キャッシュ版）追加:
// ・【ブーストボタンの動的無効化（スコア60以下）】
// 　スコアが60以下でブーストできない状態の際、ボタンに disabled クラスを付与し、
// 　「押せるのに加速しない」という直感に反するUIをグレーアウトで適切に無効化。
// 　状態キャッシュ（isBoostDisabled）を用いることで、状態変化が起きた1フレームしか
// 　DOMアクセスが発生せず、毎フレーム呼び出してもFPS負荷（描画遅延）が実質ゼロの超軽量設計
// ・【チャット送信二重発火の完全根絶（menu.js 一本化）維持】
// ・【顔・マイアイコン即時マルチ同期維持】
// ・【カスタムカラー即時マルチ同期維持】
// ・【待機室＆メニュー走者リスト即時連動維持】
// ・【デバッグ用無敵シールドボタン(#btn-god-mode)イベントバインド維持】
// ・【リトライ明示連携(isExplicitRetry)維持】initGame(true, true)
// ・【リトライタップ反応性向上維持】300ms デバウンス
// ・【ズーム境界判定の浮動小数点誤差吸収維持】
// ・【タッチ貫通根絶維持】bindFastTap による背面ジョイスティック誤爆完全遮断
// ・【待機室開始デバウンス維持】btnWaitingStart の 1000ms 連打ガード配備
// ==============================================================================

import { Menu } from './menu.js';

/**
 * ブーストボタンのdisabled状態（スコア60以下）を状態キャッシュで超軽量に管理
 */
let isBoostDisabled = false;

export function updateBoostButtonState(currentScore) {
    const shouldDisable = (currentScore <= 60);

    // ★ 現在の記憶状態と「違う状態」になった瞬間だけDOMを触る（負荷ゼロ化）
    if (isBoostDisabled !== shouldDisable) {
        isBoostDisabled = shouldDisable;
        const btn = document.getElementById('btn-boost');
        if (btn) {
            if (shouldDisable) {
                btn.classList.add('disabled');
            } else {
                btn.classList.remove('disabled');
            }
        }
    }
}

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

    // 5. デバッグ用：無敵シールドボタン（高速タップ対応＆貫通防止＆トグル連動）
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

    // =========================================================================
    // 9. ★ 【メニュー着せ替えコールバック（顔・アイコン＆カラー即時マルチ同期）】
    // 顔や色の変更時に自機 player だけでなく、NetworkManager.slots の face と color
    // を即座に更新し、即時パケット送信(forceImmediateSync)とスロット同期を相手へ伝達
    // =========================================================================
    Menu.init((face, color) => {
        const p = getPlayer();
        if (p) {
            p.face = face;
            p.color = color;
        }

        if (NetworkManager) {
            const mySlot = NetworkManager.mySlot;
            if (NetworkManager.slots && NetworkManager.slots[mySlot]) {
                NetworkManager.slots[mySlot].color = color;
                NetworkManager.slots[mySlot].face = face;
            }

            // マルチプレイ中の即時反映処理
            if (NetworkManager.isMultiplayerActive) {
                // 1. 即時パケットフラッシュ（相手端末の onRemoteSnakeUpdate へ即反映）
                if (typeof NetworkManager.forceImmediateSync === 'function') {
                    NetworkManager.forceImmediateSync();
                }

                // 2. ホストの場合、スロット同期パケットを一斉同報
                if (NetworkManager.isHost && typeof NetworkManager._sendCustomMessage === 'function') {
                    const isPlaying = (typeof window !== 'undefined' && window.currentGameState === 'playing');
                    NetworkManager._sendCustomMessage({
                        e: 'ROOM_MEMBERS_SYNC',
                        slots: NetworkManager.slots,
                        seed: NetworkManager.currentSeed,
                        act: isPlaying
                    });
                }
            }

            // 待機室表示中の場合、リストバッジ色を即時反映
            if (UIController && typeof UIController.updateWaitingMembersList === 'function') {
                UIController.updateWaitingMembersList();
            }

            // メニュー内参加者一覧のアイコン色も連動更新
            if (NetworkManager.slots) {
                Menu.updateParticipants(NetworkManager.slots.filter(s => !s.isAI));
            }
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