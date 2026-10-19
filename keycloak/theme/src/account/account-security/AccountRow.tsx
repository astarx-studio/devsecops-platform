import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import LinkIcon from "@mui/icons-material/Link";
import LinkOffIcon from "@mui/icons-material/LinkOff";
import { useTranslation } from "react-i18next";
import { label, useEnvironment } from "../../shared/keycloak-ui-shared";
import { unLinkAccount } from "../api/methods";
import type { LinkedAccountRepresentation } from "../api/representations";
import { useAccountAlerts } from "../utils/useAccountAlerts";

type AccountRowProps = {
    account: LinkedAccountRepresentation;
    isLinked?: boolean;
    refresh: () => void;
};

export const AccountRow = ({ account, isLinked = false, refresh }: AccountRowProps) => {
    const { t } = useTranslation();
    const context = useEnvironment();
    const { login } = context.keycloak;
    const { addAlert, addError } = useAccountAlerts();

    const unLink = async () => {
        try {
            await unLinkAccount(context, account);
            addAlert(t("unLinkSuccess"));
            refresh();
        } catch (error) {
            addError("unLinkError", error);
        }
    };

    return (
        <Stack
            id={`${account.providerAlias}-idp`}
            data-testid={`linked-accounts/${account.providerName}`}
            direction={{ xs: "column", sm: "row" }}
            spacing={2}
            sx={{ alignItems: { sm: "center" }, p: 1.5, borderBottom: 1, borderColor: "divider" }}
        >
            <Typography id={`${account.providerAlias}-idp-name`} sx={{ flex: 1 }}>
                {label(t, account.displayName)}
            </Typography>
            <Chip
                id={`${account.providerAlias}-idp-label`}
                size="small"
                color={account.social ? "primary" : "success"}
                label={t(account.social ? "socialLogin" : "systemDefined")}
            />
            <Typography id={`${account.providerAlias}-idp-username`} sx={{ flex: 1 }}>
                {account.linkedUsername}
            </Typography>
            {isLinked ? (
                <Button id={`${account.providerAlias}-idp-unlink`} startIcon={<LinkOffIcon />} onClick={unLink}>
                    {t("unLink")}
                </Button>
            ) : (
                <Button
                    id={`${account.providerAlias}-idp-link`}
                    startIcon={<LinkIcon />}
                    onClick={() => login({ action: "idp_link:" + account.providerAlias })}
                >
                    {t("link")}
                </Button>
            )}
        </Stack>
    );
};
