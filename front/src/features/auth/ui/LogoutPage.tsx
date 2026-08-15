import {useNavigate} from "react-router-dom";
import {useDispatch} from "react-redux";
import {useTranslation} from "react-i18next";
import type {AppDispatch} from "@/store/store.ts";
import {useState} from "react";
import {logout} from "@/features/auth/model/services/kratosFlows.ts";
import {logoutResetClientState} from "@/store/logout.ts";
import {removePushSubscription} from "@/features/notifications";
import {logger} from "@/shared/logger/logger.ts";


export default function LogoutPage() {
    const {t} = useTranslation();
    const navigate = useNavigate();
    const dispatch = useDispatch<AppDispatch>();
    const [loading, setLoading] = useState(false);

    const handleLogout = async () => {
        setLoading(true);

        try {
            // Drop this device's push subscription while the session cookie is still valid (the
            // DELETE is cookie-authed) so the next user here doesn't inherit our notifications.
            await removePushSubscription();
            // Kratos returns the full public logout URL (…/.ory/kratos/public/self-service/logout?token=…).
            // Keep its path/query, just pin to the current origin (handles an internal kratos host).
            const logoutUrl = new URL(await logout());
            const target = `${window.location.origin}${logoutUrl.pathname}${logoutUrl.search}`;
            dispatch(logoutResetClientState());
            // Invalidate the Kratos session in the background instead of navigating the browser
            // to Kratos (which would bounce to Kratos' default post-logout page). redirect:"manual"
            // means we don't follow Kratos' redirect; the Set-Cookie that clears the session still
            // applies (same-origin), so the session is dead and we control the destination.
            await fetch(target, {credentials: "include", redirect: "manual"}).catch(() => {});
            navigate("/login", {replace: true});

        } catch (err) {
            logger.error("Logout error", err as Error);
            // Even if the flow call failed, send the user to login rather than leaving them stuck.
            navigate("/login", {replace: true});
        } finally {
            setLoading(false);
        }
    };

    const handleCancel = () => {
        navigate(-1);
    };

    return (
        <div className="min-h-dvh flex items-center justify-center bg-gray-200">
            <div className="bg-white p-6 rounded-xl shadow w-80 text-center">
                <h1 className="text-xl font-semibold mb-4">{t("auth.logoutTitle")}</h1>
                <p className="text-gray-600 mb-6">{t("auth.logoutConfirm")}</p>

                <div className="flex gap-3">
                    <button
                        onClick={handleCancel}
                        className="w-full border py-2 rounded hover:bg-gray-100"
                        disabled={loading}
                    >
                        {t("common.cancel")}
                    </button>

                    <button
                        onClick={handleLogout}
                        className="w-full bg-red-600 text-white py-2 rounded hover:bg-red-700"
                        disabled={loading}
                    >
                        {loading ? t("auth.loggingOut") : t("auth.logout")}
                    </button>
                </div>
            </div>
        </div>
    );
}
