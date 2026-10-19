import { useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import ComputerIcon from "@mui/icons-material/Computer";
import PhoneIphoneIcon from "@mui/icons-material/PhoneIphone";
import RefreshIcon from "@mui/icons-material/Refresh";
import { useTranslation } from "react-i18next";
import { label, useEnvironment } from "../../shared/keycloak-ui-shared";
import type { AccountEnvironment } from "..";
import { deleteSession, getDevices } from "../api/methods";
import type {
    ClientRepresentation,
    DeviceRepresentation,
    SessionRepresentation
} from "../api/representations";
import { ConfirmButton } from "../components/ConfirmButton";
import { Page } from "../components/page/Page";
import { formatDate } from "../utils/formatDate";
import { useAccountAlerts } from "../utils/useAccountAlerts";
import { usePromise } from "../utils/usePromise";

const PAGE_SIZE = 6;

type SessionRow = { device: DeviceRepresentation; session: SessionRepresentation };

export const DeviceActivity = () => {
    const { t } = useTranslation();
    const context = useEnvironment<AccountEnvironment>();
    const { addAlert, addError } = useAccountAlerts();
    const [devices, setDevices] = useState<DeviceRepresentation[]>();
    const [visible, setVisible] = useState(PAGE_SIZE);
    const [key, setKey] = useState(0);
    const refresh = () => {
        setVisible(PAGE_SIZE);
        setKey(current => current + 1);
    };

    const moveCurrentToTop = (next: DeviceRepresentation[]) => {
        const index = next.findIndex(device => device.current);
        const currentDevice = next.splice(index, 1)[0];
        const sessionIndex = currentDevice.sessions.findIndex(session => session.current);
        const currentSession = currentDevice.sessions.splice(sessionIndex, 1)[0];
        currentDevice.sessions.unshift(currentSession);
        next.unshift(currentDevice);
        setDevices(next);
    };

    usePromise(signal => getDevices({ signal, context }), moveCurrentToTop, [key]);

    const signOutAll = async () => {
        await deleteSession(context);
        await context.keycloak.logout();
    };

    const signOutSession = async (
        session: SessionRepresentation,
        device: DeviceRepresentation
    ) => {
        try {
            await deleteSession(context, session.id);
            addAlert(t("signedOutSession", { browser: session.browser, os: device.os }));
            refresh();
        } catch (error) {
            addError("errorSignOutMessage", error);
        }
    };

    const rows: SessionRow[] = devices
        ? devices.flatMap(device => device.sessions.map(session => ({ device, session })))
        : [];
    const shown = rows.slice(0, visible);
    const hasMore = visible < rows.length;
    const sentinelRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const node = sentinelRef.current;
        if (!hasMore || !node) return;
        const observer = new IntersectionObserver(
            entries => {
                if (entries.some(entry => entry.isIntersecting)) {
                    setVisible(current => Math.min(current + PAGE_SIZE, rows.length));
                }
            },
            { rootMargin: "240px" }
        );
        observer.observe(node);
        return () => observer.disconnect();
    }, [hasMore, rows.length, visible]);

    if (!devices) {
        return <CircularProgress />;
    }

    return (
        <Page title={t("deviceActivity")} description={t("signedInDevicesExplanation")}>
            <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={2}
                sx={{ justifyContent: "space-between", mb: 2 }}
            >
                <Typography variant="h5" component="h2">
                    {t("signedInDevices")}
                </Typography>
                <Stack direction="row" spacing={1}>
                    <Button
                        id="refresh-page"
                        startIcon={<RefreshIcon />}
                        onClick={refresh}
                    >
                        {t("refreshPage")}
                    </Button>
                    {(devices.length > 1 || (devices[0]?.sessions?.length ?? 0) > 1) && (
                        <ConfirmButton
                            title={t("signOutAllDevices")}
                            message={t("signOutAllDevicesWarning")}
                            confirmLabel={t("confirm")}
                            cancelLabel={t("cancel")}
                            color="error"
                            onConfirm={signOutAll}
                        />
                    )}
                </Stack>
            </Stack>
            {rows.length > PAGE_SIZE && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                    {t("signedInDevicesShown", {
                        defaultValue: "Showing {{shown}} of {{total}}",
                        shown: shown.length,
                        total: rows.length
                    })}
                </Typography>
            )}
            <Stack spacing={2} aria-label={t("signedInDevices")}>
                {shown.map(({ device, session }, index) => (
                    <Stack
                        key={`${device.id}-${session.id}`}
                        data-testid={`row-${index}`}
                        spacing={1.5}
                        sx={{ p: 2, border: 1, borderColor: "divider", borderRadius: 2 }}
                    >
                        <Stack
                            direction="row"
                            spacing={1.5}
                            sx={{ alignItems: "center" }}
                        >
                            {device.mobile ? <PhoneIphoneIcon /> : <ComputerIcon />}
                            <Typography sx={{ flex: 1 }}>
                                {device.os.toLowerCase().includes("unknown")
                                    ? t("unknownOperatingSystem")
                                    : device.os}{" "}
                                {!device.osVersion.toLowerCase().includes("unknown") &&
                                    device.osVersion}{" "}
                                / {session.browser}
                            </Typography>
                            {session.current && (
                                <Chip
                                    color="success"
                                    label={t("currentSession")}
                                    size="small"
                                />
                            )}
                            {!session.current && (
                                <ConfirmButton
                                    title={t("signOut")}
                                    message={t("signOutWarning")}
                                    confirmLabel={t("confirm")}
                                    cancelLabel={t("cancel")}
                                    onConfirm={() => signOutSession(session, device)}
                                />
                            )}
                        </Stack>
                        <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
                            <Detail label={t("ipAddress")} value={session.ipAddress} />
                            <Detail
                                label={t("lastAccessedOn")}
                                value={formatDate(
                                    new Date(session.lastAccess * 1000),
                                    context.environment.locale
                                )}
                            />
                            <Detail
                                label={t("clients")}
                                value={session.clients.map(clientName).join(", ")}
                            />
                            <Detail
                                label={t("started")}
                                value={formatDate(
                                    new Date(session.started * 1000),
                                    context.environment.locale
                                )}
                            />
                            <Detail
                                label={t("expires")}
                                value={formatDate(
                                    new Date(session.expires * 1000),
                                    context.environment.locale
                                )}
                            />
                        </Stack>
                    </Stack>
                ))}
            </Stack>
            {hasMore && <Box ref={sentinelRef} aria-hidden sx={{ height: 1 }} />}
        </Page>
    );

    function clientName(client: ClientRepresentation) {
        return client.clientName !== "" ? label(t, client.clientName) : client.clientId;
    }
};

function Detail({ label: term, value }: { label: string; value: string }) {
    return (
        <Stack sx={{ minWidth: 140 }}>
            <Typography variant="caption" color="text.secondary">
                {term}
            </Typography>
            <Typography variant="body2">{value}</Typography>
        </Stack>
    );
}

export default DeviceActivity;
