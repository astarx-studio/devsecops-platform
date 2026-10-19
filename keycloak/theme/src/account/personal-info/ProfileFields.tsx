import type { ReactNode } from "react";
import type { UserProfileAttributeMetadata, UserProfileMetadata } from "@keycloak/keycloak-admin-client/lib/defs/userProfileMetadata";
import type { TFunction } from "i18next";
import type { FieldError, FieldPath, UseFormReturn } from "react-hook-form";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormGroup from "@mui/material/FormGroup";
import MenuItem from "@mui/material/MenuItem";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import {
    fieldName,
    isRequiredAttribute,
    label,
    labelAttribute,
    type UserFormFields
} from "../../shared/keycloak-ui-shared/user-profile/utils";

type ProfileFieldsProps = {
    t: TFunction;
    form: UseFormReturn<UserFormFields>;
    userProfileMetadata: UserProfileMetadata;
    supportedLocales: string[];
    currentLocale: string;
    renderer?: (attribute: UserProfileAttributeMetadata) => ReactNode;
};

const htmlType: Record<string, string> = {
    "html5-email": "email",
    "html5-tel": "tel",
    "html5-url": "url",
    "html5-number": "number",
    "html5-date": "date",
    "html5-month": "month",
    "html5-time": "time",
    "html5-datetime-local": "datetime-local"
};

export function ProfileFields({ t, form, userProfileMetadata, supportedLocales, currentLocale, renderer }: ProfileFieldsProps) {
    const attributes = userProfileMetadata.attributes ?? [];
    const groups = [{ name: undefined, displayHeader: undefined, displayDescription: undefined }, ...(userProfileMetadata.groups ?? [])];

    return (
        <Stack spacing={3}>
            {groups.map(group => {
                const fields = attributes.filter(attribute => attribute.group === group.name && attribute.name !== "picture");
                if (fields.length === 0) return null;
                const title = label(t, group.displayHeader, group.name) || t("general");
                return (
                    <Stack key={group.name || "general"} spacing={2}>
                        {group.name && (
                            <div>
                                <Typography variant="h6">{title}</Typography>
                                {group.displayDescription && (
                                    <Typography color="text.secondary">{label(t, group.displayDescription, "")}</Typography>
                                )}
                            </div>
                        )}
                        {fields.map(attribute => (
                            <ProfileField
                                key={attribute.name}
                                t={t}
                                form={form}
                                attribute={attribute}
                                supportedLocales={supportedLocales}
                                currentLocale={currentLocale}
                                renderer={renderer}
                            />
                        ))}
                    </Stack>
                );
            })}
        </Stack>
    );
}

function ProfileField({
    t,
    form,
    attribute,
    supportedLocales,
    currentLocale,
    renderer
}: {
    t: TFunction;
    form: UseFormReturn<UserFormFields>;
    attribute: UserProfileAttributeMetadata;
    supportedLocales: string[];
    currentLocale: string;
    renderer?: (attribute: UserProfileAttributeMetadata) => ReactNode;
}) {
    const name = fieldName(attribute.name) as FieldPath<UserFormFields>;
    const error = readError(form.formState.errors, name);
    const helper = (attribute.annotations?.["inputHelperTextBefore"] as string) || "";
    const extra = renderer?.(attribute);
    const labelText = attribute.name === "locale" ? t("selectALocale") : labelAttribute(t, attribute) || attribute.name || "";

    return (
        <Stack spacing={1}>
            {attribute.name === "locale" ? (
                <LocaleField t={t} form={form} supportedLocales={supportedLocales} currentLocale={currentLocale} labelText={labelText} error={error} />
            ) : (
                <FieldControl t={t} form={form} attribute={attribute} labelText={labelText} error={error} helper={helper ? label(t, helper, "") : undefined} />
            )}
            {extra}
        </Stack>
    );
}

function FieldControl({
    t,
    form,
    attribute,
    labelText,
    error,
    helper
}: {
    t: TFunction;
    form: UseFormReturn<UserFormFields>;
    attribute: UserProfileAttributeMetadata;
    labelText: string;
    error?: string;
    helper?: string;
}) {
    const inputType = String(attribute.annotations?.inputType || "text");
    const options = ((attribute.validators?.options as { options?: string[] } | undefined)?.options ?? []) as string[];
    const optionLabels = (attribute.annotations?.["inputOptionLabels"] as Record<string, string> | undefined) || {};
    const prefix = attribute.annotations?.["inputOptionLabelsI18nPrefix"] as string | undefined;
    const optionText = (option: string) => label(t, optionLabels[option], option, prefix);
    const registration = form.register(fieldName(attribute.name));
    const common = {
        id: attribute.name,
        label: labelText,
        fullWidth: true,
        required: isRequiredAttribute(attribute),
        disabled: !!attribute.readOnly,
        error: !!error,
        helperText: error || helper,
        inputRef: registration.ref,
        name: registration.name,
        onBlur: registration.onBlur,
        onChange: registration.onChange
    };

    if (inputType === "textarea") {
        return <TextField {...common} multiline minRows={3} />;
    }

    if (inputType === "select" || inputType === "multiselect") {
        return (
            <TextField {...common} select slotProps={{ select: { multiple: inputType === "multiselect" } }}>
                {options.map(option => (
                    <MenuItem key={option} value={option}>
                        {optionText(option)}
                    </MenuItem>
                ))}
            </TextField>
        );
    }

    if (inputType === "select-radiobuttons") {
        return (
            <FormGroup>
                <Typography variant="body2" color="text.secondary">
                    {labelText}
                </Typography>
                <RadioGroup name={registration.name} onChange={registration.onChange}>
                    {options.map(option => (
                        <FormControlLabel key={option} value={option} control={<Radio inputRef={registration.ref} />} label={optionText(option)} />
                    ))}
                </RadioGroup>
                {error && (
                    <Typography color="error" variant="caption">
                        {error}
                    </Typography>
                )}
            </FormGroup>
        );
    }

    if (inputType === "multiselect-checkboxes") {
        return (
            <FormGroup>
                <Typography variant="body2" color="text.secondary">
                    {labelText}
                </Typography>
                {options.map(option => (
                    <FormControlLabel key={option} control={<Checkbox value={option} name={registration.name} onChange={registration.onChange} />} label={optionText(option)} />
                ))}
            </FormGroup>
        );
    }

    return <TextField {...common} type={htmlType[inputType] || "text"} />;
}

function LocaleField({
    t,
    form,
    supportedLocales,
    currentLocale,
    labelText,
    error
}: {
    t: TFunction;
    form: UseFormReturn<UserFormFields>;
    supportedLocales: string[];
    currentLocale: string;
    labelText: string;
    error?: string;
}) {
    if (supportedLocales.length === 0) return null;
    const registration = form.register("attributes.locale" as FieldPath<UserFormFields>);
    const locales = supportedLocales
        .map(locale => ({
            key: locale,
            value: t(`locale_${locale}`, { defaultValue: new Intl.DisplayNames([locale], { type: "language" }).of(locale) || locale })
        }))
        .sort((a, b) => String(a.value).localeCompare(String(b.value), currentLocale));

    return (
        <TextField
            id="locale"
            select
            fullWidth
            label={labelText}
            error={!!error}
            helperText={error}
            inputRef={registration.ref}
            name={registration.name}
            onBlur={registration.onBlur}
            onChange={registration.onChange}
            defaultValue=""
        >
            <MenuItem value="">{t("defaultLocale")}</MenuItem>
            {locales.map(locale => (
                <MenuItem key={locale.key} value={locale.key}>
                    {locale.value}
                </MenuItem>
            ))}
        </TextField>
    );
}

function readError(errors: object, path: string) {
    const value = path.split(".").reduce<unknown>((current, key) => {
        if (current && typeof current === "object" && key in current) {
            return (current as Record<string, unknown>)[key];
        }
        return undefined;
    }, errors);
    return (value as FieldError | undefined)?.message;
}

export function ProfileDetails({ title, children }: { title: string; children: ReactNode }) {
    return (
        <Accordion>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>{title}</AccordionSummary>
            <AccordionDetails>{children}</AccordionDetails>
        </Accordion>
    );
}
