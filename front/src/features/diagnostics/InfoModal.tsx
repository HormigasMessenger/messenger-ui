import {useEffect, useState} from "react";
import {useSelector} from "react-redux";
import {useTranslation} from "react-i18next";
import type {RootState} from "@/store/store";
import {appVersion, buildTime, getLoginAt, connectsInLast} from "@/shared/diag/diag.ts";
import {mediaStats} from "@/features/chat/db/db.ts";
import {cryptoStats, type CryptoStats} from "@/features/e2ee";

// Diagnostics / info page (modal): app identity, storage usage, encryption state, connection health.
// All numbers are read on open; nothing here changes state.

function fmtBytes(n: number): string {
    if (!n) return "0 B";
    const u = ["B", "KB", "MB", "GB"]; let i = 0; let v = n;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}
function fmtWhen(ms: number, locale: string): string {
    return ms ? new Date(ms).toLocaleString(locale, {dateStyle: "medium", timeStyle: "short"}) : "—";
}

function Row({label, value, mono}: {label: string; value: string | number; mono?: boolean}) {
    return (
        <div className="flex justify-between gap-3 py-1.5 text-sm border-b border-teal-50 last:border-0">
            <span className="text-teal-700">{label}</span>
            <span className={`text-teal-950 text-right ${mono ? "font-mono text-[13px]" : ""}`}>{value}</span>
        </div>
    );
}
function Section({title, children}: {title: string; children: React.ReactNode}) {
    return (
        <div className="mb-4">
            <h4 className="text-[11px] font-semibold tracking-wide uppercase text-teal-500 mb-1">{title}</h4>
            <div className="bg-teal-50/60 rounded-lg px-3 py-1">{children}</div>
        </div>
    );
}

export function InfoModal({onClose}: {onClose: () => void}) {
    const {t, i18n} = useTranslation();
    const locale = i18n.language || "en";
    const userId = useSelector((s: RootState) => s.user.id);
    const wsStatus = useSelector((s: RootState) => s.ws?.status ?? "—");

    const [store, setStore] = useState<{usage: number; quota: number; persisted: boolean} | null>(null);
    const [media, setMedia] = useState<{files: number; fileBytes: number; chats: number; messages: number} | null>(null);
    const [crypto, setCrypto] = useState<CryptoStats | null>(null);

    useEffect(() => {
        let alive = true;
        void (async () => {
            try {
                const est = (await navigator.storage?.estimate?.()) ?? {};
                const persisted = (await navigator.storage?.persisted?.()) ?? false;
                if (alive) setStore({usage: est.usage ?? 0, quota: est.quota ?? 0, persisted});
            } catch { /* ignore */ }
            void mediaStats().then((m) => alive && setMedia(m));
            void cryptoStats().then((c) => alive && setCrypto(c));
        })();
        return () => { alive = false; };
    }, []);

    const usagePct = store && store.quota ? Math.min(100, (store.usage / store.quota) * 100) : 0;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
            <div className="bg-white text-teal-950 rounded-xl max-w-md w-full max-h-[85vh] overflow-y-auto p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
                <h3 className="text-lg font-semibold mb-4">ℹ️ {t("info.title")}</h3>

                <Section title={t("info.general")}>
                    <Row label={t("info.version")} value={`${appVersion}`} mono/>
                    <Row label={t("info.build")} value={fmtWhen(buildTime ? Date.parse(buildTime) : 0, locale)}/>
                    <Row label={t("info.loginAt")} value={fmtWhen(getLoginAt(), locale)}/>
                    <Row label={t("info.userId")} value={userId ? userId.slice(0, 8) + "…" : "—"} mono/>
                    <Row label={t("info.locale")} value={locale}/>
                </Section>

                <Section title={t("info.storage")}>
                    <div className="py-2">
                        <div className="flex justify-between text-sm mb-1"><span className="text-teal-700">{t("info.used")}</span>
                            <span className="text-teal-950">{store ? `${fmtBytes(store.usage)} / ${fmtBytes(store.quota)}` : "…"}</span></div>
                        <div className="h-2 rounded-full bg-teal-100 overflow-hidden">
                            <div className="h-full bg-teal-600 rounded-full transition-[width]" style={{width: `${usagePct}%`}}/>
                        </div>
                    </div>
                    <Row label={t("info.persisted")} value={store ? (store.persisted ? "✓" : "✕") : "…"}/>
                    <Row label={t("info.files")} value={media ? `${media.files} · ${fmtBytes(media.fileBytes)}` : "…"}/>
                    <Row label={t("info.messages")} value={media ? `${media.messages} · ${media.chats} ${t("info.chats")}` : "…"}/>
                </Section>

                <Section title={t("info.encryption")}>
                    <Row label={t("info.masterKey")} value={crypto ? fmtWhen(crypto.deviceKeyCreatedAt, locale) : "…"}/>
                    <Row label={t("info.secretMsgs")} value={crypto ? `${crypto.secretMessages} · ${fmtBytes(crypto.secretBytes)}` : "…"}/>
                    <Row label={t("info.pending")} value={crypto ? crypto.pendingRecovery : "…"}/>
                    <Row label={t("info.verified")} value={crypto ? crypto.verifiedContacts : "…"}/>
                    <Row label={t("info.protocol")} value={crypto?.protocol ?? "…"} mono/>
                    <Row label={t("info.library")} value={crypto ? `${crypto.lib} · env v${crypto.envelope}` : "…"} mono/>
                </Section>

                <Section title={t("info.connection")}>
                    <Row label={t("info.wsStatus")} value={wsStatus}/>
                    <Row label={t("info.reconnects")} value={connectsInLast(10 * 60 * 1000)}/>
                </Section>

                <button onClick={onClose} className="w-full mt-1 py-2 text-teal-700 text-sm hover:underline">{t("info.close")}</button>
            </div>
        </div>
    );
}
