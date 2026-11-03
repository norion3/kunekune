// ==============================================================================
// 『くねくねバトル オンライン』起動＆自動合流オーケストレーター (boot.js)
// v1.0.0 main.jsスリム化・独立モジュール版:
// ・【起動シーケンス独立化】GRAVITY AgentSDKユーザー認証、ロビー挨拶更新、
// 　およびDM招待リンク検知による指定ルーム自動合流（AutoJoin）処理を完全カプセル化
// ・【安全な非同期ハンドリング】入室成否判定、シールド表示、エラー弾幕通知を完備
// ==============================================================================

import { hookLobbyNetworkEvents } from './net_lobby_hooks.js';

/**
 * ゲーム初期起動シーケンス
 * ユーザー認証、ロビー初期化、DM招待URL/RoomID検知による自動合流を実行
 * @param {Object} ctx 
 */
export async function runBootSequence(ctx) {
    const {
        NetworkManager,
        player,
        UIController,
        EntryShield,
        Danmaku,
        getGameState
    } = ctx;

    try {
        // 1. ユーザー情報初期化・認証
        const userInfo = await NetworkManager.init();
        if (userInfo && userInfo.name && userInfo.name !== 'あなた' && player) {
            player.name = userInfo.name;
        }

        UIController.refreshLobbyGreeting();
        hookLobbyNetworkEvents();

        // 2. GRAVITY DM招待リンク / ルームID検知
        if (typeof window !== 'undefined' && window.AgentSDK && window.AgentSDK.room && typeof window.AgentSDK.room.getRoomId === 'function') {
            const res = await window.AgentSDK.room.getRoomId();
            const targetRoomId = (res && typeof res.room_id === 'string')
                ? res.room_id
                : (res && res.data && typeof res.data.room_id === 'string' ? res.data.room_id : '');

            if (targetRoomId && targetRoomId !== '') {
                const shortId = targetRoomId.length > 5 ? targetRoomId.slice(-5) : targetRoomId;
                console.log(`[AutoJoin] DM招待リンク検知: Room #${targetRoomId} へ自動合流開始`);

                EntryShield.show(`ROOM #${shortId}`, '招待ルームへ合流中...');
                UIController.showWaitingRoom(targetRoomId);

                const joinRes = await NetworkManager.joinRoom(targetRoomId);
                EntryShield.hide();

                if (joinRes.success) {
                    if (getGameState() !== 'playing') {
                        UIController.showWaitingRoom(targetRoomId);
                    }
                    return;
                } else {
                    console.warn('[AutoJoin] 自動入室に失敗しました。ロビーへ戻します。');
                    Danmaku.push('エラー', joinRes.msg || '入室できませんでした', '#f43f5e', true);
                    UIController.showLobby();
                    return;
                }
            }
        }
    } catch (err) {
        console.warn('[BootSequence] エラー:', err);
        EntryShield.hide();
    }

    // 通常起動時はロビーを表示
    UIController.showLobby();
}