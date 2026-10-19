import type { PageProps } from "keycloakify/login/pages/PageProps";
import { useScript } from "keycloakify/login/pages/LoginPasskeysConditionalAuthenticate.useScript";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import type { KcContext } from "../KcContext";
import type { I18n } from "../i18n";
import { PasskeyChoices } from "./PasskeyChoices";

export default function LoginPasskeysConditionalAuthenticate(
    props: PageProps<Extract<KcContext, { pageId: "login-passkeys-conditional-authenticate.ftl" }>, I18n>
) {
    const { kcContext, i18n, doUseDefaultCss, Template, classes } = props;
    const { url, authenticators, shouldDisplayAuthenticators } = kcContext;
    const { msg, msgStr, advancedMsg } = i18n;
    const authButtonId = "authenticateWebAuthnButton";

    useScript({ authButtonId, kcContext, i18n });

    return (
        <Template kcContext={kcContext} i18n={i18n} doUseDefaultCss={doUseDefaultCss} classes={classes} headerNode={msg("passkey-login-title")}>
            <form id="webauth" action={url.loginAction} method="post">
                <input type="hidden" id="clientDataJSON" name="clientDataJSON" />
                <input type="hidden" id="authenticatorData" name="authenticatorData" />
                <input type="hidden" id="signature" name="signature" />
                <input type="hidden" id="credentialId" name="credentialId" />
                <input type="hidden" id="userHandle" name="userHandle" />
                <input type="hidden" id="error" name="error" />
            </form>
            {authenticators !== undefined && Object.keys(authenticators).length !== 0 && (
                <form id="authn_select">
                    {authenticators.authenticators.map(authenticator => (
                        <input key={authenticator.credentialId} type="hidden" name="authn_use_chk" readOnly value={authenticator.credentialId} />
                    ))}
                </form>
            )}
            <form id="kc-form-login" action={url.loginAction} method="post" style={{ display: "none" }} />
            <Stack spacing={2}>
                {shouldDisplayAuthenticators && authenticators !== undefined && (
                    <PasskeyChoices
                        authenticators={authenticators.authenticators}
                        title={msg("passkey-available-authenticators")}
                        createdLabel={msgStr("passkey-createdAt-label")}
                        advancedMsg={advancedMsg}
                    />
                )}
                <div id="kc-form-passkey-button" style={{ display: "none" }}>
                    <Button id={authButtonId} type="button" variant="contained" fullWidth>
                        {msgStr("passkey-doAuthenticate")}
                    </Button>
                </div>
            </Stack>
        </Template>
    );
}
