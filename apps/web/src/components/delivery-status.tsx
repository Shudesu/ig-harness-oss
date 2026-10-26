'use client';
import { useEffect, useState } from 'react';
import { fetchApi } from '@/lib/api';
import { useAccount } from '@/contexts/account-context';
type Data = {
    graphApiVersion: string;
    account: {
        token_api_ok: boolean | null; token_api_reason?: string | null;
        graph_usage: Record<string, number> | null;
        graph_backoff_until: string | null;
    } | null;
    broadcasts: Array<{
        id: string;
        name: string;
        status: string;
        total: number;
        sent: number;
        skipped: number;
        pending: number;
        attention: number;
    }>;
    deliveries: Array<{
        kind: string;
        id: string;
        name: string;
        status: string;
        reason: string | null;
        errorCode: number | null;
    }>;
};
const reasons: Record<string, string> = { window_closed: '24時間の送信枠外', window_expired: '24時間の送信枠外', standby: '他のアプリが応答を担当', private_reply_standby: '他のアプリが応答を担当', awaiting_inbound: '相手の返信待ち', rate_limited: 'Metaの制限により待機中', outcome_unknown: '送信結果の確認が必要', private_reply_outcome_unknown: '送信結果の確認が必要', interrupted: '処理停止後の結果確認が必要', delivery_in_progress: '送信処理中', public_reply_failed: '公開コメントの返信に失敗', private_reply_expired: 'コメントから7日を超過', private_reply_already_sent: 'このコメントには送信済み', live_comment_not_supported: 'Liveコメントは未対応' };
export default function DeliveryStatus() {
    const { selectedAccountId } = useAccount();
    const [data, setData] = useState<Data | null>(null);
    const [error, setError] = useState('');
    const [refresh, setRefresh] = useState(0);
    useEffect(() => {
        let active = true;
        setData(null);
        setError('');
        if (!selectedAccountId)
            return;
        fetchApi<{
            data: Data;
        }>('/api/delivery-status').then(result => { if (active)
            setData(result.data); }).catch(() => { if (active)
            setError('配信状態を取得できませんでした。'); });
        return () => { active = false; };
    }, [selectedAccountId, refresh]);
    return <section className="rounded-xl border border-kumo-line bg-kumo-base p-4 space-y-3">
    <div className="flex justify-between items-center"><h2 className="font-semibold text-kumo-default">配信状況</h2><button type="button" className="text-sm underline" onClick={() => setRefresh(n => n + 1)}>更新</button></div>
    <p className="text-xs text-kumo-subtle">通常DMは最後の応答から24時間以内。コメントへの初回DMは1通で、画像・テンプレートの続きは相手の返信後に送ります。</p>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    {!selectedAccountId && <p className="text-sm">アカウントを選ぶと結果を確認できます。</p>}
    {data && <>
      {data.account?.token_api_ok === false && <p role="alert" className="text-sm text-red-600">{data.account.token_api_reason==='account_id_mismatch'?'登録IDとトークンのアカウントが一致しません。データを保持したまま登録IDを確認してください。':data.account.token_api_reason==='api_unavailable'?'Metaへの接続確認に失敗しました。待機状態や接続設定を確認してください。':'Instagramへの再接続が必要です。設定からトークンを更新してください。'}</p>}
      {data.account?.graph_backoff_until && <p className="text-sm">API呼び出しを待機中：{new Date(data.account.graph_backoff_until).toLocaleString('ja-JP')}まで</p>}
      {data.account?.graph_usage?.call_count !== undefined && <p className="text-xs text-kumo-subtle">Metaが返したAPI呼び出し使用率：{data.account.graph_usage.call_count}%</p>}
      {data.broadcasts.map(row => <div key={row.id} className="text-sm border-t border-kumo-line pt-2"><strong>{row.name}</strong><p>送信済み {row.sent} ／ 未送信 {row.pending} ／ 対象外 {row.skipped} ／ 要確認 {row.attention}</p></div>)}
      <details><summary className="text-sm cursor-pointer">コメント・シナリオの配信記録（{data.deliveries.length}件）</summary><ul className="mt-2 space-y-2 text-sm">{data.deliveries.map(row => <li key={`${row.kind}:${row.id}`}><span>{row.name}：</span>{row.reason ? (reasons[row.reason] ?? '配信条件・権限を確認してください') : row.status === 'sent' ? '送信済み' : row.status === 'pending' ? '送信待ち' : row.status === 'processing' ? '処理中' : '結果の確認が必要'}{row.errorCode !== null && <span className="text-xs">（Metaコード {row.errorCode}）</span>}</li>)}</ul></details>
    </>}
  </section>;
}
