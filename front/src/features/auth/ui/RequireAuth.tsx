import React, {useEffect, useState} from "react";
import {useDispatch, useSelector} from "react-redux";
import type {RootState} from "@/store/store";
import {Navigate} from "react-router-dom";
import {logger} from "@/shared/logger/logger.ts";
import {setUser} from "@/features/auth/slices/userSlice.ts";
import {isNotLogged} from "@/shared/utils/checks.ts";
import {provisionE2EEInBackground} from "@/features/e2ee";
import { kratos } from "../model/services/kratos.ts";


async function checkSession() {
    try {
        const { data } = await kratos.toSession();
        return data;
    } catch (err: unknown) {
        logger.error((err as Error).message);
        return null;
    }
}

export function RequireAuth({ children }: { children: React.ReactNode }) {
    const [loading, setLoading] = useState(true);
    const dispatch = useDispatch();

    useEffect(() => {
        checkSession().then((session) => {
            if (session?.identity) {
                logger.debug("session found");

                // Kratos `traits.name` may be a string OR an object ({first,last}),
                // depending on the identity schema. Coerce to a non-empty string so the
                // downstream `isNotLogged(name)` gate never calls .trim() on a non-string.
                const traits = (session.identity.traits ?? {}) as {
                    name?: unknown;
                    email?: string;
                };
                const rawName = traits.name;
                const displayName =
                    typeof rawName === "string"
                        ? rawName
                        : rawName && typeof rawName === "object"
                            ? [
                                (rawName as { first?: string }).first,
                                (rawName as { last?: string }).last,
                              ].filter(Boolean).join(" ").trim()
                            : "";

                dispatch(setUser({
                    id: session.identity.id,
                    name: displayName || traits.email || session.identity.id,
                }));
                // Publish this device's E2EE public keys to the directory (best-effort, fire-and-forget,
                // never affects login). Readies the ground for opt-in secret chats — no UI change yet.
                provisionE2EEInBackground();
            }
            setLoading(false);
        });
    }, [dispatch]);

    const { initialized, name } = useSelector(
        (s: RootState) => s.user
    );

    if (!initialized || loading) {
        return <div>Loading...</div>;
    }

    if (isNotLogged(name)) {
        logger.debug("starting login flow");
        return <Navigate to="/login" replace />;
    }

    logger.debug("user found");
    return <>{children}</>;
}
