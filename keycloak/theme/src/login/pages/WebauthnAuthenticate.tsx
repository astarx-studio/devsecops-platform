import type { PageProps } from "keycloakify/login/pages/PageProps";
import { useScript } from "keycloakify/login/pages/WebauthnAuthenticate.useScript";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import type { KcContext } from "../KcContext";
import type { I18n } from "../i18n";
import { PasskeyChoices } from "./PasskeyChoices";

export default function WebauthnAuthenticate(props: PageProps<Extract<KcContext, { pageId: "webauthn-authenticate.ftl" }>, I18n>) {
    const { kcContext, i18n, doUseDefaultCss, Template, classes } = props;
    const { url, authenticators, shouldDisplayAuthenticators } = kcContext;
    const { msg, msgStr, advancedMsg } = i18n;
    const authButtonId = "authenticateWebAuthnButton";

    useScript({ authButtonId, kcContext, i18n });

    return (
        <Template kcContext={kcContext} i18n={i18n} doUseDefaultCss={doUseDefaultCss} classes={classes} headerNode={msg("webauthn-login-title")}>
            <form id="webauth" action={url.loginAction} method="post">
                <input type="hidden" id="clientDataJSON" name="clientDataJSON" />
                <input type="hidden" id="authenticatorData" name="authenticatorData" />
                <input type="hidden" id="signature" name="signature" />
                <input type="hidden" id="credentialId" name="credentialId" />
                <input type="hidden" id="userHandle" name="userHandle" />
                <input type="hidden" id="error" name="error" />
            </form>
            <form id="authn_select">
                {authenticators.authenticators.map(authenticator => (
                    <input key={authenticator.credentialId} type="hidden" name="authn_use_chk" value={authenticator.credentialId} />
                ))}
            </form>
            <Stack spacing={2}>
                {shouldDisplayAuthenticators && (
                    <PasskeyChoices
                        authenticators={authenticators.authenticators}
                        title={msg("webauthn-available-authenticators")}
                        createdLabel={msgStr("webauthn-createdAt-label")}
                        advancedMsg={advancedMsg}
                    />
                )}
                <Button id={authButtonId} type="button" variant="contained" fullWidth>
                    {msgStr("webauthn-doAuthenticate")}
                </Button>
            </Stack>
        </Template>
    );
}
