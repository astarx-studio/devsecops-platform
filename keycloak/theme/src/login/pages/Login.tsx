import { useState } from "react";
import { kcSanitize } from "keycloakify/lib/kcSanitize";
import { clsx } from "keycloakify/tools/clsx";
import type { PageProps } from "keycloakify/login/pages/PageProps";
import { getKcClsx } from "keycloakify/login/lib/kcClsx";
import { useScript } from "keycloakify/login/pages/Login.useScript";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Visibility from "@mui/icons-material/Visibility";
import VisibilityOff from "@mui/icons-material/VisibilityOff";
import type { KcContext } from "../KcContext";
import type { I18n } from "../i18n";

export default function Login(props: PageProps<Extract<KcContext, { pageId: "login.ftl" }>, I18n>) {
    const { kcContext, i18n, doUseDefaultCss, Template, classes } = props;
    const { kcClsx } = getKcClsx({ doUseDefaultCss, classes });
    const { social, realm, url, usernameHidden, login, auth, registrationDisabled, messagesPerField, enableWebAuthnConditionalUI, authenticators } =
        kcContext;
    const { msg, msgStr } = i18n;
    const [isLoginButtonDisabled, setIsLoginButtonDisabled] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const webAuthnButtonId = "authenticateWebAuthnButton";
    const hasCredentialError = messagesPerField.existsError("username", "password");

    useScript({ webAuthnButtonId, kcContext, i18n });

    const usernameLabel = !realm.loginWithEmailAllowed
        ? msgStr("username")
        : !realm.registrationEmailAsUsername
          ? msgStr("usernameOrEmail")
          : msgStr("email");

    return (
        <Template
            kcContext={kcContext}
            i18n={i18n}
            doUseDefaultCss={doUseDefaultCss}
            classes={classes}
            displayMessage={!hasCredentialError}
            headerNode={msg("loginAccountTitle")}
            displayInfo={realm.password && realm.registrationAllowed && !registrationDisabled}
            infoNode={
                <div id="kc-registration">
                    <span>
                        {msg("noAccount")}{" "}
                        <Link tabIndex={8} href={url.registrationUrl}>
                            {msg("doRegister")}
                        </Link>
                    </span>
                </div>
            }
            socialProvidersNode={
                realm.password && social?.providers !== undefined && social.providers.length !== 0 ? (
                    <div id="kc-social-providers">
                        <h2>{msg("identity-provider-login-label")}</h2>
                        <ul>
                            {social.providers.map(p => (
                                <li key={p.alias}>
                                    <a id={`social-${p.alias}`} href={p.loginUrl}>
                                        {p.iconClasses && <i className={clsx(kcClsx("kcCommonLogoIdP"), p.iconClasses)} aria-hidden="true"></i>}
                                        <span dangerouslySetInnerHTML={{ __html: kcSanitize(p.displayName) }} />
                                    </a>
                                </li>
                            ))}
                        </ul>
                    </div>
                ) : null
            }
        >
            {realm.password && (
                <form
                    id="kc-form-login"
                    onSubmit={() => {
                        setIsLoginButtonDisabled(true);
                        return true;
                    }}
                    action={url.loginAction}
                    method="post"
                >
                    <Stack spacing={2}>
                        {!usernameHidden && (
                            <TextField
                                tabIndex={2}
                                id="username"
                                name="username"
                                label={usernameLabel}
                                defaultValue={login.username ?? ""}
                                autoFocus
                                fullWidth
                                error={hasCredentialError}
                                helperText={
                                    hasCredentialError ? (
                                        <span
                                            id="input-error"
                                            dangerouslySetInnerHTML={{
                                                __html: kcSanitize(messagesPerField.getFirstError("username", "password"))
                                            }}
                                        />
                                    ) : undefined
                                }
                                autoComplete={enableWebAuthnConditionalUI ? "username webauthn" : "username"}
                            />
                        )}

                        <TextField
                            tabIndex={3}
                            id="password"
                            name="password"
                            label={msgStr("password")}
                            type={showPassword ? "text" : "password"}
                            autoComplete="current-password"
                            fullWidth
                            error={usernameHidden && hasCredentialError}
                            helperText={
                                usernameHidden && hasCredentialError ? (
                                    <span
                                        dangerouslySetInnerHTML={{
                                            __html: kcSanitize(messagesPerField.getFirstError("username", "password"))
                                        }}
                                    />
                                ) : undefined
                            }
                            slotProps={{
                                input: {
                                    endAdornment: (
                                        <InputAdornment position="end">
                                            <IconButton
                                                type="button"
                                                aria-label={showPassword ? "Hide password" : "Show password"}
                                                aria-controls="password"
                                                onClick={() => setShowPassword(current => !current)}
                                                edge="end"
                                                tabIndex={4}
                                            >
                                                {showPassword ? <VisibilityOff /> : <Visibility />}
                                            </IconButton>
                                        </InputAdornment>
                                    )
                                }
                            }}
                        />

                        <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}>
                            {realm.rememberMe && !usernameHidden ? (
                                <FormControlLabel
                                    control={<Checkbox id="rememberMe" name="rememberMe" defaultChecked={!!login.rememberMe} tabIndex={5} />}
                                    label={msg("rememberMe")}
                                />
                            ) : (
                                <span />
                            )}
                            {realm.resetPasswordAllowed && (
                                <Link tabIndex={6} href={url.loginResetCredentialsUrl}>
                                    {msg("doForgotPassword")}
                                </Link>
                            )}
                        </Stack>

                        <input type="hidden" id="id-hidden-input" name="credentialId" value={auth.selectedCredential} />
                        <Button tabIndex={7} disabled={isLoginButtonDisabled} name="login" id="kc-login" type="submit" variant="contained" fullWidth>
                            {msgStr("doLogIn")}
                        </Button>
                    </Stack>
                </form>
            )}

            {enableWebAuthnConditionalUI && (
                <>
                    <form id="webauth" action={url.loginAction} method="post">
                        <input type="hidden" id="clientDataJSON" name="clientDataJSON" />
                        <input type="hidden" id="authenticatorData" name="authenticatorData" />
                        <input type="hidden" id="signature" name="signature" />
                        <input type="hidden" id="credentialId" name="credentialId" />
                        <input type="hidden" id="userHandle" name="userHandle" />
                        <input type="hidden" id="error" name="error" />
                    </form>
                    {authenticators !== undefined && authenticators.authenticators.length !== 0 && (
                        <form id="authn_select">
                            {authenticators.authenticators.map((authenticator, i) => (
                                <input key={i} type="hidden" name="authn_use_chk" readOnly value={authenticator.credentialId} />
                            ))}
                        </form>
                    )}
                    <Button id={webAuthnButtonId} type="button" variant="outlined" fullWidth sx={{ mt: 2 }}>
                        {msgStr("passkey-doAuthenticate")}
                    </Button>
                </>
            )}
        </Template>
    );
}
