import { useState } from "react";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { useTranslation } from "react-i18next";

type LinkedAccountsToolbarProps = {
    onFilter: (nameFilter: string) => void;
    count: number;
    first: number;
    max: number;
    onNextClick: (page: number) => void;
    onPreviousClick: (page: number) => void;
    onPerPageSelect: (max: number, first: number) => void;
    hasNext: boolean;
};

export const LinkedAccountsToolbar = ({ first, max, onNextClick, onPreviousClick, onFilter, hasNext }: LinkedAccountsToolbarProps) => {
    const { t } = useTranslation();
    const [nameFilter, setNameFilter] = useState("");
    const page = Math.round(first / max) + 1;

    return (
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" }, mb: 1 }}>
            <TextField
                size="small"
                placeholder={t("filterByName")}
                aria-label={t("filterByName")}
                value={nameFilter}
                onChange={event => setNameFilter(event.target.value)}
                onKeyDown={event => {
                    if (event.key === "Enter") onFilter(nameFilter);
                }}
            />
            <Button onClick={() => onFilter(nameFilter)}>{t("search", { defaultValue: "Search" })}</Button>
            <Button
                onClick={() => {
                    setNameFilter("");
                    onFilter("");
                }}
            >
                {t("clear", { defaultValue: "Clear" })}
            </Button>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <Button disabled={page <= 1} onClick={() => onPreviousClick((page - 2) * max)}>
                    {t("previous", { defaultValue: "Previous" })}
                </Button>
                <span>{page}</span>
                <Button disabled={!hasNext} onClick={() => onNextClick(page * max)}>
                    {t("next", { defaultValue: "Next" })}
                </Button>
            </Stack>
        </Stack>
    );
};
