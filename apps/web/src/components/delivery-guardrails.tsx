'use client';
import { useEffect, useState } from 'react';
import { fetchApi } from '@/lib/api';
import { useAccount } from '@/contexts/account-context';

type Guardrails = {
    paused: boolean;
    presenceEnabled: boolean;
    window: { startHourJst: number; endHourJst: number; within: boolean; nowJst: string };
    followers: { eligible: number; windowExpired: number; standby: number };
    volume: { dmOut24h: number; pendingBroadcastRecipients: number; pendingCommentJobs: number; activeScenarios: number };
};

/** 配信ガードレールの見える化（U22）: 送信窓・件数・停止スイッチ・既読/入力中の状態。 */
export default function DeliveryGuardrails() {
    const { selectedAccountId } = useAccount();
    const [data, setData] = useState<Guardrails | null>(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [refresh, setRefresh] = useState(0);

    useEffect(() => {
        let active = true;
        setData(null);
        setError('');
        if (!selectedAccountId) return;
        fetchApi<{ data: Guardrails }>('/api/delivery-guardrails')
            .then(result => { if (active) setData(result.data); })
            .catch(() => { if (active) setError('ガードレールの状態を取得できませんでした。'); });
        return () => { active = false; };
    }, [selectedAccountId, refresh]);

    const toggle = async (path: 'pause' | 'presence', body: Record<string, boolean>) => {
        setBusy(true);
        setError('');
        try {
            await fetchApi(`/api/delivery-guardrails/${path}`, { method: 'POST', body: JSON.stringify(body) });
            setRefresh(n => n + 1);
        } catch (err) {
            setError(err instanceof Error ? err.message : '切り替えに失敗しました。');
        } finally {
            setBusy(false);
        }
    };

    return <section className="rounded-xl border border-kumo-line bg-kumo-base p-4 space-y-3">
        <div className="flex justify-between items-center">
            <h2 className="font-semibold text-kumo-default">配信ガードレール</h2>
            <button type="button" className="text-sm underline" onClick={() => setRefresh(n => n + 1)}>更新</button>
        </div>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        {!selectedAccountId && <p className="text-sm">アカウントを選ぶと結果を確認できます。</p>}
        {/* 取得中は高さを確保してレイアウトがガクッと動かないようにする */}
        {!data && !error && selectedAccountId && <div className="space-y-2" aria-hidden="true"><div className="h-4 w-2/3 rounded bg-kumo-line/60 animate-pulse" /><div className="h-4 w-1/2 rounded bg-kumo-line/60 animate-pulse" /></div>}
        {data && <>
            <div className="grid grid-cols-2 gap-2 text-sm">
                <p>送信時間帯：<strong>{String(data.window.startHourJst).padStart(2, '0')}:00〜{String(data.window.endHourJst).padStart(2, '0')}:00（JST）</strong> ／ 現在{data.window.within ? '窓内' : '窓外'}</p>
                <p>24時間の返信窓：<strong>返信あり {data.followers.eligible}</strong> ／ 窓外 {data.followers.windowExpired} ／ 他アプリ担当 {data.followers.standby}</p>
                <p>直近24時間のDM送信：<strong>{data.volume.dmOut24h}件</strong></p>
                <p>送信待ち：一斉配信 {data.volume.pendingBroadcastRecipients}件 ／ コメントDM {data.volume.pendingCommentJobs}件 ／ 実行中シナリオ {data.volume.activeScenarios}件</p>
            </div>
            <div className="flex flex-wrap gap-3 border-t border-kumo-line pt-2">
                <button
                    type="button"
                    disabled={busy}
                    onClick={() => toggle('pause', { paused: !data.paused })}
                    className={`rounded-lg px-3 py-1.5 text-sm border ${data.paused ? 'bg-red-600 text-white border-red-600' : 'border-kumo-line'}`}
                >
                    {data.paused ? '送信停止中 — 再開する' : '送信を停止する（全経路）'}
                </button>
                <button
                    type="button"
                    disabled={busy}
                    onClick={() => toggle('presence', { enabled: !data.presenceEnabled })}
                    className="rounded-lg px-3 py-1.5 text-sm border border-kumo-line"
                >
                    既読＋入力中を自動DMに付ける：{data.presenceEnabled ? 'ON' : 'OFF'}（既定ON）
                </button>
            </div>
            <p className="text-xs text-kumo-subtle">停止中は新規の自動送信を行わず、待ち行列は停止解除後に再開します。</p>
        </>}
    </section>;
}
