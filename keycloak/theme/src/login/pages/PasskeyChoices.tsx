import { Fragment, type ReactNode } from "react";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import VpnKeyOutlinedIcon from "@mui/icons-material/VpnKeyOutlined";

export type PasskeyAuthenticator = {
    credentialId: string;
    label: string;
    createdAt: string;
    transports?: {
        displayNameProperties?: string[];
    };
};

export function PasskeyChoices({
    authenticators,
    title,
    createdLabel,
    advancedMsg
}: {
    authenticators: PasskeyAuthenticator[];
    title: ReactNode;
    createdLabel: string;
    advancedMsg: (key: string) => ReactNode;
}) {
    if (authenticators.length === 0) {
        return null;
    }

    return (
        <Stack spacing={1.5}>
            {authenticators.length > 1 && (
                <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center" }}>
                    {title}
                </Typography>
            )}
            {authenticators.map((authenticator, index) => {
                const transports = authenticator.transports?.displayNameProperties ?? [];
                return (
                    <Stack
                        key={authenticator.credentialId || index}
                        id={`kc-webauthn-authenticator-item-${index}`}
                        direction="row"
                        spacing={1.5}
                        sx={{ alignItems: "center", p: 1.5, border: "1px solid", borderColor: "divider", borderRadius: 2 }}
                    >
                        <VpnKeyOutlinedIcon color="primary" />
                        <Stack sx={{ minWidth: 0 }}>
                            <Typography id={`kc-webauthn-authenticator-label-${index}`} sx={{ fontWeight: 650, overflowWrap: "anywhere" }}>
                                {advancedMsg(authenticator.label)}
                            </Typography>
                            {transports.length > 0 && (
                                <Typography id={`kc-webauthn-authenticator-transport-${index}`} variant="body2" color="text.secondary">
                                    {transports.map((name, transportIndex) => (
                                        <Fragment key={`${name}-${transportIndex}`}>
                                            {advancedMsg(name)}
                                            {transportIndex < transports.length - 1 ? ", " : ""}
                                        </Fragment>
                                    ))}
                                </Typography>
                            )}
                            <Typography variant="caption" color="text.secondary">
                                <span id={`kc-webauthn-authenticator-createdlabel-${index}`}>{createdLabel}</span>{" "}
                                <span id={`kc-webauthn-authenticator-created-${index}`}>{authenticator.createdAt}</span>
                            </Typography>
                        </Stack>
                    </Stack>
                );
            })}
        </Stack>
    );
}
