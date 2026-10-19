import { Fragment, useState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { Trans, useTranslation } from "react-i18next";
import { useEnvironment } from "../../shared/keycloak-ui-shared";
import type { AccountEnvironment } from "..";
import { getCredentials } from "../api/methods";
import type {
    CredentialContainer,
    CredentialMetadataRepresentation
} from "../api/representations";
import { Page } from "../components/page/Page";
import type { TFuncKey } from "../i18n-type";
import { formatDate } from "../utils/formatDate";
import { joinPath } from "../utils/joinPath";
import { usePromise } from "../utils/usePromise";

export const SigningIn = () => {
    const { t } = useTranslation();
    const context = useEnvironment<AccountEnvironment>();
    const { login } = context.keycloak;
    const [credentials, setCredentials] = useState<CredentialContainer[]>();

    usePromise(signal => getCredentials({ signal, context }), setCredentials, []);

    if (!credentials) {
        return <CircularProgress />;
    }

    const categories = [...new Set(credentials.map(credential => credential.category))];

    return (
        <Page title={t("signingIn")} description={t("signingInDescription")}>
            <Stack spacing={4}>
                {categories.map(category => (
                    <Stack key={category} spacing={2}>
                        <Typography
                            id={`${category}-categ-title`}
                            variant="h5"
                            component="h2"
                        >
                            {t(category as TFuncKey)}
                        </Typography>
                        {credentials
                            .filter(credential => credential.category === category)
                            .map(container => (
                                <Fragment key={container.type}>
                                    <Stack
                                        direction={{ xs: "column", sm: "row" }}
                                        spacing={2}
                                        sx={{ justifyContent: "space-between" }}
                                    >
                                        <div>
                                            <Typography
                                                variant="h6"
                                                data-testid={`${container.type}/title`}
                                            >
                                                {t(container.displayName as TFuncKey)}
                                            </Typography>
                                            <Typography
                                                color="text.secondary"
                                                data-testid={`${container.type}/help-text`}
                                            >
                                                {t(container.helptext as TFuncKey)}
                                            </Typography>
                                        </div>
                                        {container.createAction && (
                                            <Button
                                                data-testid={`${container.type}/create`}
                                                onClick={() =>
                                                    login({
                                                        action: container.createAction
                                                    })
                                                }
                                            >
                                                {t("setUpNew", {
                                                    name: t(
                                                        `${container.type}-display-name` as TFuncKey
                                                    )
                                                })}
                                            </Button>
                                        )}
                                    </Stack>
                                    <Stack
                                        spacing={1.5}
                                        data-testid={`${container.type}/credential-list`}
                                    >
                                        {container.userCredentialMetadatas.length ===
                                            0 && (
                                            <Alert
                                                severity="info"
                                                data-testid={`${container.type}/not-set-up`}
                                            >
                                                {t("notSetUp", {
                                                    name: t(
                                                        container.displayName as TFuncKey
                                                    )
                                                })}
                                            </Alert>
                                        )}
                                        {container.userCredentialMetadatas.map(meta => (
                                            <CredentialCard
                                                key={meta.credential.id}
                                                meta={meta}
                                                showIcon={container.type.startsWith(
                                                    "webauthn"
                                                )}
                                                removable={container.removeable}
                                                updateAction={container.updateAction}
                                            />
                                        ))}
                                    </Stack>
                                </Fragment>
                            ))}
                    </Stack>
                ))}
            </Stack>
        </Page>
    );
};

function CredentialCard({
    meta,
    showIcon,
    removable,
    updateAction
}: {
    meta: CredentialMetadataRepresentation;
    showIcon: boolean;
    removable?: boolean;
    updateAction?: string;
}) {
    const { t } = useTranslation();
    const context = useEnvironment<AccountEnvironment>();
    const credential = meta.credential;
    const provider = meta.infoProperties?.find(
        property => property.key === "webauthn-authenticator-provider"
    )?.parameters?.[0];
    const icon = meta.iconLight || meta.iconDark;
    const iconSrc = icon
        ? joinPath(context.environment.resourceUrl, "passkeys", icon)
        : joinPath(context.environment.resourceUrl, "favicon.svg");

    return (
        <Stack
            id={`cred-${credential.id}`}
            direction={{ xs: "column", md: "row" }}
            spacing={2}
            sx={{
                alignItems: { md: "center" },
                p: 2,
                border: 1,
                borderColor: "divider",
                borderRadius: 2
            }}
        >
            {showIcon && <img src={iconSrc} alt="" width={40} height={40} />}
            <Stack sx={{ flex: 1 }}>
                <Typography>
                    {t(credential.userLabel) || t(credential.type as TFuncKey)}
                </Typography>
                {provider && (
                    <Typography variant="body2" color="text.secondary">
                        {provider}
                    </Typography>
                )}
                {credential.createdDate && (
                    <Typography variant="body2">
                        <Trans
                            i18nKey="credentialCreatedAt"
                            values={{
                                date: formatDate(
                                    new Date(credential.createdDate),
                                    context.environment.locale
                                )
                            }}
                            components={[<strong key="created" />]}
                        />
                    </Typography>
                )}
                {meta.infoMessage && (
                    <Typography variant="body2">
                        <InfoOutlinedIcon fontSize="inherit" />{" "}
                        {t(meta.infoMessage.key, indexed(meta.infoMessage.parameters))}
                    </Typography>
                )}
                {meta.infoProperties
                    ?.filter(
                        property => property.key !== "webauthn-authenticator-provider"
                    )
                    .map(property => (
                        <Typography key={property.key} variant="body2">
                            {t(property.key)}: {property.parameters?.[0] || ""}
                        </Typography>
                    ))}
                {meta.warningMessageTitle && meta.warningMessageDescription && (
                    <Alert severity="warning" icon={<WarningAmberIcon />}>
                        {t(
                            meta.warningMessageTitle.key,
                            indexed(meta.warningMessageTitle.parameters)
                        )}
                        <div>
                            {t(
                                meta.warningMessageDescription.key,
                                indexed(meta.warningMessageDescription.parameters)
                            )}
                        </div>
                    </Alert>
                )}
            </Stack>
            <Stack direction="row" spacing={1}>
                {removable && (
                    <Button
                        color="error"
                        data-testrole="remove"
                        onClick={() =>
                            context.keycloak.login({
                                action: "delete_credential:" + credential.id
                            })
                        }
                    >
                        {t("delete")}
                    </Button>
                )}
                {updateAction && (
                    <Button
                        variant="contained"
                        data-testrole="update"
                        onClick={() => context.keycloak.login({ action: updateAction })}
                    >
                        {t("update")}
                    </Button>
                )}
            </Stack>
            {provider && <Chip label={provider} size="small" sx={{ display: "none" }} />}
        </Stack>
    );
}

function indexed(parameters?: string[]) {
    return (
        parameters?.reduce<Record<number, string>>(
            (accumulator, value, index) => ({ ...accumulator, [index]: value }),
            {}
        ) ?? {}
    );
}

export default SigningIn;
