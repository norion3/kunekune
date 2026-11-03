// ==============================================================================
// 『くねくねバトル オンライン』ホスト昇格＆生態系引継ぎマネージャー (host_migration.js)
// v1.0.0 main.jsスリム化・独立モジュール版:
// ・【旧ホスト肉片ドロップ還元】旧ホスト切断時にその位置へ肉片クラスタを展開し、食物連鎖を保護
// ・【通常AIスナップショット保持】既存AI（ID: 1〜94）の座標・スコア・外見を新ホスト世界線へ完全継承
// ・【空き枠ダミーAI完全継承】ID: 95〜100 のダミーAIも記憶喪失させず、育ったスコアで完全引き継ぎ
// ==============================================================================

import { Snake } from './snake.js';
import { MAX_PLAYERS, MAX_AIS, MAP_SIZE, SNAKE_COLORS } from './constants.js';

/**
 * ホスト切断時の自律ホスト昇格・世界線引継ぎ処理
 * @param {Object} ctx
 */
export function handleHostMigration(ctx) {
    const {
        remoteSnakes,
        allSnakes,
        sortedSnakesRef,
        setAllSnakes,
        aiManager,
        player,
        NetworkManager,
        updateResetButtonVisibility
    } = ctx;

    console.log('[HostMigration] ホストに昇格しました。世界線を引き継ぎシミュレーションを開始します。');

    // 1. 旧ホスト（Slot 0）の切断後肉片散布＆パージ
    const oldHost = remoteSnakes.get(0);
    if (oldHost) {
        if (!oldHost.isDead && oldHost.score > 60) {
            const colorIdx = SNAKE_COLORS.indexOf(oldHost.color);
            const safeColorIdx = colorIdx >= 0 ? colorIdx : 0;
            const dropCount = Math.min(30, Math.max(12, Math.floor((oldHost.historyLength || 16) / 2)));
            const totalVal = Math.min(3000, Math.max(150, Math.floor(oldHost.score * 0.28)));
            NetworkManager.queueDropCluster(oldHost.x, oldHost.y, totalVal, dropCount, safeColorIdx);
        }
        remoteSnakes.delete(0);
        const aIdx = allSnakes.indexOf(oldHost);
        if (aIdx !== -1) allSnakes.splice(aIdx, 1);
        const sIdx = sortedSnakesRef.list.indexOf(oldHost);
        if (sIdx !== -1) sortedSnakesRef.list.splice(sIdx, 1);
    }

    // 2. リモートから受信していた通常AI（Slot 6〜）のスナップショット収集
    const oldAiSnapshots = new Map();
    for (const [slot, remote] of remoteSnakes.entries()) {
        if (slot >= MAX_PLAYERS && remote && !remote.isDead) {
            oldAiSnapshots.set(slot - MAX_PLAYERS + 1, {
                x: remote.x,
                y: remote.y,
                score: remote.score,
                angle: remote.angle,
                color: remote.color,
                face: remote.face
            });
        }
    }

    // リモートAIをクリーンアップ（ローカルAIとして再構築するため）
    for (const [slot, remote] of remoteSnakes.entries()) {
        if (slot >= MAX_PLAYERS) {
            remoteSnakes.delete(slot);
            const aIdx = allSnakes.indexOf(remote);
            if (aIdx !== -1) allSnakes.splice(aIdx, 1);
        }
    }

    // 3. 通常AIの再初期化＆スナップショット復元
    aiManager.init(MAX_AIS, player.x, player.y);
    for (let i = 0; i < aiManager.ais.length; i++) {
        const ai = aiManager.ais[i];
        const snap = oldAiSnapshots.get(ai.id);
        if (snap) {
            ai.x = snap.x;
            ai.y = snap.y;
            ai.score = snap.score;
            ai.angle = snap.angle;
            ai.targetAngle = snap.angle;
            ai.color = snap.color || ai.color;
            ai.face = snap.face || ai.face;
            ai.recalculateSize();
        }
    }

    // 4. 空き枠ダミーAI（ID: 95〜100）のスナップショット完全引継ぎ
    for (let i = 0; i < MAX_PLAYERS; i++) {
        if (i === NetworkManager.mySlot) continue;
        const slotData = NetworkManager.slots[i];
        if (slotData && slotData.isAI) {
            const dummyId = MAX_AIS + i + 1;
            const aiSnake = new Snake(false, dummyId, slotData.name || `CPU ${i + 1}`, slotData.color, 'normal');

            // ゲスト時代に受信していたリモート情報があれば引き継ぐ
            const existingRemote = remoteSnakes.get(i);
            if (existingRemote && !existingRemote.isDead) {
                aiSnake.x = existingRemote.x;
                aiSnake.y = existingRemote.y;
                aiSnake.score = existingRemote.score;
                aiSnake.angle = existingRemote.angle;
                aiSnake.targetAngle = existingRemote.angle;
                aiSnake.color = existingRemote.color || aiSnake.color;
                aiSnake.face = existingRemote.face || aiSnake.face;
                aiSnake.recalculateSize();
                remoteSnakes.delete(i);
            } else {
                const angle = Math.random() * Math.PI * 2;
                const dist = 1500 + Math.random() * 22000;
                const sx = Math.max(400, Math.min(MAP_SIZE - 400, player.x + Math.cos(angle) * dist));
                const sy = Math.max(400, Math.min(MAP_SIZE - 400, player.y + Math.sin(angle) * dist));
                aiSnake.reset(sx, sy);
            }

            aiManager.ais.push(aiSnake);
            aiManager.aiMeta.push({
                state: 0,
                persona: 'forager',
                targetFoodPos: null,
                stateTimer: 40 + Math.floor(Math.random() * 60),
                scavengeTarget: null,
                cruiseDirection: Math.random() < 0.5 ? 1 : -1,
                harassSubtype: 0,
                harassCooldown: Math.floor(Math.random() * 60),
                deadTimer: 0
            });
        }
    }

    if (typeof window !== 'undefined') {
        window.allAISnakesInstance = aiManager.ais;
    }

    // 5. エンティティリストの再統合
    const currentPlayers = allSnakes.filter(s => s.isPlayer || (s.id !== undefined && s.id < MAX_PLAYERS));
    const newAllSnakes = [...currentPlayers, ...aiManager.ais];
    setAllSnakes(newAllSnakes);
    sortedSnakesRef.list = [...newAllSnakes];

    updateResetButtonVisibility();
}