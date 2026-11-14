/**
 * WARNING: Before modifying this file, run the following command:
 *
 * $ npx keycloakify own --path "account/utils/useAccountAlerts.ts"
 *
 * This file is provided by @keycloakify/keycloak-account-ui version 260700.0.4.
 * It was copied into your repository by the postinstall script: `keycloakify sync-extensions`.
 */

/* eslint-disable */

// @ts-nocheck

import { AlertVariant, useAlerts } from "../../shared/keycloak-ui-shared/alerts/Alerts";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { ApiError } from "../api/parse-response";

export function useAccountAlerts() {
    const { t } = useTranslation();
    const { addAlert, addError } = useAlerts();
    const addAccountError = useCallback(
        (messageKey: string, error: unknown) => {
            if (!(error instanceof ApiError)) {
                addError(messageKey, error);
                return;
            }

            const message = t(messageKey, { error: error.message });
            addAlert(message, AlertVariant.danger, error.description);
        },
        [addAlert, addError, t]
    );

    return useMemo(
        () => ({ addAlert, addError: addAccountError }),
        [addAccountError, addAlert]
    );
}
