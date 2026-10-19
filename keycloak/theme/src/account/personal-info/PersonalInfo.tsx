import { useState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import { AlertVariant } from "../../shared/@patternfly/react-core";
import { beerify, debeerify, setUserProfileServerError, useEnvironment } from "../../shared/keycloak-ui-shared";
import type { TFunction } from "i18next";
import type { ErrorOption } from "react-hook-form";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import type { AccountEnvironment } from "..";
import { getPersonalInfo, getSupportedLocales, savePersonalInfo } from "../api/methods";
import type { UserProfileMetadata, UserRepresentation } from "../api/representations";
import { Page } from "../components/page/Page";
import type { TFuncKey } from "../i18n-type";
import { useAccountAlerts } from "../utils/useAccountAlerts";
import { usePromise } from "../utils/usePromise";
import { ProfileDetails, ProfileFields } from "./ProfileFields";
import { ProfilePhoto } from "./ProfilePhoto";

export const PersonalInfo = () => {
    const { t } = useTranslation();
    const context = useEnvironment<AccountEnvironment>();
    const [userProfileMetadata, setUserProfileMetadata] = useState<UserProfileMetadata>();
    const [supportedLocales, setSupportedLocales] = useState<string[]>([]);
    const form = useForm<UserRepresentation>({ mode: "onChange" });
    const { handleSubmit, reset, setValue, setError } = form;
    const { addAlert } = useAccountAlerts();

    usePromise(
        signal => Promise.all([getPersonalInfo({ signal, context }), getSupportedLocales({ signal, context })]),
        ([personalInfo, locales]) => {
            setUserProfileMetadata(personalInfo.userProfileMetadata);
            setSupportedLocales(locales);
            reset(personalInfo);
            Object.entries(personalInfo.attributes || {}).forEach(([key, value]) => setValue(`attributes[${beerify(key)}]` as "attributes", value));
        }
    );

    const onSubmit = async (user: UserRepresentation) => {
        try {
            const attributes = Object.fromEntries(Object.entries(user.attributes || {}).map(([key, value]) => [debeerify(key), value]));
            await savePersonalInfo(context, { ...user, attributes });
            const locale = attributes["locale"]?.toString();
            if (locale) {
                window.dispatchEvent(new CustomEvent("languageChanged", { detail: { language: locale } }));
            }
            await context.keycloak.updateToken();
            addAlert(t("accountUpdatedMessage"));
        } catch (error) {
            addAlert(t("accountUpdatedError"), AlertVariant.danger);
            setUserProfileServerError(
                { responseData: { errors: error as never } },
                (name: string | number, fieldError: unknown) => setError(name as "username", fieldError as ErrorOption),
                ((key: TFuncKey, param?: object) => t(key, param as never)) as TFunction
            );
        }
    };

    if (!userProfileMetadata) {
        return <CircularProgress />;
    }

    const allFieldsReadOnly = userProfileMetadata.attributes?.every(attribute => attribute.readOnly) ?? false;
    const { updateEmailFeatureEnabled, updateEmailActionEnabled, isRegistrationEmailAsUsername, isEditUserNameAllowed, deleteAccountAllowed } =
        context.environment.features;

    return (
        <Page title={t("personalInfo")} description={t("personalInfoDescription")}>
            <Stack component="form" spacing={3} onSubmit={handleSubmit(onSubmit)}>
                <ProfilePhoto form={form} />
                <ProfileFields
                    t={((key: unknown, params) => t(key as TFuncKey, params as never)) as TFunction}
                    form={form as never}
                    userProfileMetadata={userProfileMetadata}
                    supportedLocales={supportedLocales}
                    currentLocale={context.environment.locale}
                    renderer={attribute => {
                        const annotations = attribute.annotations ?? {};
                        if (
                            attribute.name === "email" &&
                            updateEmailFeatureEnabled &&
                            updateEmailActionEnabled &&
                            annotations["kc.required.action.supported"] &&
                            (!isRegistrationEmailAsUsername || isEditUserNameAllowed)
                        ) {
                            return (
                                <Button id="update-email-btn" onClick={() => context.keycloak.login({ action: "UPDATE_EMAIL" })}>
                                    {t("updateEmail")}
                                </Button>
                            );
                        }
                        return undefined;
                    }}
                />
                {!allFieldsReadOnly && (
                    <Stack direction="row" spacing={1}>
                        <Button data-testid="save" id="save-btn" type="submit" variant="contained">
                            {t("save")}
                        </Button>
                        <Button data-testid="cancel" id="cancel-btn" type="button" onClick={() => reset()}>
                            {t("cancel")}
                        </Button>
                    </Stack>
                )}
                {deleteAccountAllowed && (
                    <ProfileDetails title={t("deleteAccount")}>
                        <Alert
                            severity="error"
                            action={
                                <Button
                                    id="delete-account-btn"
                                    color="error"
                                    variant="contained"
                                    onClick={() => context.keycloak.login({ action: "delete_account" })}
                                >
                                    {t("delete")}
                                </Button>
                            }
                        >
                            {t("deleteAccountWarning")}
                        </Alert>
                    </ProfileDetails>
                )}
            </Stack>
        </Page>
    );
};

export default PersonalInfo;
