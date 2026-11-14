/**
 * WARNING: Before modifying this file, run the following command:
 *
 * $ npx keycloakify own --path "shared/SessionExpirationWarningOverlay.tsx"
 *
 * This file is provided by @keycloakify/keycloak-ui-shared version 260700.0.3.
 * It was copied into your repository by the postinstall script: `keycloakify sync-extensions`.
 */

/* eslint-disable */

import { useEffect, useState } from "react";
import { useEnvironment } from "./keycloak-ui-shared/context/KeycloakContext";

let documentTitleStatus:
    | { isOverridden: false }
    | { isOverridden: true; actualTitle: string } = {
    isOverridden: false
};

export function SessionExpirationWarningOverlay(props: {
    warnUserSecondsBeforeAutoLogout: number;
}) {
    const { warnUserSecondsBeforeAutoLogout } = props;

    const { keycloak } = useEnvironment();

    const [secondsLeft, setSecondsLeft] = useState<number | undefined>(undefined);

    useEffect(() => {
        const { oidc } = keycloak;

        if (!oidc.isUserLoggedIn) {
            // We know the user is logged in because of new Keycloak({ onLoad: "login-required" })
            throw new Error("assertion error");
        }

        const { unsubscribeFromAutoLogoutCountdown } =
            oidc.subscribeToAutoLogoutCountdown(({ secondsLeft }) => {
                if (secondsLeft === undefined) {
                    // The use had become active again. Hide the overlay
                    setSecondsLeft(undefined);
                    return;
                }

                if (secondsLeft > warnUserSecondsBeforeAutoLogout) {
                    // The session expires in a while still, do not display the overlay.
                    setSecondsLeft(undefined);
                    return;
                }

                setSecondsLeft(secondsLeft);
            });

        return () => {
            unsubscribeFromAutoLogoutCountdown();
        };
    }, []);

    useEffect(() => {
        if (secondsLeft === undefined) {
            if (documentTitleStatus.isOverridden) {
                document.title = documentTitleStatus.actualTitle;
            }
            documentTitleStatus = { isOverridden: false };
            return;
        }

        if (!documentTitleStatus.isOverridden) {
            documentTitleStatus = {
                isOverridden: true,
                actualTitle: document.title
            };
        }

        document.title = `${secondsLeft} seconds left`;
    }, [secondsLeft]);

    if (secondsLeft === undefined) {
        return null;
    }

    return (
        <div
            // Full screen overlay, blurred background
            style={{
                position: "fixed",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: "rgba(0,0,0,0.5)",
                backdropFilter: "blur(10px)",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                zIndex: 1000
            }}
        >
            <div
                style={{
                    backgroundColor: "#fff",
                    color: "#111",
                    padding: "24px 28px",
                    borderRadius: 8,
                    boxShadow: "0 12px 28px rgba(0, 0, 0, 0.35)",
                    maxWidth: 420,
                    width: "90%",
                    textAlign: "center",
                    lineHeight: 1.4
                }}
            >
                <p style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
                    Session expiring soon
                </p>
                <p style={{ margin: "12px 0 0" }}>
                    You will be signed out in <strong>{secondsLeft}</strong> seconds due
                    to inactivity.
                </p>
                <p style={{ margin: "12px 0 0", fontSize: 13, opacity: 0.8 }}>
                    Move your mouse or press any key to stay signed in.
                </p>
            </div>
        </div>
    );
}
