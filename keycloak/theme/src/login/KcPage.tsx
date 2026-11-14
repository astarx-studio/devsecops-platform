import { Suspense, lazy } from "react";
import type { ClassKey } from "keycloakify/login";
import "./main.css";
import type { KcContext } from "./KcContext";
import { useI18n } from "./i18n";
import Template from "./Template";
import Login from "./pages/Login";

const DefaultPage = lazy(() => import("keycloakify/login/DefaultPage"));
const LoginPasskeysConditionalAuthenticate = lazy(
    () => import("./pages/LoginPasskeysConditionalAuthenticate")
);
const WebauthnAuthenticate = lazy(() => import("./pages/WebauthnAuthenticate"));
const UserProfileFormFields = lazy(
    () => import("keycloakify/login/UserProfileFormFields")
);

const doMakeUserConfirmPassword = true;

export default function KcPage(props: { kcContext: KcContext }) {
    const { kcContext } = props;

    const { i18n } = useI18n({ kcContext });

    return (
        <Suspense fallback={<LoginFallback />}>
            {(() => {
                switch (kcContext.pageId) {
                    case "login.ftl":
                        return (
                            <Login
                                kcContext={kcContext}
                                i18n={i18n}
                                classes={classes}
                                Template={Template}
                                doUseDefaultCss={true}
                            />
                        );
                    case "webauthn-authenticate.ftl":
                        return (
                            <WebauthnAuthenticate
                                kcContext={kcContext}
                                i18n={i18n}
                                classes={classes}
                                Template={Template}
                                doUseDefaultCss={true}
                            />
                        );
                    case "login-passkeys-conditional-authenticate.ftl":
                        return (
                            <LoginPasskeysConditionalAuthenticate
                                kcContext={kcContext}
                                i18n={i18n}
                                classes={classes}
                                Template={Template}
                                doUseDefaultCss={true}
                            />
                        );
                    default:
                        return (
                            <DefaultPage
                                kcContext={kcContext}
                                i18n={i18n}
                                classes={classes}
                                Template={Template}
                                doUseDefaultCss={true}
                                UserProfileFormFields={UserProfileFormFields}
                                doMakeUserConfirmPassword={doMakeUserConfirmPassword}
                            />
                        );
                }
            })()}
        </Suspense>
    );
}

const classes = {} satisfies { [key in ClassKey]?: string };

function LoginFallback() {
    return (
        <div
            role="status"
            style={{
                minHeight: "100vh",
                display: "flex",
                alignItems: "center",
                justifyContent: "center"
            }}
        >
            Loading
        </div>
    );
}
