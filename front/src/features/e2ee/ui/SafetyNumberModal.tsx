import {useEffect, useState} from "react";
import {useTranslation} from "react-i18next";
import {computeSafetyNumber, formatSafetyNumber, markVerified, clearVerified, isVerified} from "../index.ts";

/**
 * Safety-number verification (MITM check). Shows the fingerprint derived from both parties' identity keys;
 * the user compares it out-of-band with the peer and marks them verified. A later key change makes the
 * number differ from the stored one, so verification silently drops until re-checked.
 */
export function SafetyNumberModal({myUserId, peerUserId, peerName, onClose}: {
    myUserId: string; peerUserId: string; peerName: string; onClose: () => void;
}) {
    const {t} = useTranslation();
    const [num, setNum] = useState<string | null | undefined>(undefined);   // undefined = loading
    const [verified, setVerified] = useState(false);

    useEffect(() => {
        let alive = true;
        void computeSafetyNumber(myUserId, peerUserId).then((n) => {
            if (!alive) return;
            setNum(n);
            setVerified(isVerified(peerUserId, n));
        });
        return () => { alive = false; };
    }, [myUserId, peerUserId]);

    const toggle = () => {
        if (!num) return;
        if (verified) { clearVerified(peerUserId); setVerified(false); }
        else { markVerified(peerUserId, num); setVerified(true); }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
            <div className="bg-white text-teal-950 rounded-xl max-w-sm w-full p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
                <h3 className="text-lg font-semibold flex items-center gap-2">🔒 {t("chat.safetyTitle")}</h3>
                <p className="text-sm text-teal-800 mt-1">{t("chat.safetyDesc", {name: peerName})}</p>

                {num === undefined ? (
                    <div className="my-6 text-center text-teal-600 text-sm">{t("chat.safetyComputing")}</div>
                ) : num === null ? (
                    <div className="my-6 text-center text-amber-700 text-sm">{t("chat.safetyUnknown")}</div>
                ) : (
                    <>
                        <div className="my-4 font-mono text-[15px] leading-7 tracking-wide text-center bg-teal-50 rounded-lg p-3 break-words select-all">
                            {formatSafetyNumber(num)}
                        </div>
                        {verified && <div className="text-center text-green-700 text-sm font-medium mb-2">✓ {t("chat.safetyVerified")}</div>}
                        <button
                            onClick={toggle}
                            className={`w-full py-2 rounded-lg font-medium ${verified ? "bg-teal-100 text-teal-800" : "bg-teal-700 text-white hover:bg-teal-800"}`}
                        >
                            {verified ? t("chat.safetyUnverify") : t("chat.safetyVerify")}
                        </button>
                    </>
                )}

                <button onClick={onClose} className="w-full mt-2 py-2 text-teal-700 text-sm hover:underline">
                    {t("chat.safetyClose")}
                </button>
            </div>
        </div>
    );
}
