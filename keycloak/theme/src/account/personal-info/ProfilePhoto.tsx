import { useState, type DragEvent } from "react";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { AlertVariant } from "../../shared/@patternfly/react-core";
import { useEnvironment } from "../../shared/keycloak-ui-shared";
import type { FieldPath, UseFormReturn } from "react-hook-form";
import { useTranslation } from "react-i18next";
import type { AccountEnvironment } from "..";
import { getPersonalInfo, savePersonalInfo } from "../api/methods";
import type { UserRepresentation } from "../api/representations";
import { AccountAvatar } from "../components/AccountAvatar";
import { ImageAdjustDialog } from "../components/ImageAdjustDialog";
import { useAccountProfile } from "../root/AccountProfile";
import { useAccountAlerts } from "../utils/useAccountAlerts";

const PHOTO_TYPES = ["image/png", "image/jpeg", "image/webp"];
const PHOTO_MAX = 2 * 1024 * 1024;

export function ProfilePhoto({ form }: { form: UseFormReturn<UserRepresentation> }) {
    const { t } = useTranslation();
    const context = useEnvironment<AccountEnvironment>();
    const { email, name, picture, refresh } = useAccountProfile();
    const { addAlert } = useAccountAlerts();
    const [adjust, setAdjust] = useState<File | null>(null);
    const [busy, setBusy] = useState(false);
    const [hint, setHint] = useState("");

    function onPick(file: File) {
        if (!PHOTO_TYPES.includes(file.type)) {
            setHint(
                t("profilePhotoTypeError", {
                    defaultValue: "Choose a PNG, JPEG, or WebP photo."
                })
            );
            return;
        }
        if (file.size > PHOTO_MAX) {
            setHint(
                t("profilePhotoSizeError", { defaultValue: "Choose a photo under 2 MB." })
            );
            return;
        }
        setHint("");
        setAdjust(file);
    }

    async function persist(next: string | null) {
        setBusy(true);
        try {
            const current = await getPersonalInfo({ context });
            const attributes = { ...(current.attributes || {}) };
            attributes.picture = next ? [next] : [""];
            const account = { ...current };
            delete account.userProfileMetadata;
            await savePersonalInfo(context, { ...account, attributes });
            form.setValue(
                "attributes.picture" as FieldPath<UserRepresentation>,
                next ? [next] : [""]
            );
            const values = form.getValues();
            form.reset({
                ...values,
                attributes: {
                    ...(values.attributes || {}),
                    picture: next ? [next] : [""]
                }
            });
            await refresh();
            addAlert(
                next
                    ? t("profilePhotoSaved", { defaultValue: "Your photo is updated." })
                    : t("profilePhotoRemoved", {
                          defaultValue: "Your photo is removed. Gravatar is used instead."
                      })
            );
        } catch {
            addAlert(t("accountUpdatedError"), AlertVariant.danger);
        } finally {
            setBusy(false);
        }
    }

    function onDrop(event: DragEvent<HTMLDivElement>) {
        event.preventDefault();
        const file = event.dataTransfer.files?.[0];
        if (file) onPick(file);
    }

    return (
        <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={2}
            onDragOver={event => event.preventDefault()}
            onDrop={onDrop}
            sx={{ alignItems: { sm: "center" } }}
        >
            <AccountAvatar name={name} email={email} picture={picture} size={88} />
            <Stack spacing={1} sx={{ alignItems: "flex-start" }}>
                <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
                    <Button component="label" variant="outlined" disabled={busy}>
                        {busy
                            ? t("profilePhotoSaving", { defaultValue: "Saving photo…" })
                            : t("profilePhotoChoose", { defaultValue: "Choose a photo" })}
                        <input
                            hidden
                            type="file"
                            accept={PHOTO_TYPES.join(",")}
                            onChange={event => {
                                const file = event.target.files?.[0];
                                event.target.value = "";
                                if (file) onPick(file);
                            }}
                        />
                    </Button>
                    {picture ? (
                        <Button
                            color="inherit"
                            disabled={busy}
                            onClick={() => void persist(null)}
                        >
                            {t("profilePhotoRemove", { defaultValue: "Remove photo" })}
                        </Button>
                    ) : null}
                </Stack>
                <Typography variant="caption" color="text.secondary">
                    {t("profilePhotoHint", {
                        defaultValue:
                            "Your photo appears on your account. When you have not chosen one, we use your Gravatar."
                    })}
                </Typography>
                {hint ? (
                    <Typography variant="caption" color="error">
                        {hint}
                    </Typography>
                ) : null}
            </Stack>
            <ImageAdjustDialog
                file={adjust}
                open={Boolean(adjust)}
                onClose={() => setAdjust(null)}
                onConfirm={async dataUrl => {
                    setAdjust(null);
                    await persist(dataUrl);
                }}
            />
        </Stack>
    );
}
