import { useEffect } from "react";
import {useDispatch, useSelector} from "react-redux";
import type {RootState} from "@/store/store.ts";
import {isNotLogged} from "@/shared/utils/checks.ts";
import {MESSENGER_WS_PATH} from "@/shared/config/api.ts";

export function useWebSocketConnection() {

    const dispatch = useDispatch();
    const myId = useSelector((state: RootState) => state.user.id);

    useEffect(() => {
        if (isNotLogged(myId)) return;

        const protocol = window.location.protocol === "https:" ? "wss" : "ws";
        // Host-relative through the Ory edge (same origin as the logged-in window), which
        // authenticates the Kratos session cookie and injects X-User-* on the /ws upgrade.
        // No clientId query — the backend derives the sender from the header identity.
        const url = `${protocol}://${window.location.host}${MESSENGER_WS_PATH}`;

        const connect = () =>
            dispatch({ type: "ws/connect", payload: { url }, meta: { shouldReconnect: true } });
        const disconnect = () => dispatch({ type: "ws/disconnect" });

        connect();

        // GO OFFLINE ON SUSPEND so Web Push can take over.
        // A backgrounded mobile keeps its WS "alive" from the server's view: the browser answers the
        // server's ping with a PONG at the NETWORK layer (below the frozen JS), so the server never
        // reaps the idle session and keeps the user "online" → messages are delivered to a socket the
        // user cannot see and NO offline `chat.offline.notify` (→ no Web Push) is ever emitted. That is
        // why notifications don't arrive with the screen off. Fix: when the page is actually SUSPENDED
        // (`freeze`) or hidden away (`pagehide`), proactively close the WS so the backend flips the user
        // offline and routes the next message through Web Push. We key off suspension — NOT a mere
        // `visibilitychange → hidden` — so a briefly-hidden DESKTOP tab (which keeps running JS and
        // shows its own in-app notification over the live WS) is not needlessly disconnected.
        const onSuspend = () => disconnect();
        // Reconnect the moment we're back (and catch up history — handled by useChat's resume effect).
        const onWake = () => {
            if (document.visibilityState === "visible" && navigator.onLine) connect();
        };

        document.addEventListener("freeze", onSuspend);       // Page Lifecycle: page frozen (Chrome/Android)
        window.addEventListener("pagehide", onSuspend);        // Safari/iOS backgrounding + bfcache
        document.addEventListener("resume", onWake);           // Page Lifecycle: page unfrozen
        window.addEventListener("pageshow", onWake);           // Safari/iOS foreground/bfcache restore
        document.addEventListener("visibilitychange", onWake); // generic "tab visible again"
        window.addEventListener("online", onWake);             // network came back

        return () => {
            document.removeEventListener("freeze", onSuspend);
            window.removeEventListener("pagehide", onSuspend);
            document.removeEventListener("resume", onWake);
            window.removeEventListener("pageshow", onWake);
            document.removeEventListener("visibilitychange", onWake);
            window.removeEventListener("online", onWake);
            disconnect();
        };
    }, [myId, dispatch]);
}
