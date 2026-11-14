/**
 * This file has been claimed for ownership from @keycloakify/keycloak-admin-ui version 260700.0.3.
 * To relinquish ownership and restore this file to its original content, run the following command:
 *
 * $ npx keycloakify own --path "admin/Banners.tsx" --revert
 */

/* eslint-disable */

// @ts-nocheck

import Alert from "@mui/material/Alert";
import { useTranslation } from "react-i18next";
import { useWhoAmI } from "./context/whoami/WhoAmI";

type WarnBannerProps = {
    msg: string;
    spaced?: boolean;
};

type EventsBannerType = "userEvents" | "adminEvents";

const WarnBanner = ({ msg, spaced }: WarnBannerProps) => {
    const { t } = useTranslation();

    return (
        <Alert severity="warning" role="status" sx={spaced ? { m: 2 } : undefined}>
            {t(msg)}
        </Alert>
    );
};

export const Banners = () => {
    const { whoAmI } = useWhoAmI();

    if (whoAmI.temporary) return <WarnBanner msg="loggedInAsTempAdminUser" />;
};

export const EventsBanners = ({ type }: { type: EventsBannerType }) => {
    const msg = type === "userEvents" ? "savingUserEventsOff" : "savingAdminEventsOff";

    return <WarnBanner msg={msg} spaced />;
};
