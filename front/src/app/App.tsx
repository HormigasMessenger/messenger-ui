import "./App.css";
import {BrowserRouter, Route, Routes} from "react-router-dom";
import {lazy, Suspense, useEffect} from "react";
import {useDispatch, useSelector} from "react-redux";
import {Toaster} from "react-hot-toast";

import type {RootState} from "@/store/store.ts";
import {RequireAuth} from "@/features/auth/ui/RequireAuth";
import {useWebSocketConnection} from "@/infrastructure/hooks/useWebSocketConnection.ts";
import {markInitialized} from "@/features/auth/slices/userSlice.ts";
import {isNotLogged} from "@/shared/utils/checks.ts";
import {ErrorBoundary} from "@/shared/ui/ErrorBoundary.tsx";
import {armNotificationPermissionOnGesture, requestNotificationPermission} from "@/features/notifications/desktopNotification.ts";
import {ensurePushSubscription} from "@/features/notifications/push.ts";

// Route-level code splitting: keep the initial bundle small (each screen loads on demand).
const Messenger = lazy(() => import("@/pages/Messenger"));
const AddUser = lazy(() => import("@/features/contacts/ui/AddUser.tsx"));
const LoginPage = lazy(() => import("@/features/auth/ui/LoginPage.tsx"));
const LogoutPage = lazy(() => import("@/features/auth/ui/LogoutPage.tsx"));
const RegistrationPage = lazy(() => import("@/features/auth/ui/RegistrationPage.tsx"));

function Fallback() {
    return <div className="min-h-dvh flex items-center justify-center bg-gray-200 text-gray-500">…</div>;
}

function App() {
    /* WebSocket connection */
    useWebSocketConnection();

    const dispatch = useDispatch();
    useEffect(() => {
        dispatch(markInitialized());
        requestNotificationPermission();                                  // desktop: mount-time request is honored
        armNotificationPermissionOnGesture(() => { ensurePushSubscription(); }); // mobile: request on first tap, then subscribe
    }, [dispatch]);

    // (Re)register the push subscription whenever a user becomes logged in — NOT just on page load.
    // Login is pure SPA navigation (no reload), so without this a user who logs in after someone
    // logged out on the same device is never registered with the backend and gets no Web Push.
    const userId = useSelector((s: RootState) => s.user.id);
    useEffect(() => {
        if (!isNotLogged(userId)) ensurePushSubscription();
    }, [userId]);

    return (
        <ErrorBoundary>
            <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "")}>
                <Suspense fallback={<Fallback/>}>
                    <Routes>
                        <Route path="/" element={
                            <RequireAuth>
                                <Messenger/>
                            </RequireAuth>
                        }
                        />
                        <Route path="/add" element={
                            <RequireAuth>
                                <AddUser/>
                            </RequireAuth>
                        }
                        />
                        <Route path="/login" element={<LoginPage/>}/>
                        <Route path="/logout" element={<LogoutPage/>}/>
                        <Route path="/register" element={<RegistrationPage/>}/>
                    </Routes>
                </Suspense>
                <Toaster/>
            </BrowserRouter>
        </ErrorBoundary>
    );
}

export default App;
